import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";

export interface LLMProvider {
	updateSettings(settings: PythiaSettings): void;
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
	generateChapterName(content: string): Promise<string>;
	generateConversationTitle(userMessage: string, assistantMessage: string): Promise<string>;
	summarizeNotes(content: string): Promise<string>;
	optimizePrompt(systemPrompt: string, userMessage: string, model?: string): Promise<string>;
}
