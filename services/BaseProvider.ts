import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage, Provider } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { parseTitleAndSummary, langInstruction, langSuffix, debugLog, buildFavoritesDigest } from "./messageUtils";
import { resolveDefaultModelForProvider } from "../models/knownModels";
import { TITLE_MARKER, SUMMARY_MARKER } from "./promptConstants";
import { buildSystemPrompt, buildAttachedNotesContent, buildAttachedPdfs } from "./ContextBuilder";
import type { PdfAttachment } from "./ContextBuilder";
import { ABORT_ERROR_NAMES } from "./retry";

/** Repeated verbatim in generateChapterName and generateConversationTitle below. */
const REPLY_TITLE_ONLY_INSTRUCTION = "Reply with ONLY the title, no punctuation, no quotes.";

/** Safety net against a confused model looping on tool calls indefinitely. */
const MAX_TOOL_ROUNDS = 25;

/** Runs one streaming round. Returns the normalised action and accumulated token usage delta. */
export interface RoundResult {
	/** Normalised to "tool_use" or "done". */
	action: "tool_use" | "done";
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	/** Whether the provider actually received usage data this round. */
	hasUsage: boolean;
}

export abstract class BaseProvider implements LLMProvider {
	protected app: App;
	protected settings: PythiaSettings;
	protected apiKey = "";
	protected abortController: AbortController | null = null;
	protected providerType: Provider;

	constructor(app: App, settings: PythiaSettings, apiKey: string, providerType: Provider) {
		this.app = app;
		this.settings = settings;
		this.apiKey = apiKey;
		this.providerType = providerType;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
		this.resetClient();
	}

	updateApiKey(apiKey: string): void {
		this.apiKey = apiKey;
		this.resetClient();
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	/** Null out the cached client so the next call re-initialises it with new credentials. */
	protected abstract resetClient(): void;

	/** Cheap fast model for utility calls (chapter names, titles, note summaries). */
	protected abstract get fastModel(): string;

	/** Label used for the assistant role in conversation transcripts sent to the API. */
	protected get assistantLabel(): string { return "Assistant"; }

	/** Resolve the model to use, falling back to the provider's configured default. */
	protected resolveModel(modelOverride?: string): string {
		return modelOverride || resolveDefaultModelForProvider(this.providerType, this.settings);
	}

	/**
	 * Single-turn, non-streaming API call used by all generate* utility methods.
	 * Implementations should trim the returned string; return "" on empty/error.
	 */
	protected abstract callUtility(
		model: string,
		userMessage: string,
		maxTokens: number,
		systemMessage?: string
	): Promise<string>;

	/** Provider-specific: prepare the loop messages, tools, and parameters.
	 *  Called once before the loop starts. Store state on `this` for use in runStreamRound. */
	protected abstract prepareStream(
		conversation: Conversation,
		userContent: string,
		systemPrompt: string,
		pdfAttachments: PdfAttachment[],
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void>;

	/** Provider-specific: run one streaming round (create stream, consume chunks).
	 *  Must handle retry-before-first-token internally.
	 *  Returns a normalised RoundResult. */
	protected abstract runStreamRound(
		signal: AbortSignal,
		onToken: (text: string) => void,
	): Promise<RoundResult>;

	/** Provider-specific: process tool calls from the last round and append
	 *  tool result messages to the loop messages.
	 *  Called when runStreamRound returns action "tool_use". */
	protected abstract handleToolCalls(
		onToolCall: (call: ToolCall) => Promise<string>
	): Promise<void>;

	// ── Shared streaming loop ─────────────────────────────────────────────────

	async streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		this.abort();
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;

		let fullText = "";

		try {
			const { userContent, systemPrompt, pdfAttachments } =
				await this.resolveUserContent(conversation, attachedNotes, newMessage);

			await this.prepareStream(conversation, userContent, systemPrompt, pdfAttachments, onToolCall);

			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let totalCacheReadTokens = 0;
			let totalCacheCreationTokens = 0;
			let receivedUsage = false;
			let round = 0;

			while (true) {
				if (++round > MAX_TOOL_ROUNDS) throw new ToolLoopLimitError();

				const result = await this.runStreamRound(
					signal,
					(text) => { fullText += text; onToken(text); },
				);

				totalInputTokens += result.inputTokens;
				totalOutputTokens += result.outputTokens;
				totalCacheReadTokens += result.cacheReadTokens;
				totalCacheCreationTokens += result.cacheCreationTokens;
				if (result.hasUsage) receivedUsage = true;

				debugLog(this.settings, "tool round", round, "action:", result.action, "usage:", {
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					...(totalCacheReadTokens > 0 ? { cacheReadTokens: totalCacheReadTokens } : {}),
					...(totalCacheCreationTokens > 0 ? { cacheCreationTokens: totalCacheCreationTokens } : {}),
				});

				if (result.action === "tool_use" && onToolCall) {
					await this.handleToolCalls(onToolCall);
				} else {
					break;
				}
			}

			const tokenUsage: TokenUsage | undefined = receivedUsage
				? {
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					...(totalCacheReadTokens > 0 ? { cacheReadTokens: totalCacheReadTokens } : {}),
					...(totalCacheCreationTokens > 0 ? { cacheCreationTokens: totalCacheCreationTokens } : {}),
				}
				: undefined;
			onComplete(fullText, tokenUsage);
		} catch (error) {
			this.finishOrError(error, fullText, onComplete, onError);
		} finally {
			if (this.abortController === controller) this.abortController = null;
		}
	}

	// ── Shared streamMessage helpers ───────────────────────────────────────────

	/** Fetches attached-note content, warns on missing/oversized notes, and builds
	 *  the outgoing user message + system prompt. Notes are placed in the system
	 *  prompt (not the user message) so the model treats them as reference material
	 *  and they benefit from Anthropic's prompt caching. */
	protected async resolveUserContent(
		conversation: Conversation,
		attachedNotes: string[],
		newMessage: string
	): Promise<{ userContent: string; systemPrompt: string; pdfAttachments: PdfAttachment[] }> {
		const pdfPaths = attachedNotes.filter((p) => p.toLowerCase().endsWith(".pdf"));
		const notePaths = attachedNotes.filter((p) => !p.toLowerCase().endsWith(".pdf"));

		const [
			{ content: attachedContent, missingNotes, estimatedTokens },
			{ pdfs, missingPdfs, oversizedPdfs },
		] = await Promise.all([
			buildAttachedNotesContent(this.app, notePaths, newMessage),
			buildAttachedPdfs(this.app, pdfPaths),
		]);

		if (missingNotes.length > 0) {
			new Notice(t("contextNotesWarning", { count: missingNotes.length }));
		}
		if (missingPdfs.length > 0) {
			new Notice(t("missingPdfsWarning", { count: missingPdfs.length }));
		}
		if (oversizedPdfs.length > 0) {
			new Notice(t("oversizedPdfWarning", { count: oversizedPdfs.length }));
		}

		const noteTokenLimit = this.settings.maxAttachedNotesTokens;
		if (noteTokenLimit > 0 && estimatedTokens > noteTokenLimit) {
			new Notice(t("attachedNotesTokenWarning", { tokens: String(estimatedTokens) }));
		}

		const systemPrompt = buildSystemPrompt(conversation) + attachedContent;

		return {
			userContent: newMessage,
			systemPrompt,
			pdfAttachments: pdfs,
		};
	}

	/** Routes a streamMessage failure to onComplete (clean cancellation) or
	 *  onError (genuine failure), based on whether it's a user-initiated abort. */
	protected finishOrError(
		error: unknown,
		fullText: string,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void
	): void {
		const isAbort = error instanceof Error && ABORT_ERROR_NAMES.has(error.name);
		if (isAbort) {
			onComplete(fullText);
		} else {
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	// ── Shared utility methods ─────────────────────────────────────────────────

	async generateSummary(conversation: Conversation): Promise<string> {
		const model = this.resolveModel(conversation.model);
		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : this.assistantLabel}: ${m.content}`)
			.join("\n\n");
		return this.callUtility(
			model,
			`Recap the substance of the discussion below so it stands on its own as a reminder of what was covered — and works as context if the discussion continues.\n\n- Lead with the subject matter itself, written as knowledge. Do NOT describe the chat: never open with "This conversation…", "In this conversation…", "The user…", "We discussed…", or a "Summary of…" heading.\n- Capture the main topics, any decisions or conclusions reached, and important outputs.\n- Keep it brief and factual — a few short sentences or tight bullet points.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
			1024
		);
	}

	async generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }> {
		const model = this.resolveModel(conversation.model);
		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : this.assistantLabel}: ${m.content}`)
			.join("\n\n");
		const sfx = langSuffix(this.settings.outputLanguage);
		const raw = await this.callUtility(
			model,
			`Give this conversation a concise title and a brief summary.\n\nReply in EXACTLY this format — no other text before or after:\n${TITLE_MARKER}: <3-6 word title${sfx}, no punctuation, no quotes>\n${SUMMARY_MARKER}:\n<summary${sfx} here>\n\nFor the summary: recap the substance so it stands on its own — capture the main topics, any decisions or conclusions, and important outputs, written as knowledge. Lead with the subject matter; do NOT open with "This conversation…", "In this conversation…", "The user…", "We discussed…", or a "Summary of…" heading. Keep it brief and factual.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
			1024
		);
		return parseTitleAndSummary(raw);
	}

	async generateChapterName(content: string): Promise<string> {
		const excerpt = content.slice(0, 500);
		return this.callUtility(
			this.fastModel,
			`Summarize this user message in 3-5 words as a chapter title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(this.settings.outputLanguage)}\n\nMessage:\n${excerpt}`,
			15
		);
	}

	async generateConversationTitle(userMessage: string, assistantMessage: string): Promise<string> {
		const userExcerpt = userMessage.slice(0, 300);
		const assistantExcerpt = assistantMessage.slice(0, 300);
		return (
			(await this.callUtility(
				this.fastModel,
				`Give this conversation a concise 3-5 word title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(this.settings.outputLanguage)}\n\nUser: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`,
				20
			)) || "New Conversation"
		);
	}

	async generateFavoritesSummary(conversation: Conversation): Promise<string> {
		const digest = buildFavoritesDigest(conversation);
		if (!digest) return "";
		const model = this.resolveModel(conversation.model);
		return this.callUtility(
			model,
			`The following are the highlights a user hand-picked from a conversation as its most important insights. Synthesize them into a learning aid that helps the user retain the knowledge and act on it.\n\nReply in Markdown, starting directly with the "## Key learnings" heading — no preamble:\n\n## Key learnings\nA bullet list that consolidates and deduplicates the insights across the highlights — group related points and stay grounded in the provided text. State each learning directly as a fact; do NOT phrase bullets as "The user highlighted…", "This note says…", or "The conversation covered…". Do not restate the highlights one by one.\n\n## Action items\nA list of concrete, actionable next steps derived from the highlights, each written as a checkbox: "- [ ] <action>". Only include actions the highlights actually support — if none are genuinely warranted, omit this section and its heading entirely.${langInstruction(this.settings.outputLanguage)}\n\n${digest}`,
			1536
		);
	}

	async summarizeNotes(content: string): Promise<string> {
		return this.callUtility(
			this.fastModel,
			`Summarize the following note(s) concisely. Focus on key topics, decisions, and insights.${langInstruction(this.settings.outputLanguage)}\n\n${content}`,
			1024
		);
	}

	async optimizePrompt(systemPrompt: string, userMessage: string, model?: string): Promise<string> {
		return this.callUtility(
			this.resolveModel(model),
			userMessage,
			2048,
			systemPrompt || undefined
		);
	}
}
