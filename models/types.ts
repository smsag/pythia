export type Provider = "anthropic" | "openai" | "mistral";

export type EffortLevel = "low" | "medium" | "high";
export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high"];

/**
 * The language Pythia answers in (ADR-148).
 *
 * Two of the values are resolved rather than named: "auto" adds no instruction
 * at all, leaving the model to follow the conversation, and "obsidian" follows
 * Obsidian's own UI locale — which can be any of the ~30 languages Obsidian
 * ships, not just the four offered explicitly.
 */
export type OutputLanguage = "obsidian" | "auto" | "de" | "en" | "it" | "es";

/** The order the language dropdowns render in, shared by the global setting and
 *  the per-conversation override so the two lists cannot drift apart. */
export const OUTPUT_LANGUAGES: OutputLanguage[] = ["obsidian", "auto", "de", "en", "it", "es"];

/** Which write tool the model gets (README → write_mode). `stage` writes no
 *  note: it fills the Ablage, Pythia's one-item clipboard (ADR-246). The ONE
 *  list — the template reader and data.json validation read it. */
export const WRITE_MODES = ["update", "create", "none", "rewrite", "stage", "all"] as const;
export type WriteMode = typeof WRITE_MODES[number];

export interface Conversation {
	id: string;
	name: string;
	createdAt: string;        // ISO 8601
	updatedAt: string;
	templateId?: string;      // vault path of the template used
	systemPrompt: string;     // resolved at creation time
	contextNotes: string[];   // vault paths of attached notes
	resumeMode: "full" | "summary" | "hybrid";
	/** The last message when the conversation was resumed in summary or hybrid
	 *  mode: the mode reduces only it and what came before (ADR-231). */
	resumedAfterId?: string;
	provider: Provider;       // which LLM provider to use
	model: string;            // model ID for the selected provider
	maxTokens?: number;       // override the default 4096 max-token limit
	temperature?: number;     // override the default sampling temperature (0–1)
	effort?: EffortLevel;     // override the default reasoning/output effort
	summaryText?: string;     // generated summary for resume-in-summary-mode
	summaryUpdatedAt?: string; // ISO 8601 timestamp of last summary generation
	summaryNote?: string;     // vault path to the human-readable summary note
	/** The last generated favorites synthesis. `favoriteIds` is the fingerprint of
	 *  the favorites it covered (`favoritesFingerprint`, ADR-255); absent on one
	 *  generated before it. */
	favoritesSummary?: { text: string; updatedAt: string; favoriteIds?: string };
	messages: Message[];
	favorites?: Favorite[];   // starred assistant messages
	savedNotePath?: string;           // vault path last saved to via save button
	lastSavedMessageCount?: number;   // messages.length at the time of last save
	merges?: MergeLink[];             // passages linked to another conversation (ADR-130)
	pins?: Pin[];                     // answer content pinned to the top of the chat (ADR-216)
	forkedFromId?: string;            // ID of the conversation this was forked from
	forkedFromMessageId?: string;     // ID of the source message within that conversation
	forkedFromSelection?: string;     // The text selected when the fork was created
	forkedFromOccurrenceIndex?: number; // which occurrence of the selection within the source message
	forkedFromSummary?: string;       // the source conversation's summary, carried as context (not this fork's own)
	/** A fork started from its source's favorites (ADR-255): a snapshot of the
	 *  source's favorites summary, sent with every turn. Never shadowed by this
	 *  conversation's own summary, and changed only by the user (↻ or ×). */
	forkedFromFavorites?: ForkedFavorites;
	outputFolder?: string;            // default folder for AI-created notes (resolved from template)
	writeMode?: WriteMode;
	/**
	 * The theme this conversation files its terms under (ADR-150).
	 *
	 * `undefined` means **follow the conversation name** — not a copy of the name,
	 * so renaming the conversation renames the theme with it. A fork resolves it
	 * to a concrete value, and setting it in the conversation settings pins it.
	 */
	theme?: string;
	/**
	 * The glossary entry this conversation was forked from, to work out what it
	 * means (ADR-208). Set only by that fork; it is what the header's "save to
	 * the term" row acts on, and what makes the row appear at all.
	 *
	 * The term as written, not a path: a note's file name is sanitized, and the
	 * lookup has to work for a person and a term that share a name.
	 */
	glossaryTerm?: string;
	/** Per-conversation override of the global `outputLanguage` setting (ADR-148).
	 *  Undefined → inherit the global default. */
	outputLanguage?: OutputLanguage;
	researchMode?: boolean;           // when true, expose the web_search tool + inject recency context
	vaultContext?: boolean;           // when true, auto-retrieve relevant vault notes per turn (ADR-116);
	                                  // undefined → fall back to the global vaultContextEnabled default
	/** A pending model comparison on the last exchange (ADR-160). While set, the
	 *  conversation ends with the user turn — the answers live here, not in
	 *  `messages` — and sending is blocked until one is kept. */
	comparison?: Comparison;
	/** The passage in a note this conversation is rewriting (ADR-178). Armed from
	 *  the editor, kept until it is applied or dismissed — a rewrite is iterated
	 *  ("shorter"), so unlike `pendingTemplate` it is not spent by one answer. */
	pendingRewrite?: RewriteTarget;
	/** A template applied to this running conversation, in force for the NEXT
	 *  answer only and then cleared (ADR-177). Nothing here is ever written onto
	 *  the conversation itself — see `services/pendingTemplate.ts`. */
	pendingTemplate?: PendingTemplate;
	/** The notes that link to this conversation through a note anchor (ADR-249):
	 *  recorded when Pythia writes one, or sees one in a note it opens. What the
	 *  history limit protects, and what an answer's footnote update writes to. */
	noteAnchors?: NoteAnchor[];
	/** Earlier answers are numbered for the model, which may cite them as
	 *  ⟦cite:answer:n⟧ (ADR-250). Set by a template's `cite_answers: true`;
	 *  only ever `true`. */
	citeAnswers?: true;
}

/**
 * One note that links to a conversation, or to one chapter of it, through an
 * `obsidian://pythia?cmd=resume&id=…[&msg=…]` link (ADR-249). A record of what
 * Pythia saw in the note, reconciled whenever it reads the note again — never
 * the link itself, which lives in the note.
 */
export interface NoteAnchor {
	/** Vault path of the note holding the link — follows a rename. */
	path: string;
	/** The chapter (a user message) the link points at; absent = the conversation. */
	messageId?: string;
	createdAt: string;        // ISO 8601
}

/**
 * A short summary of one chapter — a user message and the answer it got —
 * written for the note anchors that point at it (ADR-249). A SNAPSHOT, like a
 * message's cost: `fingerprint` is the chapter it was written from, so a retry
 * or an edit makes it outdated rather than silently wrong.
 */
export interface ChapterSummary {
	text: string;
	/** `chapterFingerprint` of the chapter when the summary was written. */
	fingerprint: string;
	/** ISO 639-1 code of the summary's language, when it could be detected. */
	language?: string;
	createdAt: string;        // ISO 8601
}

/**
 * A template armed for one turn: everything the send needs, snapshotted at the
 * moment it was applied.
 *
 * A snapshot rather than the template's path, for the same reason a message
 * keeps its own cost (ADR-163): an edit to the template file between arming and
 * sending must not change the turn under the user.
 */
export interface PendingTemplate {
	/** Vault path of the template — what the answer records as its `templateId`. */
	id: string;
	name: string;
	systemPrompt: string;
	provider?: Provider;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	effort?: EffortLevel;
	writeMode?: Conversation["writeMode"];
	outputFolder?: string;
	contextNotes?: string[];
	/** The template's `cite_answers` (ADR-250), for this one answer. */
	citeAnswers?: true;
}

/**
 * One answer in a model comparison (ADR-160): the same prompt, run on one
 * model. Candidate 0 is always the answer the conversation already had.
 */
export interface ComparisonCandidate {
	id: string;               // becomes the Message id when kept; stays its id as an alternative tab (ADR-219)
	provider: Provider;
	model: string;
	content: string;
	timestamp: string;        // ISO 8601
	tokenUsage?: TokenUsage;
	sources?: MessageSource[];
	templateId?: string;
	/** Carried through a comparison so the original answer's price snapshot and
	 *  its note-write chip survive start → keep/cancel (ADR-219). */
	cost?: MessageCost;
	noteWrites?: NoteWrite[];
	/** Carried like the two above, so a switch between tabs keeps a cut-off
	 *  answer's Continue card and a rewrite proposal's target (ADR-225). */
	truncated?: true;
	rewriteTarget?: RewriteTarget;
}

/** The pending comparison on a conversation's last exchange (ADR-160). */
export interface Comparison {
	id: string;
	userMessageId: string;    // the prompt every candidate answered
	candidates: ComparisonCandidate[];
	createdAt: string;        // ISO 8601
	/** The tabs the answer already had when this comparison opened (ADR-219) —
	 *  what Discard puts back, so a new run discarded is not kept by accident. */
	priorAlternativeIds?: string[];
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	/** Anthropic prompt-caching stats (debugMode-only visibility; omitted when zero). */
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
}

/** A position in a note, as Obsidian's editor reports one. */
export interface EditorPos { line: number; ch: number; }

/**
 * The passage a rewrite replaces (ADR-178): a captured range **plus the text
 * that was in it**, so the write can be verified before it happens. The rule
 * that verifies it is `services/rewriteTarget.ts`.
 */
export interface RewriteTarget {
	/** Vault path of the note the passage lives in. */
	path: string;
	from: EditorPos;
	to: EditorPos;
	/** The passage as it read when the target was captured. */
	text: string;
}

/** A citation source parsed from an assistant message's ⟦cite:…⟧ markers.
 *  Shape matches services/citations.ts CitationSource. */
export interface MessageSource {
	n: number;                // 1-based, in order of first appearance
	/** `answer`: an earlier answer of this conversation the model cited (ADR-250). */
	kind: "vault" | "web" | "answer";
	ref: string;              // vault path, a web page's full URL (a bare domain before ADR-226), or an answer's message id
	title: string;            // display label
	/** What the ⟦cite:web:…⟧ marker in the text said — a result number or a
	 *  domain — when it differs from `ref`. The chip is found by it (ADR-226). */
	cite?: string;
}

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: string;        // ISO 8601
	model?: string;           // model ID that generated this assistant message (for the turn label)
	attachedNotes?: string[]; // notes attached to this specific message
	tokenUsage?: TokenUsage;  // token counts for assistant messages
	sources?: MessageSource[]; // parsed citation sources (assistant messages, from ⟦cite:…⟧ markers)
	chapterName?: string;     // 3-5 word LLM-generated title for user messages
	/** User messages only: the chapter's summary for note anchors (ADR-249). */
	chapterSummary?: ChapterSummary;
	templateId?: string;      // vault path of the template active when this answer was produced
	/** Set when this answer is a proposed rewrite of a passage (ADR-178): the
	 *  card under it can apply the answer over that range, verifying first. */
	rewriteTarget?: RewriteTarget;
	/** The provider stopped at the max-tokens cap: the answer ends where the
	 *  budget ended, not where the model did (ADR-162). Only ever `true`. */
	truncated?: true;
	/** The estimated price at generation time (ADR-163): the list prices in
	 *  force when the call was made, which is the closest thing to the invoice.
	 *  Later table updates never rewrite it; legacy messages without it are
	 *  priced live from the current table. */
	cost?: MessageCost;
	/** The notes this answer wrote through a tool, confirmed by the user. What
	 *  the "✓ Created" chip under the answer is drawn from, so it survives a
	 *  reload; the path follows a rename (`renameVaultPath`). */
	noteWrites?: NoteWrite[];
	/** The other answers to the same prompt, kept from a model comparison as
	 *  tabs on this answer (ADR-219). Viewable, switchable while this is the last
	 *  answer — and NEVER sent to a model: history is `content` alone. */
	alternatives?: ComparisonCandidate[];
}

/** One note an answer wrote. `path` is the path the vault reported. */
export interface NoteWrite {
	path: string;
	action: "created" | "rewritten" | "prepended";
}

/** A cost snapshot: USD and the as-of date of the table that priced it. */
export interface MessageCost {
	usd: number;
	asOf: string;
}

/** How a stream ended, beyond its text (ADR-162). `truncated` is the one fact
 *  the user cannot see in the text itself: a reply cut at the token cap reads
 *  exactly like a finished one. */
export interface StreamFinish {
	truncated: boolean;
}

/** What a fork from favorites carries (ADR-255) — validated by `sanitizeForkedFavorites`. */
export interface ForkedFavorites {
	/** The source's favorites summary as it was when taken. */
	text: string;
	/** The source summary's `updatedAt` when taken — a newer one offers ↻. */
	sourceUpdatedAt: string;
	/** How many favorites the source held when taken (the banner's count). */
	favoriteCount: number;
}

export interface Favorite {
	id: string;               // unique per favorite (crypto.randomUUID)
	messageId: string;        // refers to Message.id — the message the highlight lives in
	name: string;             // short label shown in the navigator (first words of `text`)
	text?: string;            // exact selected text; drives re-highlight, re-find and label.
	                          // Absent for legacy message-level favorites (pre-highlight feature).
	occurrenceIndex?: number; // which occurrence of `text` within the message (disambiguates
	                          // duplicate spans). Absent for legacy favorites.
	createdAt?: string;       // ISO 8601 — when the favorite was created
}

/**
 * A merge link — the inverse of a fork (ADR-130). A fork carries a passage OUT of
 * a conversation into a new one; a merge points a passage AT an existing
 * conversation, surfacing that conversation's summary where the passage sits.
 *
 * Stored on the conversation that holds the passage, so the link paints wherever
 * the passage is read. It is a reading/navigation aid only: nothing about a merge
 * reaches the model — `ContextBuilder` never injects a merged conversation's
 * summary into the system prompt.
 */
export interface MergeLink {
	id: string;               // unique per link (crypto.randomUUID)
	conversationId: string;   // the merged-in conversation (the summary shown at the passage)
	messageId: string;        // refers to Message.id — the assistant message the passage lives in
	text: string;             // exact selected text (trimmed); drives re-highlight and re-find
	occurrenceIndex?: number; // which occurrence of `text` within the message
	createdAt: string;        // ISO 8601
}

/** What was pinned — the kind decides how the pin draws its `source` (ADR-216). */
export type PinKind = "text" | "code" | "diagram" | "chart" | "table";
export const PIN_KINDS: readonly PinKind[] = ["text", "code", "diagram", "chart", "table"];

/**
 * A piece of an answer pinned to the top of the conversation (ADR-216).
 *
 * A SNAPSHOT, not a reference: `source` is what Copy would have copied at the
 * moment of pinning — the selected text, a fenced code or diagram block, a
 * ```pythia-chart block, a Markdown table. So a pin survives a re-render, a
 * retry, the deletion of its exchange; `messageId` is only where ↗ jumps back
 * to, and a pin whose message is gone says so. A pin never reaches the model.
 */
export interface Pin {
	id: string;               // unique per pin (crypto.randomUUID)
	messageId: string;        // the assistant message it came from — the jump target
	kind: PinKind;
	source: string;           // the snapshot
	occurrenceIndex?: number; // text pins: which occurrence of `source` in the message
	createdAt: string;        // ISO 8601
}

export interface PythiaTemplate {
	id: string;               // vault path of the template file
	name: string;
	provider?: Provider;      // override default provider
	model?: string;
	maxTokens?: number;
	temperature?: number;
	effort?: EffortLevel;
	contextNotes: string[];
	resumeMode?: "full" | "summary" | "hybrid";
	outputFolder?: string;    // "." = same folder as the active note at creation time
	writeMode?: WriteMode;
	researchMode?: boolean;   // preset the web_search research toggle for new conversations
	rewritePreset?: boolean;  // `rewrite_preset: true` — offered in "Rewrite with Pythia as…" (ADR-247)
	citeAnswers?: boolean;    // `cite_answers: true` — earlier answers are numbered and citable (ADR-250)
	autoPrompt?: string;      // message auto-sent when the conversation opens
	systemPrompt: string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export class ToolCancelledError extends Error {
	constructor() {
		super("Tool call cancelled by user");
		this.name = "ToolCancelledError";
	}
}

export class ToolLoopLimitError extends Error {
	constructor() {
		super("Tool call loop exceeded the round limit");
		this.name = "ToolLoopLimitError";
	}
}
