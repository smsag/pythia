import type { Conversation } from "../models/types";

export interface LLMProvider {
	updateApiKey(key: string): void;
	abort(): void;
	streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string) => void,
		onError: (error: Error) => void
	): Promise<void>;
	generateSummary(conversation: Conversation): Promise<string>;
	generateFavoriteName(content: string): Promise<string>;
}
