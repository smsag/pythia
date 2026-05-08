import OpenAI from "openai";
import { App, Notice } from "obsidian";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";
import { getToolDefinitions } from "./ToolHandler";

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
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		this.abort();
		this.abortController = new AbortController();

		let fullText = "";

		try {
			const { content: attachedContent, missingNotes: missingAttached } =
				await buildAttachedNotesContent(this.app, attachedNotes);
			const userContent = newMessage + attachedContent;
			const { prompt: systemPrompt, missingNotes: missingContext } =
				await buildSystemPrompt(this.app, conversation);

			const allMissing = [...missingAttached, ...missingContext];
			if (allMissing.length > 0) {
				new Notice(
					`Warning: ${allMissing.length} context note(s) not found and were skipped.`
				);
			}

			const model = conversation.model || this.settings.defaultOpenAIModel;
			const noSystemRole = NO_SYSTEM_ROLE_MODELS.has(model);

			// Exclude the last message — it was just pushed by the caller before
			// invoking streamMessage, so we must not include it in history or it
			// would be sent twice (once in the history, once as the new message).
			const historyMessages: OAIMessage[] = conversation.messages.slice(0, -1).map(
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
					tools: !!onToolCall,
				});
			}

			// Mutable message array for the tool-use loop
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const loopMessages: any[] = [...apiMessages];

			// Map tool definitions to OpenAI function tool format
			const openaiTools = onToolCall
				? getToolDefinitions(this.settings.scratchFolder).map((def) => ({
						type: "function" as const,
						function: {
							name: def.name,
							description: def.description,
							parameters: def.inputSchema,
						},
				  }))
				: undefined;

			let lastTokenUsage: TokenUsage | undefined;

			while (true) {
				const stream = await this.getClient().chat.completions.create(
					{
						model,
						max_tokens: 4096,
						messages: loopMessages,
						stream: true,
						stream_options: { include_usage: true },
						...(openaiTools ? { tools: openaiTools } : {}),
					},
					{ signal: this.abortController.signal }
				);

				let finishReason: string | null = null;
				const pendingCalls: Array<{ id: string; name: string; arguments: string }> = [];

				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta;
					if (delta?.content) {
						fullText += delta.content;
						onToken(delta.content);
					}
					// Accumulate streaming tool call fragments
					if (delta?.tool_calls) {
						for (const tc of delta.tool_calls) {
							const idx = tc.index ?? 0;
							if (!pendingCalls[idx]) {
								pendingCalls[idx] = { id: "", name: "", arguments: "" };
							}
							if (tc.id) pendingCalls[idx].id = tc.id;
							if (tc.function?.name) pendingCalls[idx].name += tc.function.name;
							if (tc.function?.arguments) pendingCalls[idx].arguments += tc.function.arguments;
						}
					}
					if (chunk.choices[0]?.finish_reason) {
						finishReason = chunk.choices[0].finish_reason;
					}
					if (chunk.usage) {
						lastTokenUsage = {
							inputTokens: chunk.usage.prompt_tokens,
							outputTokens: chunk.usage.completion_tokens,
						};
					}
				}

				if (finishReason === "tool_calls" && onToolCall && pendingCalls.length > 0) {
					const calls = pendingCalls.filter(Boolean);
					// Push assistant message with its tool_calls
					loopMessages.push({
						role: "assistant",
						content: null,
						tool_calls: calls.map((tc) => ({
							id: tc.id,
							type: "function",
							function: { name: tc.name, arguments: tc.arguments },
						})),
					});
					// Execute each tool and push result messages
					for (const tc of calls) {
						let parsedInput: Record<string, unknown>;
						try {
							parsedInput = JSON.parse(tc.arguments) as Record<string, unknown>;
						} catch {
							parsedInput = {};
						}
						const result = await onToolCall({
							id: tc.id,
							name: tc.name,
							input: parsedInput,
						});
						loopMessages.push({
							role: "tool",
							tool_call_id: tc.id,
							content: result,
						});
					}
					// Continue loop for the model's response to tool results
				} else {
					break;
				}
			}

			onComplete(fullText, lastTokenUsage);
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

	async generateFavoriteName(content: string): Promise<string> {
		const client = this.getClient();
		const excerpt = content.slice(0, 500);
		const response = await client.chat.completions.create({
			model: "gpt-4o-mini",
			max_tokens: 20,
			messages: [{
				role: "user",
				content: `Give this assistant response a concise 2-5 word title capturing its key topic. Reply with ONLY the title, no punctuation, no quotes.\n\nResponse:\n${excerpt}`,
			}],
		});
		return response.choices[0]?.message?.content?.trim() ?? "Starred message";
	}

	async generateConversationTitle(userMessage: string, assistantMessage: string): Promise<string> {
		const client = this.getClient();
		const userExcerpt = userMessage.slice(0, 300);
		const assistantExcerpt = assistantMessage.slice(0, 300);
		const response = await client.chat.completions.create({
			model: "gpt-4o-mini",
			max_tokens: 20,
			messages: [{
				role: "user",
				content: `Give this conversation a concise 3-5 word title. Reply with ONLY the title, no punctuation, no quotes.\n\nUser: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`,
			}],
		});
		return response.choices[0]?.message?.content?.trim() ?? "New Conversation";
	}
}
