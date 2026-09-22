import { App, Notice } from "obsidian";
import { t, getObsidianLocale } from "../i18n";
import type { Conversation, ToolCall, TokenUsage, StreamFinish, Provider } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import {
	parseTitleAndSummary,
	resolveLanguageLabel,
	langInstruction,
	langSuffix,
	debugLog,
	buildFavoritesDigest,
	cleanGeneratedTitle,
} from "./messageUtils";
import { parseTranslationReply } from "./glossaryReply";
import type { TranslatedDefinition } from "./glossaryReply";
import {
	defineTermPrompt,
	describePersonPrompt,
	termDiscussionPrompt,
	translateDefinitionPrompt,
} from "./glossaryPrompts";
import { resolveDefaultModelForProvider } from "../models/knownModels";
import { TITLE_MARKER, SUMMARY_MARKER } from "./promptConstants";
import { buildSystemPrompt, buildAttachedNotesContent, buildAttachedPdfs } from "./ContextBuilder";
import type { PdfAttachment } from "./ContextBuilder";
import { ABORT_ERROR_NAMES } from "./retry";
import { buildRetitleDigest, chapterNamePrompt, conversationTitlePrompt, retitlePrompt } from "./titlePrompts";

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
	/** The round ended because the max-tokens cap was reached (`max_tokens` /
	 *  `length`), not because the model finished (ADR-162). */
	truncated: boolean;
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
	/** The small/cheap model utility calls run on. Public because a stored
	 *  artifact — a glossary entry — has to record which model actually wrote it,
	 *  and only the provider knows (ADR-144). */
	abstract get fastModel(): string;

	/** Label used for the assistant role in conversation transcripts sent to the API. */
	protected get assistantLabel(): string { return "Assistant"; }

	/** Resolve the model to use, falling back to the provider's configured default. */
	protected resolveModel(modelOverride?: string): string {
		return modelOverride || resolveDefaultModelForProvider(this.providerType, this.settings);
	}

	/**
	 * The English language name every prompt in this class instructs the model
	 * with, or "" for "say nothing and let the model follow the conversation"
	 * (ADR-148).
	 *
	 * Resolution is conversation override → global setting. `conversation` is
	 * optional because some utility calls genuinely have none in reach — a note
	 * summary is asked for outside any conversation — and those fall back to the
	 * global setting, which is what an unconfigured conversation resolves to
	 * anyway.
	 */
	protected languageLabel(conversation?: Conversation): string {
		const setting = conversation?.outputLanguage ?? this.settings.outputLanguage;
		return resolveLanguageLabel(setting, getObsidianLocale());
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
		onComplete: (fullText: string, tokenUsage?: TokenUsage, finish?: StreamFinish) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>,
		autoNotes: ReadonlySet<string> = new Set()
	): Promise<void> {
		this.abort();
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;

		let fullText = "";
		const startedAt = Date.now();
		let round = 0;

		try {
			const { userContent, systemPrompt, pdfAttachments } =
				await this.resolveUserContent(conversation, attachedNotes, newMessage, autoNotes);

			await this.prepareStream(conversation, userContent, systemPrompt, pdfAttachments, onToolCall);

			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let totalCacheReadTokens = 0;
			let totalCacheCreationTokens = 0;
			let receivedUsage = false;
			// Only the last round can be cut short: a truncated round has no tool
			// call to answer, so the loop ends on it.
			let truncated = false;

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
				truncated = result.truncated;

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
			// One line per turn with everything a slowness or cost report needs.
			debugLog(this.settings, `stream done (${Date.now() - startedAt}ms)`, {
				provider: this.providerType,
				model: conversation.model,
				rounds: round,
				chars: fullText.length,
				truncated,
				...(tokenUsage ?? {}),
			});
			onComplete(fullText, tokenUsage, { truncated });
		} catch (error) {
			debugLog(this.settings, `stream ended with error (${Date.now() - startedAt}ms)`, {
				provider: this.providerType,
				rounds: round,
				streamedChars: fullText.length,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			});
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
		newMessage: string,
		autoNotes: ReadonlySet<string> = new Set()
	): Promise<{ userContent: string; systemPrompt: string; pdfAttachments: PdfAttachment[] }> {
		const pdfPaths = attachedNotes.filter((p) => p.toLowerCase().endsWith(".pdf"));
		const notePaths = attachedNotes.filter((p) => !p.toLowerCase().endsWith(".pdf"));

		const [
			{ content: attachedContent, missingNotes, estimatedTokens, manualTokens },
			{ pdfs, missingPdfs, oversizedPdfs },
		] = await Promise.all([
			buildAttachedNotesContent(this.app, notePaths, newMessage, autoNotes),
			buildAttachedPdfs(this.app, pdfPaths),
		]);

		// Only ever warn about notes the USER attached (ADR-183). A vault-RAG path
		// can go missing because the index outlived the note — the user never chose
		// it, cannot remove it, and a warning about it is noise they can only ignore.
		const missingManual = missingNotes.filter((p) => !autoNotes.has(p));
		if (missingManual.length > 0) {
			new Notice(t("contextNotesWarning", { count: missingManual.length }));
		}
		const missingAuto = missingNotes.filter((p) => autoNotes.has(p));
		if (missingAuto.length > 0) {
			debugLog(this.settings, "vault RAG: retrieved note(s) no longer in the vault", { paths: missingAuto });
		}
		if (missingPdfs.length > 0) {
			new Notice(t("missingPdfsWarning", { count: missingPdfs.length }));
		}
		if (oversizedPdfs.length > 0) {
			new Notice(t("oversizedPdfWarning", { count: oversizedPdfs.length }));
		}

		// Measured on MANUAL notes only (ADR-184). ADR-183 said the attached-note
		// warnings are about what the user attached, but only the missing-note one
		// was filtered — so a conversation with no attached notes at all could fire
		// "attached notes are large" every turn, about notes it never chose.
		const noteTokenLimit = this.settings.maxAttachedNotesTokens;
		if (noteTokenLimit > 0 && manualTokens > noteTokenLimit) {
			new Notice(t("attachedNotesTokenWarning", { tokens: String(manualTokens) }));
		}
		if (estimatedTokens !== manualTokens) {
			debugLog(this.settings, "vault RAG: auto-retrieved note tokens", { total: estimatedTokens, manual: manualTokens });
		}

		// Pass whether note text is actually being inlined (manual context notes OR
		// vault-RAG auto-retrieved notes appended by the router) so the citation
		// instruction and the ADR-115 untrusted-content guard fire for retrieved
		// notes too, not only for notes stored on the conversation.
		const systemPrompt =
			buildSystemPrompt(conversation, this.settings.customInstructions, {
				hasAttachedNotes: attachedContent.length > 0,
				languageLabel: this.languageLabel(conversation),
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
			`Recap the substance of the discussion below so it stands on its own as a reminder of what was covered — and works as context if the discussion continues.\n\n${SUMMARY_RULES}${langInstruction(this.languageLabel(conversation))}\n\n${conversationText}`,
			1024
		);
	}

	async generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }> {
		const model = this.resolveModel(conversation.model);
		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : this.assistantLabel}: ${m.content}`)
			.join("\n\n");
		const lang = this.languageLabel(conversation);
		const sfx = langSuffix(lang);
		const raw = await this.callUtility(
			model,
			`Give this conversation a concise title and a brief summary.\n\nReply in EXACTLY this format — no other text before or after:\n${TITLE_MARKER}: <3-6 word title${sfx}, no punctuation, no quotes>\n${SUMMARY_MARKER}:\n<summary${sfx} here>\n\nFor the summary, recap the substance so it stands on its own:\n${SUMMARY_RULES}${langInstruction(lang)}\n\n${conversationText}`,
			1024
		);
		return parseTitleAndSummary(raw);
	}

	/** Define `term` as used in `passage` (ADR-136). Runs on the fast model with a
	 *  small token budget: this is a gloss, not an essay, and it is fetched while
	 *  the reader waits. `senseHint` is the reader's own correction when the first
	 *  answer defined the wrong sense (ADR-208) — it shapes this call and is not stored. */
	async defineTerm(
		term: string,
		passage: string,
		conversation?: Conversation,
		senseHint?: string,
	): Promise<string> {
		const prompt = defineTermPrompt(term, passage, this.languageLabel(conversation), senseHint);
		return this.callUtility(this.fastModel, prompt, 420);
	}

	/**
	 * Distil a forked conversation back into its term's note (ADR-208).
	 *
	 * Runs on the **conversation's** model, not `fastModel` — the fourth utility
	 * call to do so, and for the same reason as the three summary calls: it reads
	 * a whole conversation and has to hold on to what was actually settled in it.
	 * Which also means it meets reasoning models and their leading thinking
	 * blocks, and depends on `callUtility` collecting every text block (ADR-158).
	 */
	async summarizeTermDiscussion(term: string, definition: string, conversation: Conversation): Promise<string> {
		const model = this.resolveModel(conversation.model);
		const text = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : this.assistantLabel}: ${m.content}`)
			.join("\n\n");
		const prompt = termDiscussionPrompt(term, definition, text, this.languageLabel(conversation));
		// 1024, like `generateSummary`, and for its reason: lowering a cap does not
		// shorten an answer, it truncates one — and on a reasoning model this same
		// budget also pays for the hidden reasoning. The sentence count is the
		// contract; the cap is a safety valve (ADR-141).
		return this.callUtility(model, prompt, 1024);
	}

	/** Describe a person named in an answer (ADR-151). */
	async describePerson(name: string, passage: string, conversation?: Conversation): Promise<string> {
		return this.callUtility(this.fastModel, describePersonPrompt(name, passage, this.languageLabel(conversation)), 420);
	}

	/**
	 * Translate a stored glossary definition for display (ADR-166). `term` also
	 * asks for the term's own equivalent in that language (ADR-206); the caller
	 * caches both in the term note, so each definition is translated once per
	 * language and the form is recorded once.
	 */
	async translateDefinition(definition: string, language: string, term?: string): Promise<TranslatedDefinition> {
		const raw = await this.callUtility(
			this.fastModel,
			translateDefinitionPrompt(definition, language, term),
			term ? 560 : 500
		);
		// Without a term there are no markers to read — the reply IS the translation.
		return term ? parseTranslationReply(raw) : { definition: raw.trim(), term: "" };
	}

	async generateChapterName(content: string, conversation?: Conversation): Promise<string> {
		return cleanGeneratedTitle(await this.callUtility(this.fastModel, chapterNamePrompt(content, this.languageLabel(conversation)), 15));
	}

	async generateConversationTitle(userMessage: string, assistantMessage: string, conversation?: Conversation): Promise<string> {
		// "" on an empty reply, not a placeholder: the caller keeps the dated name
		// it already has, which says more than "New Conversation" would.
		const prompt = conversationTitlePrompt(userMessage, assistantMessage, this.languageLabel(conversation));
		return cleanGeneratedTitle(await this.callUtility(this.fastModel, prompt, 20));
	}

	/** Header ↻: a title for what the conversation is about now. "" = nothing to name, or no reply. */
	async retitleConversation(conversation: Conversation): Promise<string> {
		const digest = buildRetitleDigest(conversation);
		if (!digest) return "";
		return cleanGeneratedTitle(await this.callUtility(this.fastModel, retitlePrompt(digest, this.languageLabel(conversation)), 20));
	}

	async generateFavoritesSummary(conversation: Conversation): Promise<string> {
		const digest = buildFavoritesDigest(conversation);
		if (!digest) return "";
		const model = this.resolveModel(conversation.model);
		return this.callUtility(
			model,
			`The following are the highlights a user hand-picked from a conversation as its most important insights. Synthesize them into a learning aid that helps the user retain the knowledge and act on it.\n\nReply in Markdown, starting directly with the "## Key learnings" heading — no preamble:\n\n## Key learnings\nA bullet list that consolidates and deduplicates the insights across the highlights — group related points and stay grounded in the provided text. State each learning directly as a fact; do NOT phrase bullets as "The user highlighted…", "This note says…", or "The conversation covered…". Do not restate the highlights one by one.\n\n## Action items\nA list of concrete, actionable next steps derived from the highlights, each written as a checkbox: "- [ ] <action>". Only include actions the highlights actually support — if none are genuinely warranted, omit this section and its heading entirely.${langInstruction(this.languageLabel(conversation))}\n\n${digest}`,
			1536
		);
	}

	async summarizeNotes(content: string, conversation?: Conversation): Promise<string> {
		return this.callUtility(
			this.fastModel,
			`Summarize the following note(s) concisely. Focus on key topics, decisions, and insights.${langInstruction(this.languageLabel(conversation))}\n\n${content}`,
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
