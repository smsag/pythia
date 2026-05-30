import OpenAI from "openai";
import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";
import { getToolDefinitions } from "./ToolHandler";

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

function parseTitleAndSummary(raw: string): { title: string; summary: string } {
	// Use multiline anchors so ^ / $ match line boundaries.
	// \s* after SUMMARY: handles both "SUMMARY: content" (same line) and
	// "SUMMARY:\ncontent" (next line) — the greedy \s* consumes the separator
	// whitespace/newline, and ([\s\S]*) captures everything that follows.
	const titleMatch   = raw.match(/^TITLE:\s*(.+)/im);
	const summaryMatch = raw.match(/^SUMMARY:\s*([\s\S]*)/im);
	const title   = titleMatch   ? titleMatch[1].trim()   : "";
	const summary = summaryMatch
		? summaryMatch[1].trim()
		// Fallback: strip the TITLE line and any SUMMARY: prefix that leaked through.
		: raw
			.replace(/^TITLE:.*\n?/im, "")
			.replace(/^SUMMARY:[ \t]*/im, "")
			.trim();
	return { title, summary };
}

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

/** Returns a language instruction suffix, or "" when set to auto. */
function langInstruction(lang: string): string {
	return lang === "auto" ? "" : `\n\nRespond in ${lang}.`;
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

			const model = conversation.model || this.settings.defaultOpenAIModel;
			const noSystemRole = NO_SYSTEM_ROLE_MODELS.has(model);

			// Exclude the last message — already pushed by the caller; sending it
			// again in history would duplicate it.
			const historyMessages: OAIMessage[] = conversation.messages.slice(0, -1).map(
				(m) => ({ role: m.role as "user" | "assistant", content: m.content })
			);

			let apiMessages: OAIMessage[];

			if (systemPrompt && noSystemRole) {
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

			const loopMessages: OAILoopMessage[] = [...apiMessages];

			const openaiTools = onToolCall
				? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder).map((def) => ({
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
					content: `Provide a concise summary of this conversation for future reference. Include: key decisions made, main topics discussed, and any important outputs or conclusions. Be brief — this will be used as context when the conversation is resumed. Do not start with a heading or "Summary of…" — begin directly with the content.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
				},
			],
		});

		return response.choices[0]?.message?.content ?? "";
	}

	async generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }> {
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
					content: `Give this conversation a concise title and a brief summary.\n\nReply in EXACTLY this format — no other text before or after:\nTITLE: <3-6 word title, no punctuation, no quotes>\nSUMMARY:\n<summary here>\n\nFor the summary: include key decisions, main topics, and important conclusions. Begin directly with content — no "Summary of…" heading.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
				},
			],
		});

		const raw = response.choices[0]?.message?.content ?? "";
		return parseTitleAndSummary(raw);
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

	async generateChapterName(content: string): Promise<string> {
		const client = this.getClient();
		const excerpt = content.slice(0, 500);
		const response = await client.chat.completions.create({
			model: "gpt-4o-mini",
			max_tokens: 15,
			messages: [{
				role: "user",
				content: `Summarize this user message in 3-5 words as a chapter title. Reply with ONLY the title, no punctuation, no quotes.${langInstruction(this.settings.outputLanguage)}\n\nMessage:\n${excerpt}`,
			}],
		});
		return response.choices[0]?.message?.content?.trim() ?? "";
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
				content: `Give this conversation a concise 3-5 word title. Reply with ONLY the title, no punctuation, no quotes.${langInstruction(this.settings.outputLanguage)}\n\nUser: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`,
			}],
		});
		return response.choices[0]?.message?.content?.trim() ?? "New Conversation";
	}

	async summarizeNotes(content: string): Promise<string> {
		const client = this.getClient();
		const response = await client.chat.completions.create({
			model: "gpt-4o-mini",
			max_tokens: 1024,
			messages: [{
				role: "user",
				content: `Summarize the following note(s) concisely. Focus on key topics, decisions, and insights.${langInstruction(this.settings.outputLanguage)}\n\n${content}`,
			}],
		});
		return response.choices[0]?.message?.content?.trim() ?? "";
	}
}
