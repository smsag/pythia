import OpenAI from "openai";
import { App } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, EffortLevel } from "../models/types";
import type { PythiaSettings } from "../settings";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages, selectHistoryForSend, trimHistoryToBudget, estimateTokensFromText, debugLog } from "./messageUtils";
import { BaseProvider, type RoundResult } from "./BaseProvider";
import type { PdfAttachment } from "./ContextBuilder";
import { RETRY_BACKOFF_MS, isRetryableError, sleep } from "./retry";
import { isReasoningModel, getContextWindow } from "../models/knownModels";
import { resolveDefaultMaxTokens } from "./promptConstants";

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

type OAIToolCallBlock = { id: string; type: "function"; function: { name: string; arguments: string } };
type OAILoopMessage =
	| OAIMessage
	| { role: "assistant"; content: null; tool_calls: OAIToolCallBlock[] }
	| { role: "tool"; tool_call_id: string; content: string };

export class OpenAIProvider extends BaseProvider {
	private client: OpenAI | null = null;

	// ── Streaming loop state (set in prepareStream, consumed in runStreamRound/handleToolCalls) ──
	private loopMessages!: OAILoopMessage[];
	private openaiTools: OpenAI.ChatCompletionTool[] | undefined;
	private streamModel!: string;
	private streamMaxTokens!: number;
	private streamTemperature: number | undefined;
	private streamReasoningEffort: EffortLevel | undefined;
	private noSystemRole!: boolean;
	private lastPendingCalls: Array<{ id: string; name: string; arguments: string }> = [];

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey, "openai");
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "gpt-4o-mini";
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

	protected async prepareStream(
		conversation: Conversation,
		userContent: string,
		systemPrompt: string,
		pdfAttachments: PdfAttachment[],
		onToolCall?: (call: ToolCall) => Promise<string>
	): Promise<void> {
		this.streamModel = this.resolveModel(conversation.model);
		this.noSystemRole = isReasoningModel(this.streamModel);
		// Reasoning models (o1/o3/o4 family) reject a custom temperature — same model set
		// that also can't take a system-role message or `max_tokens`.
		this.streamTemperature = isReasoningModel(this.streamModel)
			? undefined
			: conversation.temperature ?? this.settings.temperature;
		const requestedEffort = conversation.effort ?? this.settings.effort;
		this.streamReasoningEffort = requestedEffort !== undefined && isReasoningModel(this.streamModel)
			? requestedEffort
			: undefined;
		this.streamMaxTokens = conversation.maxTokens ?? this.settings.maxTokens ?? resolveDefaultMaxTokens(this.streamModel);

		// Exclude the last message — already pushed by the caller; sending it
		// again in history would duplicate it. In "summary" resume mode, skip
		// prior history entirely — summaryText in the system prompt is the
		// only context sent (see selectHistoryForSend).
		const selected = selectHistoryForSend(
			conversation.messages.slice(0, -1),
			conversation.resumeMode
		);
		const historyMessages: OAIMessage[] = trimHistoryToBudget(
			selected.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
			getContextWindow(this.streamModel),
			this.streamMaxTokens,
			estimateTokensFromText(systemPrompt),
		);

		let apiMessages: OAIMessage[];

		// OpenAI allows "system" at position 0; only drop leading "assistant" turns.
		const oaiPred = (role: string) => role === "assistant";

		if (systemPrompt && this.noSystemRole) {
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
				model: this.streamModel,
				temperature: this.streamTemperature,
				reasoningEffort: this.streamReasoningEffort,
				pdfAttachments: pdfAttachments.length,
				messages: apiMessages.length,
				systemPromptChars: systemPrompt.length,
				noSystemRole: this.noSystemRole,
				tools: !!onToolCall,
				resumeMode: conversation.resumeMode ?? "full",
				historySkipped: conversation.resumeMode === "summary",
			});
		}

		this.loopMessages = [...apiMessages];

		// Splice PDF file blocks onto the final user message. This is the
		// first array-content message in this file — a narrow cast is used
		// rather than widening OAIMessage/OAILoopMessage, which would ripple
		// into every other loopMessages.push(...) call in the tool loop below.
		if (pdfAttachments.length > 0) {
			const last = this.loopMessages[this.loopMessages.length - 1];
			if (last.role === "user" && typeof last.content === "string") {
				const fileParts: OpenAI.Chat.Completions.ChatCompletionContentPart.File[] = pdfAttachments.map((pdf) => ({
					type: "file",
					file: { file_data: `data:application/pdf;base64,${pdf.base64}`, filename: pdf.filename },
				}));
				(this.loopMessages[this.loopMessages.length - 1] as { content: unknown }).content =
					[...fileParts, { type: "text", text: last.content }];
			}
		}

		this.openaiTools = onToolCall
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
		let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | undefined;

		for (let attempt = 0; !stream; ) {
			try {
				stream = await this.getClient().chat.completions.create(
					{
						model: this.streamModel,
						...(this.noSystemRole
							? { max_completion_tokens: this.streamMaxTokens }
							: { max_tokens: this.streamMaxTokens }),
						...(this.streamTemperature !== undefined ? { temperature: this.streamTemperature } : {}),
						...(this.streamReasoningEffort !== undefined ? { reasoning_effort: this.streamReasoningEffort } : {}),
						messages: this.loopMessages,
						stream: true,
						stream_options: { include_usage: true },
						...(this.openaiTools?.length ? { tools: this.openaiTools } : {}),
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
		let inputTokens = 0;
		let outputTokens = 0;
		let hasUsage = false;

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			if (delta?.content) {
				onToken(delta.content);
			}
			// Accumulate streaming tool call fragments
			if (delta?.tool_calls) {
				for (const tc of delta.tool_calls) {
					// OpenAI always sends `index`; the fallback guards a provider/shim
					// that omits it, so parallel calls don't all collapse into slot 0:
					// a fresh `id` starts a new call, an argument-only fragment continues
					// the current one.
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
					if (tc.function?.arguments) pendingCalls[idx].arguments += tc.function.arguments;
				}
			}
			if (chunk.choices[0]?.finish_reason) {
				finishReason = chunk.choices[0].finish_reason;
			}
			if (chunk.usage) {
				hasUsage = true;
				inputTokens += chunk.usage.prompt_tokens;
				outputTokens += chunk.usage.completion_tokens;
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
			this.loopMessages.push({
				role: "tool" as const,
				tool_call_id: tc.id,
				content: result,
			});
		}
	}
}
