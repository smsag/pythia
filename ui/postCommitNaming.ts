import type PythiaPlugin from "../main";
import type { Conversation, Message } from "../models/types";
import { shouldGenerateChapterName, shouldGenerateTitle } from "../services/sendPolicy";

export interface NamingDeps {
	plugin: PythiaPlugin;
	/** The conversation the view shows now — the header is repainted only for it. */
	activeId(): string | undefined;
	setConvName(name: string): void;
}

/**
 * After an answer commits: title the conversation on its first exchange, and
 * name the user's turn as a chapter. Both run in the background and report a
 * failure to the console only — a missing title is not worth a Notice.
 *
 * Moved out of `sidebar.ts` unchanged (ADR-097's ratchet, ADR-218 addendum).
 * `fullText` is deliberately the streamed text: a title comes from what the
 * answer SAID, not from the chart blocks spliced into what it stored.
 */
export function nameAfterCommit(d: NamingDeps, conv: Conversation, userMsg: Message, fullText: string): void {
	// A note anchored to this chapter gets its summary, and its footnote (ADR-249).
	d.plugin.noteAnchors?.afterAnswer(conv.id, userMsg.id)
		.catch((e) => console.warn("[Pythia] note anchor update failed:", e));

	if (shouldGenerateTitle(conv)) {
		const convId = conv.id;
		const nameBefore = conv.name;
		d.plugin.llmRouter
			.generateConversationTitle(userMsg.content, fullText, conv.provider, conv)
			.then(async (title) => {
				const c = d.plugin.conversationStore.getById(convId);
				// A rename the user made while the title generated wins: the live
				// name must still be the one the title was asked for.
				if (!c || !title || c.name !== nameBefore) return;
				await d.plugin.renameConversation(c, title);
				if (d.activeId() === convId) d.setConvName(c.name);
			})
			.catch((e) => console.warn("[Pythia] conversation title generation failed:", e));
	}

	if (shouldGenerateChapterName(userMsg)) {
		const convId = conv.id;
		const msgId = userMsg.id;
		d.plugin.llmRouter
			.generateChapterName(userMsg.content, conv.provider, conv)
			.then(async (name) => {
				if (!name) return;
				const c = d.plugin.conversationStore.getById(convId);
				if (!c) return;
				const m = c.messages.find((msg) => msg.id === msgId);
				if (!m) return;
				m.chapterName = name;
				await d.plugin.conversationStore.save(c);
			})
			.catch((e) => console.warn("[Pythia] chapter name generation failed:", e));
	}
}
