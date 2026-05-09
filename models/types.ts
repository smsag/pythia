export type Provider = "anthropic" | "openai";

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
	summaryText?: string;     // generated summary for resume-in-summary-mode
	summaryNote?: string;     // vault path to the human-readable summary note
	messages: Message[];
	favorites?: Favorite[];   // starred assistant messages
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
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
	contextNotes: string[];
	resumeMode?: "full" | "summary";
	outputFolder?: string;
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
