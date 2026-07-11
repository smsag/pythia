export type Provider = "anthropic" | "openai";

export type EffortLevel = "low" | "medium" | "high";
export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high"];

export interface Conversation {
	id: string;
	name: string;
	createdAt: string;        // ISO 8601
	updatedAt: string;
	templateId?: string;      // vault path of the template used
	systemPrompt: string;     // resolved at creation time
	contextNotes: string[];   // vault paths of attached notes
	resumeMode: "full" | "summary";
	provider: Provider;       // which LLM provider to use
	model: string;            // model ID for the selected provider
	maxTokens?: number;       // override the default 4096 max-token limit
	temperature?: number;     // override the default sampling temperature (0–1)
	effort?: EffortLevel;     // override the default reasoning/output effort
	summaryText?: string;     // generated summary for resume-in-summary-mode
	summaryUpdatedAt?: string; // ISO 8601 timestamp of last summary generation
	summaryNote?: string;     // vault path to the human-readable summary note
	messages: Message[];
	favorites?: Favorite[];   // starred assistant messages
	savedNotePath?: string;           // vault path last saved to via save button
	lastSavedMessageCount?: number;   // messages.length at the time of last save
	forkedFromId?: string;            // ID of the conversation this was forked from
	forkedFromMessageId?: string;     // ID of the source message within that conversation
	forkedFromSelection?: string;     // The text selected when the fork was created
	outputFolder?: string;            // default folder for AI-created notes (resolved from template)
	writeMode?: "update" | "create" | "none" | "rewrite" | "all";
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	/** Anthropic prompt-caching stats (debugMode-only visibility; omitted when zero). */
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
}

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: string;        // ISO 8601
	attachedNotes?: string[]; // notes attached to this specific message
	tokenUsage?: TokenUsage;  // token counts for assistant messages
	chapterName?: string;     // 3-5 word LLM-generated title for user messages
}

export interface Favorite {
	messageId: string;  // refers to Message.id
	name: string;       // LLM-generated short title
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
	resumeMode?: "full" | "summary";
	outputFolder?: string;    // "." = same folder as the active note at creation time
	writeMode?: "update" | "create" | "none" | "rewrite" | "all";
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
