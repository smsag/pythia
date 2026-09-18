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
import { resolveDefaultModelForProvider } from "../models/knownModels";
import {
	TITLE_MARKER,
	SUMMARY_MARKER,
	DEFINITION_MARKER,
	VARIANTS_MARKER,
	TRANSLATIONS_MARKER,
	CONTEXT_MARKER,
} from "./promptConstants";
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

		// Only ever warn about notes the USER attached (ADR-180). A vault-RAG path
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

		// Measured on MANUAL notes only (ADR-181). ADR-180 said the attached-note
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
	async defineTerm(term: string, passage: string, conversation?: Conversation): Promise<string> {
		const excerpt = passage.slice(0, 1200);
		return this.callUtility(
			this.fastModel,
			`Define the term "${term}" as it is used in the passage below, and list its other surface forms.\n\n` +
				`Reply in EXACTLY this format — no other text before or after:\n` +
				`${DEFINITION_MARKER}:\n<two or three sentences>\n` +
				`${VARIANTS_MARKER}: <forms separated by | , or leave empty>\n` +
				`${TRANSLATIONS_MARKER}: <lang: term, separated by | , or leave empty>\n` +
				`${CONTEXT_MARKER}: <one sentence from the passage, or leave empty>\n\n` +
				`For the definition: explain the sense that applies here, not every possible meaning. ` +
				`Do not repeat the passage, do not add a heading, do not use the word "context".\n` +
				// ISO 704's rules for a terminological definition. They matter because
				// the definition is read away from this passage — in the glossary note,
				// or by another tool — where a circular or "is when" definition says
				// nothing at all (ADR-149).
				`Write it as a terminological definition: name the broader category the term belongs to and ` +
				`then what distinguishes it from others in that category, so that the definition could be ` +
				`substituted for the term in a sentence. Never define a term with itself or a word built ` +
				`from it, and never open with "is when", "is where" or "describes the fact that".\n` +
				`For the variants: the inflected forms of this term **in the same language** a reader would ` +
				`meet in running text (plural, genitive, dative, declined adjective forms), plus a common ` +
				`abbreviation or spelling variant if one exists. Forms only — never related concepts, never ` +
				`explanations, never a translation, and never a form so generic it would match unrelated ` +
				`sentences. Leave the line empty if there are none.\n` +
				`For the translations: the term's equivalent in any OTHER language the passage uses, each ` +
				`written as an ISO 639-1 code, a colon and the term ("en: counter"). Only languages actually ` +
				`present in the passage — never a translation you were not asked for. Leave the line empty ` +
				`if the passage is monolingual.\n` +
				`For the context: copy ONE short sentence or clause from the passage in which the term ` +
				`actually appears, verbatim and unedited. Leave the line empty if no single sentence shows ` +
				`it in use.` +
				`${this.definitionLanguage(conversation)}\n\nPassage:\n${excerpt}`,
			420
		);
	}

	/**
	 * Describe a person named in an answer (ADR-151).
	 *
	 * Deliberately different from `defineTerm` in one way that matters: the
	 * passage is the primary source and the model's own knowledge is the fallback,
	 * stated in that order, because a person is far more likely than a term to be
	 * someone the model has never heard of — a colleague, a client, a local
	 * counterparty. A model that leads with recall invents a plausible biography;
	 * one told to prefer the passage says what the conversation actually
	 * established. What it produces is stored as `source: model` either way, so
	 * the note never presents a generated claim as a recorded one.
	 */
	async describePerson(name: string, passage: string, conversation?: Conversation): Promise<string> {
		const excerpt = passage.slice(0, 1200);
		return this.callUtility(
			this.fastModel,
			`Who is "${name}", as referred to in the passage below?\n\n` +
				`Reply in EXACTLY this format — no other text before or after:\n` +
				`${DEFINITION_MARKER}:\n<two or three sentences>\n` +
				`${VARIANTS_MARKER}: <other names this person is called, separated by | , or leave empty>\n` +
				`${CONTEXT_MARKER}: <one sentence from the passage, or leave empty>\n\n` +
				`Use the passage first: say what it establishes about this person — their role, ` +
				`their relation to the subject, what they did. Only add what you independently know ` +
				`if you are confident it is the same person, and never pad the answer with generic ` +
				`description to reach three sentences.\n` +
				`If the passage does not make clear who this is and you do not recognise the name, ` +
				`say exactly that in one sentence rather than guessing — an invented biography is ` +
				`worse than an empty entry, because it will be read later as something that was recorded.\n` +
				`For the variants: other names the same person is called in running text — surname ` +
				`alone, given name alone, an initial form, a former name. Names only, never roles, ` +
				`and never a name so common it would match unrelated sentences.\n` +
				`For the context: copy ONE short sentence or clause from the passage naming this ` +
				`person, verbatim. Leave the line empty if none does.` +
				`${this.definitionLanguage(conversation)}\n\nPassage:\n${excerpt}`,
			420
		);
	}

	/**
	 * The language line for a definition or person entry (ADR-166).
	 *
	 * A named language is instructed exactly as every utility prompt does. AUTO
	 * is the one place this departs from ADR-148's "add no instruction": in a chat
	 * turn silence lets the model follow the user, but this prompt is written in
	 * English, so silence made the model answer in English whatever the passage
	 * said — and the note kept that English for good. Naming the passage keeps
	 * AUTO's meaning (follow the conversation) instead of inventing a language.
	 */
	private definitionLanguage(conversation?: Conversation): string {
		const label = this.languageLabel(conversation);
		return label
			? langInstruction(label)
			: "\n\nWrite the definition in the language the passage is written in.";
	}

	/**
	 * Translate a stored glossary definition for display (ADR-166).
	 *
	 * Exempt from `languageLabel`, like the prompt optimizer: the target language
	 * is the whole request. The result is cached in the term note by the caller,
	 * so each definition is translated once per language.
	 */
	async translateDefinition(definition: string, language: string): Promise<string> {
		return this.callUtility(
			this.fastModel,
			`Translate this glossary definition into ${language}. Keep its meaning and its precision: ` +
				`use the established ${language} terminology, and keep proper names, code and Markdown as they are. ` +
				`If it is already in ${language}, return it unchanged. ` +
				`Reply with the translation only — no preamble, no quotation marks.\n\nDefinition:\n${definition.slice(0, 2000)}`,
			500
		);
	}

	async generateChapterName(content: string, conversation?: Conversation): Promise<string> {
		const excerpt = content.slice(0, 500);
		return cleanGeneratedTitle(await this.callUtility(
			this.fastModel,
			`Summarize this user message in 3-5 words as a chapter title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(this.languageLabel(conversation))}\n\nMessage:\n${excerpt}`,
			15
		));
	}

	async generateConversationTitle(
		userMessage: string,
		assistantMessage: string,
		conversation?: Conversation
	): Promise<string> {
		const userExcerpt = userMessage.slice(0, 300);
		const assistantExcerpt = assistantMessage.slice(0, 300);
		// "" on an empty reply, not a placeholder: the caller keeps the dated name
		// it already has, which says more than "New Conversation" would.
		return cleanGeneratedTitle(await this.callUtility(
			this.fastModel,
			`Give this conversation a concise 3-5 word title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(this.languageLabel(conversation))}\n\nUser: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`,
			20
		));
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
