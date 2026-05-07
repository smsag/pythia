import type { Conversation, Provider, TokenUsage } from "../models/types";
import type { LLMProvider } from "./LLMProvider";
import type { AnthropicService } from "./AnthropicService";
import type { OpenAIProvider } from "./OpenAIProvider";

export class LLMRouter {
	private providers: Record<Provider, LLMProvider>;

	constructor(
		anthropic: AnthropicService,
		openai: OpenAIProvider
	) {
		this.providers = { anthropic, openai };
	}

	private get(conversation: Conversation): LLMProvider {
		// Legacy conversations without a provider field default to anthropic
		return this.providers[conversation.provider ?? "anthropic"];
	}

	updateApiKey(provider: Provider, key: string): void {
		this.providers[provider].updateApiKey(key);
	}

	abort(): void {
		for (const p of Object.values(this.providers)) p.abort();
	}

	streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void
	): Promise<void> {
		return this.get(conversation).streamMessage(
			conversation,
			newMessage,
			attachedNotes,
			onToken,
			onComplete,
			onError
		);
	}

	generateSummary(conversation: Conversation): Promise<string> {
		return this.get(conversation).generateSummary(conversation);
	}

	generateFavoriteName(content: string, provider: Provider): Promise<string> {
		return this.providers[provider].generateFavoriteName(content);
	}
}
