import OpenAI from "openai";
import { App } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, debugLog } from "./messageUtils";
import { BaseProvider } from "./BaseProvider";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { isReasoningModel } from "../models/knownModels";
import { resolveDefaultMaxTokens } from "./promptConstants";

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

type OAIToolCallBlock = { id: string; type: "function"; function: { name: string; arguments: string } };
type OAILoopMessage =
	| OAIMessage
	| { role: "assistant"; content: null; tool_calls: OAIToolCallBlock[] }
	| { role: "tool"; tool_call_id: string; content: string };

/** Safety net against a confused model looping on tool calls indefinitely. */
const MAX_TOOL_ROUNDS = 25;


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
			...(isReasoningModel(model) ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
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
		// Captured once: if the user aborts while a tool confirmation is pending
		// (BaseProvider.abort() nulls this.abortController), later round trips must
		// still see a signal — reading this.abortController.signal again would throw
		// on null instead of surfacing a clean abort.
		const signal = this.abortController.signal;

		let fullText = "";

		try {
			const { userContent, systemPrompt, pdfAttachments } =
				await this.resolveUserContent(conversation, attachedNotes, newMessage);

			const model = this.resolveModel(conversation.model);
			const noSystemRole = isReasoningModel(model);
			// Reasoning models (o1/o3/o4 family) reject a custom temperature — same model set
			// that also can't take a system-role message or `max_tokens`.
			const temperature = isReasoningModel(model)
				? undefined
				: conversation.temperature ?? this.settings.temperature;
			const requestedEffort = conversation.effort ?? this.settings.effort;
			const reasoningEffort = requestedEffort !== undefined && isReasoningModel(model)
				? requestedEffort
				: undefined;
			const maxTokens = conversation.maxTokens ?? this.settings.maxTokens ?? resolveDefaultMaxTokens(model);

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it. In "summary" resume mode, skip
			// prior history entirely — summaryText in the system prompt is the
			// only context sent (see selectHistoryForSend).
			const historyMessages: OAIMessage[] = selectHistoryForSend(
				conversation.messages.slice(0, -1),
				conversation.resumeMode
			).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

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
					temperature,
					reasoningEffort,
					pdfAttachments: pdfAttachments.length,
					messages: apiMessages.length,
					systemPromptChars: systemPrompt.length,
					noSystemRole,
					tools: !!onToolCall,
					resumeMode: conversation.resumeMode ?? "full",
					historySkipped: conversation.resumeMode === "summary",
				});
			}

			const loopMessages: OAILoopMessage[] = [...apiMessages];

			// Splice PDF file blocks onto the final user message. This is the
			// first array-content message in this file — a narrow cast is used
			// rather than widening OAIMessage/OAILoopMessage, which would ripple
			// into every other loopMessages.push(...) call in the tool loop below.
			if (pdfAttachments.length > 0) {
				const last = loopMessages[loopMessages.length - 1];
				if (last.role === "user" && typeof last.content === "string") {
					const fileParts: OpenAI.Chat.Completions.ChatCompletionContentPart.File[] = pdfAttachments.map((pdf) => ({
						type: "file",
						file: { file_data: `data:application/pdf;base64,${pdf.base64}`, filename: pdf.filename },
					}));
					(loopMessages[loopMessages.length - 1] as { content: unknown }).content =
						[...fileParts, { type: "text", text: last.content }];
				}
			}

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

			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let receivedUsage = false;
			let round = 0;

			while (true) {
				if (++round > MAX_TOOL_ROUNDS) throw new ToolLoopLimitError();
				let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | undefined;

				for (let attempt = 0; !stream; ) {
					try {
						stream = await this.getClient().chat.completions.create(
							{
								model,
								...(noSystemRole
									? { max_completion_tokens: maxTokens }
									: { max_tokens: maxTokens }),
								...(temperature !== undefined ? { temperature } : {}),
								...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
								messages: loopMessages,
								stream: true,
								stream_options: { include_usage: true },
								...(openaiTools?.length ? { tools: openaiTools } : {}),
							},
							{ signal }
						);
					} catch (err) {
						// create() rejects before any chunk is consumed, so no tokens have
						// been emitted yet — safe to retry transient failures here.
						if (isRetryableError(err) && attempt < RETRY_BACKOFF_MS.length) {
							debugLog(this.settings, "retry", attempt + 1, err);
							await sleep(RETRY_BACKOFF_MS[attempt]);
							attempt++;
							continue;
						}
						throw err;
					}
				}

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
						receivedUsage = true;
						totalInputTokens += chunk.usage.prompt_tokens;
						totalOutputTokens += chunk.usage.completion_tokens;
					}
				}

				debugLog(this.settings, "tool round", round, "finish:", finishReason, "usage:", {
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
				});

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

			const tokenUsage: TokenUsage | undefined = receivedUsage
				? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
				: undefined;
			onComplete(fullText, tokenUsage);
		} catch (error) {
			this.finishOrError(error, fullText, onComplete, onError);
		} finally {
			this.abortController = null;
		}
	}
}
