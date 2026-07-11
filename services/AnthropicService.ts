import Anthropic from "@anthropic-ai/sdk";
import { App } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import { ToolLoopLimitError } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, debugLog } from "./messageUtils";
import { BaseProvider } from "./BaseProvider";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { DEFAULT_MAX_TOKENS } from "./promptConstants";

type ApiMessage = { role: "user" | "assistant"; content: string };

/** Safety net against a confused model looping on tool calls indefinitely. */
const MAX_TOOL_ROUNDS = 25;

export class AnthropicService extends BaseProvider {
	private client: Anthropic | null = null;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey);
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "claude-haiku-4-5";
	}

	protected get assistantLabel(): string {
		return "Claude";
	}

	protected resolveModel(modelOverride?: string): string {
		return modelOverride || this.settings.defaultAnthropicModel;
	}

	protected async callUtility(
		model: string,
		userMessage: string,
		maxTokens: number,
		systemMessage?: string
	): Promise<string> {
		const response = await this.getClient().messages.create({
			model,
			max_tokens: maxTokens,
			...(systemMessage ? { system: systemMessage } : {}),
			messages: [{ role: "user", content: userMessage }],
		});
		const block = response.content[0];
		return block?.type === "text" ? block.text.trim() : "";
	}

	private getClient(): Anthropic {
		if (!this.apiKey) {
			throw new Error(t("anthropicKeyNotConfigured"));
		}
		if (!this.client) {
			// Obsidian runs in Electron (not a public browser), so API keys are
			// never exposed in client-side code. Keys are loaded at runtime from
			// Obsidian's vault-scoped SecretStorage — this flag silences the SDK's
			// browser warning which does not apply in this context.
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
			const { userContent, systemPrompt } =
				await this.resolveUserContent(conversation, attachedNotes, newMessage);

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it. In "summary" resume mode, skip
			// prior history entirely — summaryText in the system prompt is the
			// only context sent (see selectHistoryForSend).
			const historyMessages: ApiMessage[] = selectHistoryForSend(
				conversation.messages.slice(0, -1),
				conversation.resumeMode
			).map((m) => ({ role: m.role, content: m.content }));

			const model = this.resolveModel(conversation.model);
			const maxTokens = conversation.maxTokens ?? DEFAULT_MAX_TOKENS;
			const temperature = conversation.temperature ?? this.settings.temperature;

			// Anthropic requires the first message to be "user" (no system role in messages array).
			const loopMessages: Anthropic.MessageParam[] = normalizeMessages(
				[...historyMessages, { role: "user" as const, content: userContent }],
				role => role !== "user"
			).map((m) => ({ role: m.role, content: m.content }));

			// Tool definitions are identical on every turn of a conversation — mark the
			// last one as a cache breakpoint so the whole block is cached after turn 1.
			const anthropicTools: Anthropic.Tool[] | undefined = onToolCall
				? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder, conversation.writeMode).map((def, i, arr) => ({
						name: def.name,
						description: def.description,
						input_schema: def.inputSchema as Anthropic.Tool.InputSchema,
						...(i === arr.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
				  }))
				: undefined;

			if (this.settings.debugMode) {
				// eslint-disable-next-line no-console
				console.log("[Pythia] Anthropic API call →", {
					model,
					temperature,
					messages: historyMessages.length + 1,
					systemPromptChars: systemPrompt.length,
					tools: !!onToolCall,
					resumeMode: conversation.resumeMode ?? "full",
					historySkipped: conversation.resumeMode === "summary",
					systemPromptCached: !!systemPrompt,
					toolsCached: !!(onToolCall && anthropicTools?.length),
				});
			}

			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let totalCacheReadTokens = 0;
			let totalCacheCreationTokens = 0;
			let round = 0;

			while (true) {
				if (++round > MAX_TOOL_ROUNDS) throw new ToolLoopLimitError();
				const textLenBeforeAttempt = fullText.length;
				let finalMsg: Anthropic.Message | undefined;

				for (let attempt = 0; !finalMsg; ) {
					try {
						const stream = this.getClient().messages.stream(
							{
								model,
								max_tokens: maxTokens,
								...(temperature !== undefined ? { temperature } : {}),
								// Cache the system prompt — it's identical on every turn of a
								// conversation and is often the largest stable chunk of the request.
								...(systemPrompt
									? { system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }] }
									: {}),
								messages: loopMessages,
								...(anthropicTools?.length ? { tools: anthropicTools } : {}),
							},
							{ signal }
						);

						stream.on("text", (text) => {
							fullText += text;
							onToken(text);
						});

						finalMsg = await stream.finalMessage();
					} catch (err) {
						// Only retry if no tokens were emitted yet this attempt — otherwise
						// a retry would duplicate partial output already sent via onToken.
						const noTokensYet = fullText.length === textLenBeforeAttempt;
						if (noTokensYet && isRetryableError(err) && attempt < RETRY_BACKOFF_MS.length) {
							debugLog(this.settings, "retry", attempt + 1, err);
							await sleep(RETRY_BACKOFF_MS[attempt]);
							attempt++;
							continue;
						}
						throw err;
					}
				}

				totalInputTokens += finalMsg.usage.input_tokens;
				totalOutputTokens += finalMsg.usage.output_tokens;
				totalCacheReadTokens += finalMsg.usage.cache_read_input_tokens ?? 0;
				totalCacheCreationTokens += finalMsg.usage.cache_creation_input_tokens ?? 0;
				debugLog(this.settings, "tool round", round, "stop:", finalMsg.stop_reason, "usage:", {
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					cacheReadTokens: totalCacheReadTokens,
					cacheCreationTokens: totalCacheCreationTokens,
				});

				if (finalMsg.stop_reason === "tool_use" && onToolCall) {
					loopMessages.push({
						role: "assistant",
						content: finalMsg.content as Anthropic.MessageParam["content"],
					});

					const toolResults: Anthropic.ToolResultBlockParam[] = [];
					for (const block of finalMsg.content) {
						if (block.type === "tool_use") {
							const result = await onToolCall({
								id: block.id,
								name: block.name,
								input: block.input as Record<string, unknown>,
							});
							toolResults.push({
								type: "tool_result",
								tool_use_id: block.id,
								content: result,
							});
						}
					}
					loopMessages.push({ role: "user", content: toolResults });
				} else {
					break;
				}
			}

			const tokenUsage: TokenUsage = {
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
				...(totalCacheReadTokens > 0 ? { cacheReadTokens: totalCacheReadTokens } : {}),
				...(totalCacheCreationTokens > 0 ? { cacheCreationTokens: totalCacheCreationTokens } : {}),
			};
			onComplete(fullText, tokenUsage);
		} catch (error) {
			this.finishOrError(error, fullText, onComplete, onError);
		} finally {
			this.abortController = null;
		}
	}
}
