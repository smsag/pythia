import type { Conversation, Message } from "../models/types";
import { answerIds } from "./comparison";

/**
 * Remove one exchange — a user turn and, when present, the answer that follows
 * it — from a conversation, keeping every derived record consistent: the
 * save boundary, and the favorites and merge links that pointed at the
 * removed answer. One implementation (principle 4): the delete bar and the
 * raise-and-retry action under a cut-off answer (ADR-162) both splice an
 * exchange, and the second hand-rolled copy is where a favorite would leak.
 *
 * Returns the removed messages, or `null` when `userId` is not in the
 * conversation. Mutates in place; the caller saves.
 */
export function spliceExchange(
	conv: Conversation,
	userId: string,
	assistantId: string | null,
): { user: Message; assistant: Message | null } | null {
	const userIdx = conv.messages.findIndex((m) => m.id === userId);
	if (userIdx === -1) return null;
	const user = conv.messages[userIdx];
	const next = conv.messages[userIdx + 1];
	const assistant = assistantId && next?.id === assistantId ? next : null;
	const removeCount = assistant ? 2 : 1;
	conv.messages.splice(userIdx, removeCount);
	if (conv.lastSavedMessageCount !== undefined && conv.lastSavedMessageCount > userIdx) {
		conv.lastSavedMessageCount = Math.max(0, conv.lastSavedMessageCount - removeCount);
	}
	if (assistant) {
		// The answer's tabs go with it, and so does whatever was marked on them (ADR-223).
		const gone = new Set(answerIds(assistant));
		if (conv.favorites?.length) conv.favorites = conv.favorites.filter((f) => !gone.has(f.messageId));
		if (conv.merges?.length) conv.merges = conv.merges.filter((l) => !gone.has(l.messageId));
	}
	return { user, assistant };
}
