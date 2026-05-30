import Anthropic from "@anthropic-ai/sdk";
import { App, Notice } from "obsidian";
import { t } from "../i18n";
import type { Conversation, ToolCall, TokenUsage } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { LLMProvider } from "./LLMProvider";
import { buildSystemPrompt, buildAttachedNotesContent } from "./ContextBuilder";
import { getToolDefinitions } from "./ToolHandler";

type ApiMessage = { role: "user" | "assistant"; content: string };

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

/** Ensure roles alternate and the array starts with 'user', as the API requires. */
function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
	const result: ApiMessage[] = [];
	for (const msg of messages) {
		if (result.length > 0 && result[result.length - 1].role === msg.role) {
			result[result.length - 1].content += "\n\n" + msg.content;
		} else {
			result.push({ ...msg });
		}
	}
	while (result.length > 0 && result[0].role !== "user") {
		result.shift();
	}
	return result;
}

/** Returns a language instruction suffix, or "" when set to auto. */
function langInstruction(lang: string): string {
	return lang === "auto" ? "" : `\n\nRespond in ${lang}.`;
}

export class AnthropicService implements LLMProvider {
	private app: App;
	private settings: PythiaSettings;
	private apiKey = "";
	private client: Anthropic | null = null;
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

			const model = conversation.model || this.settings.defaultAnthropicModel;
			const maxTokens = conversation.maxTokens ?? 4096;

			if (this.settings.debugMode) {
				console.log("[Pythia] Anthropic API call →", {
					model,
					messages: historyMessages.length + 1,
					systemPromptChars: systemPrompt.length,
					tools: !!onToolCall,
				});
			}

			const loopMessages: Anthropic.MessageParam[] = normalizeMessages([
				...historyMessages,
				{ role: "user" as const, content: userContent },
			]).map((m) => ({ role: m.role, content: m.content }));

			const anthropicTools: Anthropic.Tool[] | undefined = onToolCall
				? getToolDefinitions(conversation.outputFolder ?? this.settings.scratchFolder).map((def) => ({
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
						...(anthropicTools ? { tools: anthropicTools } : {}),
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

	async generateSummary(conversation: Conversation): Promise<string> {
		const client = this.getClient();
		const model = conversation.model || this.settings.defaultAnthropicModel;

		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.content}`)
			.join("\n\n");

		const response = await client.messages.create({
			model,
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: `Provide a concise summary of this conversation for future reference. Include: key decisions made, main topics discussed, and any important outputs or conclusions. Be brief — this will be used as context when the conversation is resumed. Do not start with a heading or "Summary of…" — begin directly with the content.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
				},
			],
		});

		const block = response.content[0];
		return block.type === "text" ? block.text : "";
	}

	async generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }> {
		const client = this.getClient();
		const model = conversation.model || this.settings.defaultAnthropicModel;

		const conversationText = conversation.messages
			.map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.content}`)
			.join("\n\n");

		const langSuffix = this.settings.outputLanguage !== "auto"
			? ` in ${this.settings.outputLanguage}`
			: "";
		const response = await client.messages.create({
			model,
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: `Give this conversation a concise title and a brief summary.\n\nReply in EXACTLY this format — no other text before or after:\nTITLE: <3-6 word title${langSuffix}, no punctuation, no quotes>\nSUMMARY:\n<summary${langSuffix} here>\n\nFor the summary: include key decisions, main topics, and important conclusions. Begin directly with content — no "Summary of…" heading.${langInstruction(this.settings.outputLanguage)}\n\n${conversationText}`,
				},
			],
		});

		const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
		return parseTitleAndSummary(raw);
	}

	async generateChapterName(content: string): Promise<string> {
		const client = this.getClient();
		const excerpt = content.slice(0, 500);
		const response = await client.messages.create({
			model: "claude-haiku-3-5",
			max_tokens: 15,
			messages: [{
				role: "user",
				content: `Summarize this user message in 3-5 words as a chapter title. Reply with ONLY the title, no punctuation, no quotes.${langInstruction(this.settings.outputLanguage)}\n\nMessage:\n${excerpt}`,
			}],
		});
		const block = response.content[0];
		return block.type === "text" ? block.text.trim() : "";
	}

	async generateConversationTitle(userMessage: string, assistantMessage: string): Promise<string> {
		const client = this.getClient();
		const userExcerpt = userMessage.slice(0, 300);
		const assistantExcerpt = assistantMessage.slice(0, 300);
		const response = await client.messages.create({
			model: "claude-haiku-3-5",
			max_tokens: 20,
			messages: [{
				role: "user",
				content: `Give this conversation a concise 3-5 word title. Reply with ONLY the title, no punctuation, no quotes.${langInstruction(this.settings.outputLanguage)}\n\nUser: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`,
			}],
		});
		const block = response.content[0];
		return block.type === "text" ? block.text.trim() : "New Conversation";
	}

	async summarizeNotes(content: string): Promise<string> {
		const client = this.getClient();
		const response = await client.messages.create({
			model: "claude-haiku-3-5",
			max_tokens: 1024,
			messages: [{
				role: "user",
				content: `Summarize the following note(s) concisely. Focus on key topics, decisions, and insights.${langInstruction(this.settings.outputLanguage)}\n\n${content}`,
			}],
		});
		const block = response.content[0];
		return block.type === "text" ? block.text.trim() : "";
	}
}
