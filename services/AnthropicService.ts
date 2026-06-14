import Anthropic from "@anthropic-ai/sdk";
import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";
import { getToolDefinitions } from "./ToolHandler";
import { normalizeMessages } from "./messageUtils";
import { BaseProvider } from "./BaseProvider";

type ApiMessage = { role: "user" | "assistant"; content: string };

export class AnthropicService extends BaseProvider {
	private client: Anthropic | null = null;

	constructor(app: App, settings: PythiaSettings, apiKey: string) {
		super(app, settings, apiKey);
	}

	protected resetClient(): void {
		this.client = null;
	}

	protected get fastModel(): string {
		return "claude-haiku-3-5";
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

		let fullText = "";

		try {
			const { content: attachedContent, missingNotes } =
				await buildAttachedNotesContent(this.app, attachedNotes);
			const userContent = newMessage + attachedContent;
			const systemPrompt = buildSystemPrompt(conversation);

			if (missingNotes.length > 0) {
				new Notice(t("contextNotesWarning", { count: missingNotes.length }));
			}

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it.
			const historyMessages: ApiMessage[] = conversation.messages.slice(0, -1).map(
				(m) => ({ role: m.role, content: m.content })
			);

			const model = this.resolveModel(conversation.model);
			const maxTokens = conversation.maxTokens ?? 4096;

			if (this.settings.debugMode) {
				console.log("[Pythia] Anthropic API call →", {
					model,
					messages: historyMessages.length + 1,
					systemPromptChars: systemPrompt.length,
					tools: !!onToolCall,
				});
			}

			// Anthropic requires the first message to be "user" (no system role in messages array).
			const loopMessages: Anthropic.MessageParam[] = normalizeMessages(
				[...historyMessages, { role: "user" as const, content: userContent }],
				role => role !== "user"
			).map((m) => ({ role: m.role, content: m.content }));

			const anthropicTools: Anthropic.Tool[] | undefined = onToolCall
				? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder, conversation.writeMode).map((def) => ({
						name: def.name,
						description: def.description,
						input_schema: def.inputSchema as Anthropic.Tool.InputSchema,
				  }))
				: undefined;

			let totalInputTokens = 0;
			let totalOutputTokens = 0;

			while (true) {
				const stream = this.getClient().messages.stream(
					{
						model,
						max_tokens: maxTokens,
						...(systemPrompt ? { system: systemPrompt } : {}),
						messages: loopMessages,
						...(anthropicTools?.length ? { tools: anthropicTools } : {}),
					},
					{ signal: this.abortController.signal }
				);

				stream.on("text", (text) => {
					fullText += text;
					onToken(text);
				});

				const finalMsg = await stream.finalMessage();
				totalInputTokens += finalMsg.usage.input_tokens;
				totalOutputTokens += finalMsg.usage.output_tokens;

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
			};
			onComplete(fullText, tokenUsage);
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
}
