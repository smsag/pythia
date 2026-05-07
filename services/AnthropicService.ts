import Anthropic from "@anthropic-ai/sdk";
import { App } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";

type ApiMessage = { role: "user" | "assistant"; content: string };

/** Ensure roles alternate and the array starts with 'user', as the API requires. */
function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
	const result: ApiMessage[] = [];
	for (const msg of messages) {
		if (result.length > 0 && result[result.length - 1].role === msg.role) {
			result[result.length - 1].content += "\n\n" + msg.content;
		} else {
			result.push({ ...msg });
		}
	}
	while (result.length > 0 && result[0].role !== "user") {
		result.shift();
	}
	return result;
}

export class AnthropicService implements LLMProvider {
	private app: App;
	private settings: PythiaSettings;
	private apiKey = "";
	private client: Anthropic | null = null;
	private abortController: AbortController | null = null;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		this.app = app;
		this.settings = settings;
		this.apiKey = apiKey;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
		this.client = null;
	}

	updateApiKey(apiKey: string): void {
		this.apiKey = apiKey;
		this.client = null;
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	private getClient(): Anthropic {
		if (!this.apiKey) {
			throw new Error(
				"Anthropic API key not configured. Set it in Settings → Pythia."
			);
		}
		if (!this.client) {
			this.client = new Anthropic({
				apiKey: this.apiKey,
				dangerouslyAllowBrowser: true,
			});
		}
		return this.client;
	}

	async streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string) => void,
		onError: (error: Error) => void
	): Promise<void> {
		this.abort();
		this.abortController = new AbortController();

		let fullText = "";

		try {
			const attachedContent = await buildAttachedNotesContent(this.app, attachedNotes);
			const userContent = newMessage + attachedContent;
			const systemPrompt = await buildSystemPrompt(this.app, conversation);

			const historyMessages: ApiMessage[] = conversation.messages.map(
				(m) => ({ role: m.role, content: m.content })
			);

			const apiMessages = normalizeMessages([
				...historyMessages,
				{ role: "user" as const, content: userContent },
			]);

			const model = conversation.model || this.settings.defaultAnthropicModel;
			const maxTokens = 4096;

			if (this.settings.debugMode) {
				console.log("[Pythia] Anthropic API call →", {
					model,
					messages: apiMessages.length,
					systemPromptChars: systemPrompt.length,
				});
			}

			const stream = this.getClient().messages.stream(
				{
					model,
					max_tokens: maxTokens,
					...(systemPrompt ? { system: systemPrompt } : {}),
					messages: apiMessages,
				},
				{ signal: this.abortController.signal }
			);

			stream.on("text", (text) => {
				fullText += text;
				onToken(text);
			});

			await stream.finalMessage();
			onComplete(fullText);
		} catch (error) {
			const isAbort =
				error instanceof Error &&
				(error.name === "AbortError" ||
					error.name === "APIUserAbortError");
			if (isAbort) {
				onComplete(fullText);
			} else {
				onError(
					error instanceof Error ? error : new Error(String(error))
				);
			}
		} finally {
			this.abortController = null;
		}
	}

	async generateSummary(conversation: Conversation): Promise<string> {
		const client = this.getClient();
		const model = conversation.model || this.settings.defaultAnthropicModel;

		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.content}`)
			.join("\n\n");

		const response = await client.messages.create({
			model,
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: `Provide a concise summary of this conversation for future reference. Include: key decisions made, main topics discussed, and any important outputs or conclusions. Be brief — this will be used as context when the conversation is resumed.\n\n${conversationText}`,
				},
			],
		});

		const block = response.content[0];
		return block.type === "text" ? block.text : "";
	}
}
