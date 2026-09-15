import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage, Provider } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { parseTitleAndSummary, langInstruction, langSuffix, debugLog, buildFavoritesDigest } from "./messageUtils";
import { resolveDefaultModelForProvider } from "../models/knownModels";
import { TITLE_MARKER, SUMMARY_MARKER, DEFINITION_MARKER, VARIANTS_MARKER } from "./promptConstants";
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

/**
 * The shared contract for a conversation summary, used by `generateSummary` and
 * `generateSummaryWithTitle`. One copy, because two copies is how one of them
 * silently stops matching the other.
 *
 * Three constraints, each for a reported failure:
 *
 * **Substance, not session.** A conversation whose *content* was a task ("write
 * this summary into that note") makes the model narrate the task — "a summary
 * was generated and inserted at the top of `_inbox/Unbenannt.md` … as
 * requested". True, and useless: nobody reopens a conversation to be told a file
 * was written. The old rule only banned the opening phrase, so the narration
 * moved into the body. This bans the act, not the phrasing.
 *
 * **A countable length.** "Keep it brief" is read very differently by different
 * models, which is exactly what the user saw. Sentences and words can be counted
 * by the model as it writes; "brief" cannot. The budget stays generous — the cap
 * is a safety valve, and a cap low enough to force brevity would truncate
 * mid-sentence instead (worse on reasoning models, where the cap also pays for
 * hidden reasoning).
 *
 * **Prose only.** The summary is displayed in three places, the smallest of
 * which is an inline anchor a few lines tall. Headings and bullet lists are
 * built for a page, and they inflate that anchor without adding meaning at this
 * length. The favorites summary is deliberately NOT under this rule — it is a
 * study aid and its structure is the point.
 *
 * It is also read back as context by a fork (PRIOR_SUMMARY_INSTRUCTION), which
 * is why the ceiling is five sentences and not two: the summary has to carry the
 * topic, not just label it.
 */
const SUMMARY_RULES =
	"- Lead with the subject matter, written as knowledge, for someone who has not read the conversation. " +
	"Never open with \"This conversation…\", \"In this conversation…\", \"The user…\", \"We discussed…\", or a \"Summary of…\" heading.\n" +
	"- Summarize the substance, never the session. Do not narrate what was done, asked for, produced, saved, " +
	"inserted or edited; do not name a file that was created or changed; never write \"as requested\" or \"as asked\". " +
	"If the conversation produced a document, summarize what that document SAYS.\n" +
	"- Capture the main topics and any conclusions reached.\n" +
	"- At most five sentences and under 100 words.\n" +
	"- Plain prose only: no headings, no bullet points, no numbered lists, no bold, no code formatting.";

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

		// Pass whether note text is actually being inlined (manual context notes OR
		// vault-RAG auto-retrieved notes appended by the router) so the citation
		// instruction and the ADR-115 untrusted-content guard fire for retrieved
		// notes too, not only for notes stored on the conversation.
		const systemPrompt =
			buildSystemPrompt(conversation, this.settings.customInstructions, {
				hasAttachedNotes: attachedContent.length > 0,
			}) + attachedContent;

		return {
			userContent: newMessage,
			systemPrompt,
			pdfAttachments: pdfs,
		};
	}

	/** Routes a streamMessage failure. A user-initiated abort, or any genuine
	 *  error that arrives AFTER the model already streamed visible text, is
	 *  treated as a (partial) completion — `onComplete` finalizes and saves what
	 *  streamed — so a transient mid-stream failure never silently discards an
	 *  answer the user watched appear; a genuine error surfaces a non-destructive
	 *  Notice. Only an error with no streamed text yet routes to the destructive
	 *  `onError` (which drops the empty placeholder). */
	protected finishOrError(
		error: unknown,
		fullText: string,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void
	): void {
		const err = error instanceof Error ? error : new Error(String(error));
		const isAbort = ABORT_ERROR_NAMES.has(err.name);

		if (isAbort) {
			// Clean user-initiated stop — keep whatever streamed as the final turn.
			onComplete(fullText);
			return;
		}

		if (fullText) {
			// A genuine error, but the model already streamed a visible reply.
			// Keep that partial as the assistant turn and tell the user it was cut
			// short, rather than erasing an answer they already saw.
			new Notice(t("streamInterruptedPartialKept", { error: err.message }), 8000);
			onComplete(fullText);
			return;
		}

		// Nothing streamed yet — surface the error and drop the empty placeholder.
		onError(err);
	}

	// ── Shared utility methods ─────────────────────────────────────────────────

	async generateSummary(conversation: Conversation): Promise<string> {
		const model = this.resolveModel(conversation.model);
		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : this.assistantLabel}: ${m.content}`)
			.join("\n\n");
		return this.callUtility(
			model,
			`Recap the substance of the discussion below so it stands on its own as a reminder of what was covered — and works as context if the discussion continues.\n\n${SUMMARY_RULES}${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
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
			`Give this conversation a concise title and a brief summary.\n\nReply in EXACTLY this format — no other text before or after:\n${TITLE_MARKER}: <3-6 word title${sfx}, no punctuation, no quotes>\n${SUMMARY_MARKER}:\n<summary${sfx} here>\n\nFor the summary, recap the substance so it stands on its own:\n${SUMMARY_RULES}${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
			1024
		);
		return parseTitleAndSummary(raw);
	}

	/**
	 * Define one term as it is used in a specific passage (ADR-136).
	 *
	 * The passage is the whole point. A dictionary can say what "Bauteil" means in
	 * general; only the surrounding sentences can say which sense an answer meant,
	 * and that sense is what the reader is stuck on. Sending the passage is also
	 * what keeps this from needing a new prompt in the conversation.
	 *
	 * The same call also returns the term's other surface forms, because the
	 * model that just read the passage knows whether "Zählern" is the same word
	 * and whether the answer's English "counter" means it too. Asking separately
	 * would double the latency of a lookup the reader is waiting on.
	 *
	 * Runs on the fast model with a small token budget: this is a gloss, not an
	 * essay, and it is fetched while the reader waits.
	 */
	async defineTerm(term: string, passage: string): Promise<string> {
		const excerpt = passage.slice(0, 1200);
		return this.callUtility(
			this.fastModel,
			`Define the term "${term}" as it is used in the passage below, and list its other surface forms.\n\n` +
				`Reply in EXACTLY this format — no other text before or after:\n` +
				`${DEFINITION_MARKER}:\n<two or three sentences>\n` +
				`${VARIANTS_MARKER}: <forms separated by | , or leave empty>\n\n` +
				`For the definition: explain the sense that applies here, not every possible meaning. ` +
				`Do not repeat the passage, do not add a heading, do not use the word "context".\n` +
				`For the variants: the inflected forms of this term a reader would meet in running text ` +
				`(plural, genitive, dative, declined adjective forms), plus the term's equivalent in the ` +
				`other language if the passage mixes languages, plus a common abbreviation or spelling ` +
				`variant if one exists. Forms only — never related concepts, never explanations, and never ` +
				`a form so generic it would match unrelated sentences. Leave the line empty if there are none.` +
				`${langInstruction(this.settings.outputLanguage)}\n\nPassage:\n${excerpt}`,
			300
		);
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
