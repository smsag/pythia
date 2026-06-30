import OpenAI from "openai";
import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages } from "./messageUtils";
import { BaseProvider } from "./BaseProvider";

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

type OAIToolCallBlock = { id: string; type: "function"; function: { name: string; arguments: string } };
type OAILoopMessage =
	| OAIMessage
	| { role: "assistant"; content: null; tool_calls: OAIToolCallBlock[] }
	| { role: "tool"; tool_call_id: string; content: string };

/**
 * Models that do not support a `system` role message.
 * For these, the system prompt is injected as the first `user` message.
 */
const NO_SYSTEM_ROLE_MODELS = new Set(["o3", "o3-mini", "o1", "o1-mini"]);


export class OpenAIProvider extends BaseProvider {
	private client: OpenAI | null = null;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey);
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "gpt-4o-mini";
	}

	protected get assistantLabel(): string {
		return "Assistant";
	}

	protected resolveModel(modelOverride?: string): string {
		return modelOverride || this.settings.defaultOpenAIModel;
	}

	protected async callUtility(
		model: string,
		userMessage: string,
		maxTokens: number,
		systemMessage?: string
	): Promise<string> {
		const messages: { role: "system" | "user"; content: string }[] = [];
		if (systemMessage) messages.push({ role: "system", content: systemMessage });
		messages.push({ role: "user", content: userMessage });
		const response = await this.getClient().chat.completions.create({
			model,
			max_tokens: maxTokens,
			messages,
		});
		return response.choices[0]?.message?.content?.trim() ?? "";
	}

	private getClient(): OpenAI {
		if (!this.apiKey) {
			throw new Error(t("openaiKeyNotConfigured"));
		}
		if (!this.client) {
			// Obsidian runs in Electron (not a public browser), so API keys are
			// never exposed in client-side code. Keys are loaded at runtime from
			// Obsidian's vault-scoped SecretStorage — this flag silences the SDK's
			// browser warning which does not apply in this context.
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
			const { content: attachedContent, missingNotes } =
				await buildAttachedNotesContent(this.app, attachedNotes);
			const userContent = newMessage + attachedContent;
			const systemPrompt = buildSystemPrompt(conversation);

			if (missingNotes.length > 0) {
				new Notice(t("contextNotesWarning", { count: missingNotes.length }));
			}

			const model = this.resolveModel(conversation.model);
			const noSystemRole = NO_SYSTEM_ROLE_MODELS.has(model);

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it.
			const historyMessages: OAIMessage[] = conversation.messages.slice(0, -1).map(
				(m) => ({ role: m.role as "user" | "assistant", content: m.content })
			);

			let apiMessages: OAIMessage[];

			// OpenAI allows "system" at position 0; only drop leading "assistant" turns.
			const oaiPred = (role: string) => role === "assistant";

			if (systemPrompt && noSystemRole) {
				apiMessages = normalizeMessages<OAIMessage>([
					{ role: "user", content: `[System instructions]\n${systemPrompt}` },
					...historyMessages,
					{ role: "user", content: userContent },
				], oaiPred);
			} else if (systemPrompt) {
				apiMessages = [
					{ role: "system", content: systemPrompt },
					...normalizeMessages<OAIMessage>([
						...historyMessages,
						{ role: "user", content: userContent },
					], oaiPred),
				];
			} else {
				apiMessages = normalizeMessages<OAIMessage>([
					...historyMessages,
					{ role: "user", content: userContent },
				], oaiPred);
			}

			if (this.settings.debugMode) {
				// eslint-disable-next-line no-console
				console.log("[Pythia] OpenAI API call →", {
					model,
					messages: apiMessages.length,
					systemPromptChars: systemPrompt.length,
					noSystemRole,
					tools: !!onToolCall,
				});
			}

			const loopMessages: OAILoopMessage[] = [...apiMessages];

			const openaiTools = onToolCall
				? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder, conversation.writeMode).map((def) => ({
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
				const stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> =
					await this.getClient().chat.completions.create(
					{
						model,
						max_tokens: conversation.maxTokens ?? 4096,
						messages: loopMessages,
						stream: true,
						stream_options: { include_usage: true },
						...(openaiTools?.length ? { tools: openaiTools } : {}),
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
					loopMessages.push({
						role: "assistant" as const,
						content: null,
						tool_calls: calls.map((tc) => ({
							id: tc.id,
							type: "function" as const,
							function: { name: tc.name, arguments: tc.arguments },
						})),
					});
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
							role: "tool" as const,
							tool_call_id: tc.id,
							content: result,
						});
					}
				} else {
					break;
				}
			}

			onComplete(fullText, lastTokenUsage);
		} catch (error) {
			const isAbort =
				error instanceof Error &&
				(error.name === "AbortError" ||
					error.name === "APIUserAbortError" ||
					error.name === "ToolCancelledError");
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
}
