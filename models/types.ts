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

export interface Conversation {
	id: string;
	name: string;
	createdAt: string;        // ISO 8601
	updatedAt: string;
	templateId?: string;      // vault path of the template used
	systemPrompt: string;     // resolved at creation time
	contextNotes: string[];   // vault paths of attached notes
	resumeMode: "full" | "summary" | "hybrid";
	provider: Provider;       // which LLM provider to use
	model: string;            // model ID for the selected provider
	maxTokens?: number;       // override the default 4096 max-token limit
	temperature?: number;     // override the default sampling temperature (0–1)
	effort?: EffortLevel;     // override the default reasoning/output effort
	summaryText?: string;     // generated summary for resume-in-summary-mode
	summaryUpdatedAt?: string; // ISO 8601 timestamp of last summary generation
	summaryNote?: string;     // vault path to the human-readable summary note
	favoritesSummary?: { text: string; updatedAt: string }; // last generated favorites synthesis
	messages: Message[];
	favorites?: Favorite[];   // starred assistant messages
	savedNotePath?: string;           // vault path last saved to via save button
	lastSavedMessageCount?: number;   // messages.length at the time of last save
	merges?: MergeLink[];             // passages linked to another conversation (ADR-130)
	forkedFromId?: string;            // ID of the conversation this was forked from
	forkedFromMessageId?: string;     // ID of the source message within that conversation
	forkedFromSelection?: string;     // The text selected when the fork was created
	forkedFromOccurrenceIndex?: number; // which occurrence of the selection within the source message
	forkedFromSummary?: string;       // the source conversation's summary, carried as context (not this fork's own)
	outputFolder?: string;            // default folder for AI-created notes (resolved from template)
	writeMode?: "update" | "create" | "none" | "rewrite" | "all";
	/**
	 * The theme this conversation files its terms under (ADR-150).
	 *
	 * `undefined` means **follow the conversation name** — not a copy of the name,
	 * so renaming the conversation renames the theme with it. A fork resolves it
	 * to a concrete value, and setting it in the conversation settings pins it.
	 */
	theme?: string;
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
	/** A template applied to this running conversation, in force for the NEXT
	 *  answer only and then cleared (ADR-177). Nothing here is ever written onto
	 *  the conversation itself — see `services/pendingTemplate.ts`. */
	pendingTemplate?: PendingTemplate;
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
}

/**
 * One answer in a model comparison (ADR-160): the same prompt, run on one
 * model. Candidate 0 is always the answer the conversation already had.
 */
export interface ComparisonCandidate {
	id: string;               // becomes the Message id when kept (or the fork's assistant message id)
	provider: Provider;
	model: string;
	content: string;
	timestamp: string;        // ISO 8601
	tokenUsage?: TokenUsage;
	sources?: MessageSource[];
	templateId?: string;
}

/** The pending comparison on a conversation's last exchange (ADR-160). */
export interface Comparison {
	id: string;
	userMessageId: string;    // the prompt every candidate answered
	candidates: ComparisonCandidate[];
	createdAt: string;        // ISO 8601
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	/** Anthropic prompt-caching stats (debugMode-only visibility; omitted when zero). */
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
}

/** A citation source parsed from an assistant message's ⟦cite:…⟧ markers.
 *  Shape matches services/citations.ts CitationSource. */
export interface MessageSource {
	n: number;                // 1-based, in order of first appearance
	kind: "vault" | "web";
	ref: string;              // vault path or web domain
	title: string;            // display label
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
	templateId?: string;      // vault path of the template active when this answer was produced
	/** The provider stopped at the max-tokens cap: the answer ends where the
	 *  budget ended, not where the model did (ADR-162). Only ever `true`. */
	truncated?: true;
	/** The estimated price at generation time (ADR-163): the list prices in
	 *  force when the call was made, which is the closest thing to the invoice.
	 *  Later table updates never rewrite it; legacy messages without it are
	 *  priced live from the current table. */
	cost?: MessageCost;
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
	writeMode?: "update" | "create" | "none" | "rewrite" | "all";
	researchMode?: boolean;   // preset the web_search research toggle for new conversations
	autoPrompt?: string;      // message auto-sent when the conversation opens
	systemPrompt: string;
}

export interface PluginData {
	settings: Record<string, unknown>;
	conversations: Conversation[];
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
