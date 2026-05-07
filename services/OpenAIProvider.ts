import OpenAI from "openai";
import { App } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Models that do not support a `system` role message.
 * For these, the system prompt is injected as the first `user` message.
 */
const NO_SYSTEM_ROLE_MODELS = new Set(["o3", "o3-mini", "o1", "o1-mini"]);

function normalizeMessages(messages: OAIMessage[]): OAIMessage[] {
	const result: OAIMessage[] = [];
	for (const msg of messages) {
		if (result.length > 0 && result[result.length - 1].role === msg.role) {
			result[result.length - 1].content += "\n\n" + msg.content;
		} else {
			result.push({ ...msg });
		}
	}
	// First message must be user (after optional system)
	while (
		result.length > 0 &&
		result[0].role === "assistant"
	) {
		result.shift();
	}
	return result;
}

export class OpenAIProvider implements LLMProvider {
	private app: App;
	private settings: PythiaSettings;
	private apiKey = "";
	private client: OpenAI | null = null;
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

	private getClient(): OpenAI {
		if (!this.apiKey) {
			throw new Error(
				"OpenAI API key not configured. Set it in Settings → Pythia."
			);
		}
		if (!this.client) {
			this.client = new OpenAI({
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

			const model = conversation.model || this.settings.defaultOpenAIModel;
			const noSystemRole = NO_SYSTEM_ROLE_MODELS.has(model);

			const historyMessages: OAIMessage[] = conversation.messages.map(
				(m) => ({ role: m.role as "user" | "assistant", content: m.content })
			);

			let apiMessages: OAIMessage[];

			if (systemPrompt && noSystemRole) {
				// Inject system prompt as first user message for models that don't support system role
				apiMessages = normalizeMessages([
					{ role: "user", content: `[System instructions]\n${systemPrompt}` },
					...historyMessages,
					{ role: "user", content: userContent },
				]);
			} else if (systemPrompt) {
				apiMessages = [
					{ role: "system", content: systemPrompt },
					...normalizeMessages([
						...historyMessages,
						{ role: "user", content: userContent },
					]),
				];
			} else {
				apiMessages = normalizeMessages([
					...historyMessages,
					{ role: "user", content: userContent },
				]);
			}

			if (this.settings.debugMode) {
				console.log("[Pythia] OpenAI API call →", {
					model,
					messages: apiMessages.length,
					systemPromptChars: systemPrompt.length,
					noSystemRole,
				});
			}

			const stream = await this.getClient().chat.completions.create(
				{
					model,
					max_tokens: 4096,
					messages: apiMessages,
					stream: true,
				},
				{ signal: this.abortController.signal }
			);

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta?.content ?? "";
				if (delta) {
					fullText += delta;
					onToken(delta);
				}
			}

			onComplete(fullText);
		} catch (error) {
			const isAbort =
				error instanceof Error && error.name === "AbortError";
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
		const model = conversation.model || this.settings.defaultOpenAIModel;

		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
			.join("\n\n");

		const response = await client.chat.completions.create({
			model,
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: `Provide a concise summary of this conversation for future reference. Include: key decisions made, main topics discussed, and any important outputs or conclusions. Be brief — this will be used as context when the conversation is resumed.\n\n${conversationText}`,
				},
			],
		});

		return response.choices[0]?.message?.content ?? "";
	}
}
