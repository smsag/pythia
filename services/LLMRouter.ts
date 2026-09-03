import type { Conversation, Provider, ToolCall, TokenUsage } from "../models/types";
import type { LLMProvider } from "./LLMProvider";
import type { AnthropicService } from "./AnthropicService";
import type { OpenAIProvider } from "./OpenAIProvider";
import type { MistralService } from "./MistralService";
import type { PythiaSettings } from "../settings";

export class LLMRouter {
	private providers: Record<Provider, LLMProvider>;

	/** Optional vault-RAG hook (ADR-116). When set, it is consulted before each
	 *  streamed turn to auto-retrieve relevant vault notes, which are merged into
	 *  the attached-notes list. The hook owns its own gating (returns [] when the
	 *  feature is off) so the router stays provider- and settings-agnostic. */
	private vaultRetriever?: (
		conversation: Conversation,
		query: string,
		exclude: string[]
	) => Promise<string[]>;

	constructor(
		anthropic: AnthropicService,
		openai: OpenAIProvider,
		mistral: MistralService
	) {
		this.providers = { anthropic, openai, mistral };
	}

	/** Install (or clear) the vault-RAG retrieval hook. */
	setVaultRetriever(
		fn?: (conversation: Conversation, query: string, exclude: string[]) => Promise<string[]>
	): void {
		this.vaultRetriever = fn;
	}

	private get(conversation: Conversation): LLMProvider {
		// Legacy conversations without a provider field default to anthropic
		return this.byProvider(conversation.provider);
	}

	/** Resolve a provider instance, defaulting a missing/legacy provider to
	 *  anthropic. Legacy conversations predate the `provider` field, so a raw
	 *  `this.providers[undefined]` would be undefined and throw at the call site
	 *  (the failure was previously only swallowed by callers' catch blocks). */
	private byProvider(provider: Provider | undefined): LLMProvider {
		return this.providers[provider ?? "anthropic"];
	}

	updateSettings(settings: PythiaSettings): void {
		for (const p of Object.values(this.providers)) p.updateSettings(settings);
	}

	updateApiKey(provider: Provider, key: string): void {
		this.providers[provider].updateApiKey(key);
	}

	abort(): void {
		for (const p of Object.values(this.providers)) p.abort();
	}

	async streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		// Vault-RAG augmentation (ADR-116): fail-open — a retrieval error must never
		// block the turn, so fall back to just the manually-attached notes.
		let notes = attachedNotes;
		if (this.vaultRetriever) {
			try {
				const extra = await this.vaultRetriever(conversation, newMessage, attachedNotes);
				if (extra.length > 0) {
					const seen = new Set(attachedNotes);
					notes = [...attachedNotes, ...extra.filter((p) => !seen.has(p))];
				}
			} catch {
				notes = attachedNotes;
			}
		}
		return this.get(conversation).streamMessage(
			conversation,
			newMessage,
			notes,
			onToken,
			onComplete,
			onError,
			onToolCall
		);
	}

	generateSummary(conversation: Conversation): Promise<string> {
		return this.get(conversation).generateSummary(conversation);
	}

	generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }> {
		return this.get(conversation).generateSummaryWithTitle(conversation);
	}

	generateFavoritesSummary(conversation: Conversation): Promise<string> {
		return this.get(conversation).generateFavoritesSummary(conversation);
	}

	generateChapterName(content: string, provider: Provider): Promise<string> {
		return this.byProvider(provider).generateChapterName(content);
	}

	generateConversationTitle(userMessage: string, assistantMessage: string, provider: Provider): Promise<string> {
		return this.byProvider(provider).generateConversationTitle(userMessage, assistantMessage);
	}

	summarizeNotes(content: string, provider: Provider): Promise<string> {
		return this.byProvider(provider).summarizeNotes(content);
	}

	optimizePrompt(systemPrompt: string, userMessage: string, provider: Provider, model?: string): Promise<string> {
		return this.byProvider(provider).optimizePrompt(systemPrompt, userMessage, model);
	}
}
