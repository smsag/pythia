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
import type { Conversation, ToolCall, EffortLevel } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, trimHistoryToBudget, estimateTokensFromText, debugLog } from "./messageUtils";
import { BaseProvider, type RoundResult } from "./BaseProvider";
import type { PdfAttachment } from "./ContextBuilder";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { resolveDefaultMaxTokens } from "./promptConstants";
import { getContextWindow } from "../models/knownModels";

type MistralMessage = { role: "system" | "user" | "assistant"; content: string };

type MistralLoopMessage =
	| MistralMessage
	| { role: "assistant"; content: null; toolCalls: MistralToolCall[] }
	| { role: "tool"; toolCallId: string; content: string };

export class MistralService extends BaseProvider {
	private client: MistralCore | null = null;

	// ── Streaming loop state (set in prepareStream, consumed in runStreamRound/handleToolCalls) ──
	private loopMessages!: MistralLoopMessage[];
	private mistralTools: FunctionTool[] | undefined;
	private streamModel!: string;
	private streamMaxTokens!: number;
	private streamTemperature: number | undefined;
	private streamReasoningEffort: EffortLevel | undefined;
	private lastPendingCalls: Array<{ id: string; name: string; arguments: string }> = [];

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey, "mistral");
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "mistral-small-latest";
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

	protected async prepareStream(
		conversation: Conversation,
		userContent: string,
		systemPrompt: string,
		pdfAttachments: PdfAttachment[],
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		// PDF attachments aren't supported for Mistral yet (unconfirmed whether
		// the chat API accepts document content blocks — see ADR for this
		// integration). Warn rather than silently dropping the attachment.
		if (pdfAttachments.length > 0) {
			new Notice(t("mistralPdfUnsupported", { count: pdfAttachments.length }));
		}

		this.streamModel = this.resolveModel(conversation.model);
		this.streamTemperature = conversation.temperature ?? this.settings.temperature;
		// Mistral's reasoningEffort has no per-model restriction in the installed
		// SDK's types (unlike OpenAI's reasoning_effort, genuinely rejected outside
		// the o-series) — sent whenever requested, on any model.
		this.streamReasoningEffort = conversation.effort ?? this.settings.effort;
		this.streamMaxTokens = conversation.maxTokens ?? this.settings.maxTokens ?? resolveDefaultMaxTokens(this.streamModel);

		// Exclude the last message — already pushed by the caller; sending it
		// again in history would duplicate it. In "summary" resume mode, skip
		// prior history entirely — summaryText in the system prompt is the
		// only context sent (see selectHistoryForSend).
		const selected = selectHistoryForSend(
			conversation.messages.slice(0, -1),
			conversation.resumeMode
		);
		const historyMessages: MistralMessage[] = trimHistoryToBudget(
			selected.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
			getContextWindow(this.streamModel),
			this.streamMaxTokens,
			estimateTokensFromText(systemPrompt),
		);

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
				model: this.streamModel,
				temperature: this.streamTemperature,
				reasoningEffort: this.streamReasoningEffort,
				pdfAttachments: pdfAttachments.length,
				messages: apiMessages.length,
				systemPromptChars: systemPrompt.length,
				tools: !!onToolCall,
				resumeMode: conversation.resumeMode ?? "full",
				historySkipped: conversation.resumeMode === "summary",
			});
		}

		this.loopMessages = [...apiMessages];

		this.mistralTools = onToolCall
			? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder, conversation.writeMode, conversation.researchMode ?? false).map((def) => ({
					type: "function" as const,
					function: {
						name: def.name,
						description: def.description,
						parameters: def.inputSchema,
					},
			  }))
			: undefined;
	}

	protected async runStreamRound(
		signal: AbortSignal,
		onToken: (text: string) => void,
	): Promise<RoundResult> {
		let stream: EventStream<{ data: CompletionChunk }> | undefined;

		for (let attempt = 0; !stream; ) {
			try {
				stream = await unwrapAsync(chatStream(
					this.getClient(),
					{
						model: this.streamModel,
						maxTokens: this.streamMaxTokens,
						...(this.streamTemperature !== undefined ? { temperature: this.streamTemperature } : {}),
						...(this.streamReasoningEffort !== undefined ? { reasoningEffort: this.streamReasoningEffort } : {}),
						messages: this.loopMessages as ChatCompletionStreamRequest["messages"],
						...(this.mistralTools?.length ? { tools: this.mistralTools } : {}),
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
		let inputTokens = 0;
		let outputTokens = 0;
		let hasUsage = false;

		for await (const event of stream) {
			const chunk = event.data;
			const delta = chunk.choices[0]?.delta;
			if (delta?.content && typeof delta.content === "string") {
				onToken(delta.content);
			}
			// Accumulate streaming tool call fragments
			if (delta?.toolCalls) {
				for (const tc of delta.toolCalls) {
					// Guard a stream that omits `index` so parallel tool calls don't
					// all collapse into slot 0: a fresh `id` starts a new call, an
					// argument-only fragment continues the current one.
					const idx = typeof tc.index === "number"
						? tc.index
						: tc.id
							? pendingCalls.length
							: Math.max(0, pendingCalls.length - 1);
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
				hasUsage = true;
				inputTokens += chunk.usage.promptTokens ?? 0;
				outputTokens += chunk.usage.completionTokens ?? 0;
			}
		}

		this.lastPendingCalls = pendingCalls.filter(Boolean);

		return {
			action: finishReason === "tool_calls" && this.lastPendingCalls.length > 0 ? "tool_use" : "done",
			inputTokens,
			outputTokens,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			hasUsage,
		};
	}

	protected async handleToolCalls(
		onToolCall: (call: ToolCall) => Promise<string>
	): Promise<void> {
		const calls = this.lastPendingCalls;
		this.loopMessages.push({
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
			this.loopMessages.push({
				role: "tool" as const,
				toolCallId: tc.id,
				content: result,
			});
		}
	}
}
