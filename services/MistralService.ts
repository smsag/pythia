// Uses the SDK's tree-shakeable standalone-function API (MistralCore +
// funcs/chatComplete, funcs/chatStream) rather than the full `Mistral` client
// class — importing the class pulls in its `beta`/observability getters,
// which statically import `@opentelemetry/api` (an optional peer dependency
// this plugin doesn't install), and esbuild fails to resolve it at bundle
// time. See FUNCTIONS.md in the installed package for the SDK's own
// rationale for this API shape.
import { MistralCore } from "@mistralai/mistralai/core.js";
import { chatComplete } from "@mistralai/mistralai/funcs/chatComplete.js";
import { chatStream } from "@mistralai/mistralai/funcs/chatStream.js";
import { unwrapAsync } from "@mistralai/mistralai/types/fp.js";
import type {
	FunctionTool,
	ToolCall as MistralToolCall,
	CompletionChunk,
	ChatCompletionStreamRequest,
} from "@mistralai/mistralai/models/components";
import type { EventStream } from "@mistralai/mistralai/lib/event-streams";
import { App } from "obsidian";
import { Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, debugLog } from "./messageUtils";
import { BaseProvider } from "./BaseProvider";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { resolveDefaultMaxTokens } from "./promptConstants";

type MistralMessage = { role: "system" | "user" | "assistant"; content: string };

type MistralLoopMessage =
	| MistralMessage
	| { role: "assistant"; content: null; toolCalls: MistralToolCall[] }
	| { role: "tool"; toolCallId: string; content: string };

/** Safety net against a confused model looping on tool calls indefinitely. */
const MAX_TOOL_ROUNDS = 25;

export class MistralService extends BaseProvider {
	private client: MistralCore | null = null;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey);
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "mistral-small-latest";
	}

	protected get assistantLabel(): string {
		return "Assistant";
	}

	protected resolveModel(modelOverride?: string): string {
		return modelOverride || this.settings.defaultMistralModel;
	}

	protected async callUtility(
		model: string,
		userMessage: string,
		maxTokens: number,
		systemMessage?: string
	): Promise<string> {
		const messages: MistralMessage[] = [];
		if (systemMessage) messages.push({ role: "system", content: systemMessage });
		messages.push({ role: "user", content: userMessage });
		const response = await unwrapAsync(chatComplete(this.getClient(), {
			model,
			maxTokens,
			messages,
		}));
		const content = response.choices?.[0]?.message?.content;
		return (typeof content === "string" ? content : "").trim();
	}

	private getClient(): MistralCore {
		if (!this.apiKey) {
			throw new Error(t("mistralKeyNotConfigured"));
		}
		if (!this.client) {
			this.client = new MistralCore({ apiKey: this.apiKey });
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

			// PDF attachments aren't supported for Mistral yet (unconfirmed whether
			// the chat API accepts document content blocks — see ADR for this
			// integration). Warn rather than silently dropping the attachment.
			if (pdfAttachments.length > 0) {
				new Notice(t("mistralPdfUnsupported", { count: pdfAttachments.length }));
			}

			const model = this.resolveModel(conversation.model);
			const temperature = conversation.temperature ?? this.settings.temperature;
			// Mistral's reasoningEffort has no per-model restriction in the installed
			// SDK's types (unlike OpenAI's reasoning_effort, genuinely rejected outside
			// the o-series) — sent whenever requested, on any model.
			const reasoningEffort = conversation.effort ?? this.settings.effort;
			const maxTokens = conversation.maxTokens ?? this.settings.maxTokens ?? resolveDefaultMaxTokens(model);

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it. In "summary" resume mode, skip
			// prior history entirely — summaryText in the system prompt is the
			// only context sent (see selectHistoryForSend).
			const historyMessages: MistralMessage[] = selectHistoryForSend(
				conversation.messages.slice(0, -1),
				conversation.resumeMode
			).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

			// Mistral supports a native "system" role on every model (confirmed via
			// the installed SDK's SystemMessage type) — no OpenAI-o-series-style
			// "inject as a leading user message" workaround needed here.
			const mistralPred = (role: string) => role === "assistant";
			let apiMessages: MistralMessage[];
			if (systemPrompt) {
				apiMessages = [
					{ role: "system", content: systemPrompt },
					...normalizeMessages<MistralMessage>([
						...historyMessages,
						{ role: "user", content: userContent },
					], mistralPred),
				];
			} else {
				apiMessages = normalizeMessages<MistralMessage>([
					...historyMessages,
					{ role: "user", content: userContent },
				], mistralPred);
			}

			if (this.settings.debugMode) {
				// eslint-disable-next-line no-console
				console.log("[Pythia] Mistral API call →", {
					model,
					temperature,
					reasoningEffort,
					pdfAttachments: pdfAttachments.length,
					messages: apiMessages.length,
					systemPromptChars: systemPrompt.length,
					tools: !!onToolCall,
					resumeMode: conversation.resumeMode ?? "full",
					historySkipped: conversation.resumeMode === "summary",
				});
			}

			const loopMessages: MistralLoopMessage[] = [...apiMessages];

			const mistralTools: FunctionTool[] | undefined = onToolCall
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
				let stream: EventStream<{ data: CompletionChunk }> | undefined;

				for (let attempt = 0; !stream; ) {
					try {
						stream = await unwrapAsync(chatStream(
							this.getClient(),
							{
								model,
								maxTokens,
								...(temperature !== undefined ? { temperature } : {}),
								...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
								messages: loopMessages as ChatCompletionStreamRequest["messages"],
								...(mistralTools?.length ? { tools: mistralTools } : {}),
							},
							{ signal }
						));
					} catch (err) {
						// stream() rejects before any chunk is consumed, so no tokens have
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

				let finishReason: string | null | undefined = null;
				const pendingCalls: Array<{ id: string; name: string; arguments: string }> = [];

				for await (const event of stream) {
					const chunk = event.data;
					const delta = chunk.choices[0]?.delta;
					if (delta?.content && typeof delta.content === "string") {
						fullText += delta.content;
						onToken(delta.content);
					}
					// Accumulate streaming tool call fragments
					if (delta?.toolCalls) {
						for (const tc of delta.toolCalls) {
							const idx = tc.index ?? 0;
							if (!pendingCalls[idx]) {
								pendingCalls[idx] = { id: "", name: "", arguments: "" };
							}
							if (tc.id) pendingCalls[idx].id = tc.id;
							if (tc.function?.name) pendingCalls[idx].name += tc.function.name;
							if (tc.function?.arguments) {
								pendingCalls[idx].arguments +=
									typeof tc.function.arguments === "string"
										? tc.function.arguments
										: JSON.stringify(tc.function.arguments);
							}
						}
					}
					if (chunk.choices[0]?.finishReason) {
						finishReason = chunk.choices[0].finishReason;
					}
					if (chunk.usage) {
						receivedUsage = true;
						totalInputTokens += chunk.usage.promptTokens ?? 0;
						totalOutputTokens += chunk.usage.completionTokens ?? 0;
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
						toolCalls: calls.map((tc) => ({
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
							toolCallId: tc.id,
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
