import type { Conversation, ToolCall, TokenUsage } from "../models/types";

export interface LLMProvider {
	updateApiKey(key: string): void;
	abort(): void;
	streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void>;
	generateSummary(conversation: Conversation): Promise<string>;
	generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }>;
	generateFavoriteName(content: string): Promise<string>;
	generateChapterName(content: string): Promise<string>;
	generateConversationTitle(userMessage: string, assistantMessage: string): Promise<string>;
	summarizeNotes(content: string): Promise<string>;
}
