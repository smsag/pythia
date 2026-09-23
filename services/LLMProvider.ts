import type { Conversation, ToolCall, TokenUsage, StreamFinish } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { TranslatedDefinition } from "./glossaryReply";

export interface LLMProvider {
	updateSettings(settings: PythiaSettings): void;
	updateApiKey(key: string): void;
	abort(): void;
	streamMessage(
		conversation: Conversation,
		newMessage: string,
		attachedNotes: string[],
		onToken: (text: string) => void,
		onComplete: (fullText: string, tokenUsage?: TokenUsage, finish?: StreamFinish) => void,
		onError: (error: Error) => void,
		onToolCall?: (call: ToolCall) => Promise<string>,
		/** Which of `attachedNotes` the vault-RAG hook added rather than the user
		 *  (ADR-183). They get a tighter excerpt budget, and the warnings about
		 *  missing or oversized notes stay off them — the user did not attach them
		 *  and cannot remove them. */
		autoNotes?: ReadonlySet<string>
	): Promise<void>;
	generateSummary(conversation: Conversation): Promise<string>;
	generateSummaryWithTitle(conversation: Conversation): Promise<{ title: string; summary: string }>;
	generateFavoritesSummary(conversation: Conversation): Promise<string>;
	generateChapterName(content: string, conversation?: Conversation): Promise<string>;
	/** Define `term` as used in `passage` (ADR-136); `senseHint` corrects the sense (ADR-208). */
	defineTerm(term: string, passage: string, conversation?: Conversation, senseHint?: string): Promise<string>;
	/** Distil a conversation forked from `term` back into its note (ADR-208). */
	summarizeTermDiscussion(term: string, definition: string, conversation: Conversation): Promise<string>;
	describePerson(name: string, passage: string, conversation?: Conversation): Promise<string>;
	/** Translate a stored glossary definition into `language` (an English language name) — ADR-166.
	 *  `term` asks for the term's equivalent in that language in the same reply (ADR-206); omit it
	 *  for a person, whose name is not translated. */
	translateDefinition(definition: string, language: string, term?: string): Promise<TranslatedDefinition>;
	/** The model `defineTerm` and the other utility calls run on. */
	readonly fastModel: string;
	generateConversationTitle(
		userMessage: string,
		assistantMessage: string,
		conversation?: Conversation
	): Promise<string>;
	retitleConversation(conversation: Conversation): Promise<string>;
	summarizeNotes(content: string, conversation?: Conversation): Promise<string>;
	optimizePrompt(systemPrompt: string, userMessage: string, model?: string): Promise<string>;
}
