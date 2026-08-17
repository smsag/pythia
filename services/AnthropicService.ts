import Anthropic from "@anthropic-ai/sdk";
import { App } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, EffortLevel } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, debugLog } from "./messageUtils";
import { BaseProvider, type RoundResult } from "./BaseProvider";
import type { PdfAttachment } from "./ContextBuilder";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { resolveDefaultMaxTokens } from "./promptConstants";
import { supportsTemperature, supportsEffort } from "../models/knownModels";

type ApiMessage = { role: "user" | "assistant"; content: string };

// `output_config.effort` isn't in the installed SDK's TypeScript types yet,
// though the API accepts it — extend the SDK's own param type locally rather
// than casting the request literal or bumping the SDK.
type AnthropicStreamParams = Anthropic.MessageStreamParams & {
	output_config?: { effort: EffortLevel };
};

export class AnthropicService extends BaseProvider {
	private client: Anthropic | null = null;

	// ── Streaming loop state (set in prepareStream, consumed in runStreamRound/handleToolCalls) ──
	private loopMessages!: Anthropic.MessageParam[];
	private anthropicTools: Anthropic.Tool[] | undefined;
	private streamModel!: string;
	private streamMaxTokens!: number;
	private streamTemperature: number | undefined;
	private streamEffort: EffortLevel | undefined;
	private streamSystemPrompt!: string;
	private lastFinalMsg: Anthropic.Message | undefined;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey, "anthropic");
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

	protected async prepareStream(
		conversation: Conversation,
		userContent: string,
		systemPrompt: string,
		pdfAttachments: PdfAttachment[],
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		// Exclude the last message — already pushed by the caller; sending it
		// again in history would duplicate it. In "summary" resume mode, skip
		// prior history entirely — summaryText in the system prompt is the
		// only context sent (see selectHistoryForSend).
		const historyMessages: ApiMessage[] = selectHistoryForSend(
			conversation.messages.slice(0, -1),
			conversation.resumeMode
		).map((m) => ({ role: m.role, content: m.content }));

		this.streamModel = this.resolveModel(conversation.model);
		this.streamMaxTokens = conversation.maxTokens ?? this.settings.maxTokens ?? resolveDefaultMaxTokens(this.streamModel);
		const requestedTemperature = conversation.temperature ?? this.settings.temperature;
		this.streamTemperature = supportsTemperature(this.streamModel) ? requestedTemperature : undefined;
		const requestedEffort = conversation.effort ?? this.settings.effort;
		this.streamEffort = requestedEffort !== undefined && supportsEffort(this.streamModel) ? requestedEffort : undefined;

		// Anthropic requires the first message to be "user" (no system role in messages array).
		this.loopMessages = normalizeMessages(
			[...historyMessages, { role: "user" as const, content: userContent }],
			role => role !== "user"
		).map((m) => ({ role: m.role, content: m.content }));

		// Splice PDF document blocks onto the final user message, after
		// normalizeMessages has run — its same-role merge does string
		// concatenation (messageUtils.ts) and would corrupt array content.
		// Mirrors the array-content bypass already used for tool-loop
		// messages further down in this file.
		if (pdfAttachments.length > 0) {
			const last = this.loopMessages[this.loopMessages.length - 1];
			if (last.role === "user" && typeof last.content === "string") {
				const documentBlocks: Anthropic.DocumentBlockParam[] = pdfAttachments.map((pdf) => ({
					type: "document",
					source: { type: "base64", media_type: "application/pdf", data: pdf.base64 },
					title: pdf.filename,
				}));
				last.content = [...documentBlocks, { type: "text", text: last.content }];
			}
		}

		// Tool definitions are identical on every turn of a conversation — mark the
		// last one as a cache breakpoint so the whole block is cached after turn 1.
		this.anthropicTools = onToolCall
			? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder, conversation.writeMode).map((def, i, arr) => ({
					name: def.name,
					description: def.description,
					input_schema: def.inputSchema as Anthropic.Tool.InputSchema,
					...(i === arr.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
			  }))
			: undefined;

		this.streamSystemPrompt = systemPrompt;

		if (this.settings.debugMode) {
			// eslint-disable-next-line no-console
			console.log("[Pythia] Anthropic API call →", {
				model: this.streamModel,
				temperature: this.streamTemperature,
				temperatureDropped: requestedTemperature !== undefined && this.streamTemperature === undefined,
				effort: this.streamEffort,
				effortDropped: requestedEffort !== undefined && this.streamEffort === undefined,
				pdfAttachments: pdfAttachments.length,
				messages: historyMessages.length + 1,
				systemPromptChars: systemPrompt.length,
				tools: !!onToolCall,
				resumeMode: conversation.resumeMode ?? "full",
				historySkipped: conversation.resumeMode === "summary",
				systemPromptCached: !!systemPrompt,
				toolsCached: !!(onToolCall && this.anthropicTools?.length),
			});
		}
	}

	protected async runStreamRound(
		signal: AbortSignal,
		onToken: (text: string) => void,
	): Promise<RoundResult> {
		let finalMsg: Anthropic.Message | undefined;
		let tokensEmitted = 0;

		for (let attempt = 0; !finalMsg; ) {
			try {
				const params: AnthropicStreamParams = {
					model: this.streamModel,
					max_tokens: this.streamMaxTokens,
					...(this.streamTemperature !== undefined ? { temperature: this.streamTemperature } : {}),
					...(this.streamEffort !== undefined ? { output_config: { effort: this.streamEffort } } : {}),
					// Cache the system prompt — it's identical on every turn of a
					// conversation and is often the largest stable chunk of the request.
					...(this.streamSystemPrompt
						? { system: [{ type: "text" as const, text: this.streamSystemPrompt, cache_control: { type: "ephemeral" as const } }] }
						: {}),
					messages: this.loopMessages,
					...(this.anthropicTools?.length ? { tools: this.anthropicTools } : {}),
				};
				const stream = this.getClient().messages.stream(params, { signal });

				stream.on("text", (text) => {
					tokensEmitted += text.length;
					onToken(text);
				});

				finalMsg = await stream.finalMessage();
			} catch (err) {
				// Only retry if no tokens were emitted yet this attempt — otherwise
				// a retry would duplicate partial output already sent via onToken.
				if (tokensEmitted === 0 && isRetryableError(err) && attempt < RETRY_BACKOFF_MS.length) {
					debugLog(this.settings, "retry", attempt + 1, err);
					await sleep(RETRY_BACKOFF_MS[attempt]);
					attempt++;
					continue;
				}
				throw err;
			}
		}

		this.lastFinalMsg = finalMsg;

		return {
			action: finalMsg.stop_reason === "tool_use" ? "tool_use" : "done",
			inputTokens: finalMsg.usage.input_tokens,
			outputTokens: finalMsg.usage.output_tokens,
			cacheReadTokens: finalMsg.usage.cache_read_input_tokens ?? 0,
			cacheCreationTokens: finalMsg.usage.cache_creation_input_tokens ?? 0,
			hasUsage: true,
		};
	}

	protected async handleToolCalls(
		onToolCall: (call: ToolCall) => Promise<string>
	): Promise<void> {
		const finalMsg = this.lastFinalMsg!;
		this.loopMessages.push({
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
		this.loopMessages.push({ role: "user", content: toolResults });
	}
}
