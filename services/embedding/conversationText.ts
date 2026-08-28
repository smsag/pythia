import type { Conversation } from "../../models/types";

/**
 * Split a conversation into the text chunks that get embedded. A lead chunk pairs
 * the title with the LLM summary (a dense topical fingerprint); the message bodies
 * then pack into ~`maxChars` chunks so a long chat contributes several vectors and
 * a topic buried deep still gets its own chunk. A single over-long message is hard-
 * split. `maxChars` should track the model's token budget (≈4 chars/token).
 *
 * Pure and deterministic: the same conversation content always yields the same
 * chunks, which is what `conversationContentHash` relies on for incremental reuse.
 */
export function conversationChunks(conv: Conversation, maxChars = 500): string[] {
	const chunks: string[] = [];

	const lead = [conv.name, conv.summaryText ?? ""]
		.map((s) => s.trim())
		.filter(Boolean)
		.join(". ")
		.trim();
	if (lead) chunks.push(lead);

	let buf = "";
	const flush = () => {
		if (buf.trim()) chunks.push(buf.trim());
		buf = "";
	};
	for (const m of conv.messages) {
		let text = m.content.trim();
		if (!text) continue;
		// Hard-split a message that alone exceeds the budget.
		while (text.length > maxChars) {
			flush();
			chunks.push(text.slice(0, maxChars));
			text = text.slice(maxChars);
		}
		if (buf && buf.length + text.length + 1 > maxChars) flush();
		buf = buf ? `${buf}\n${text}` : text;
	}
	flush();

	// Guarantee at least one chunk so every conversation is embeddable/indexable.
	if (chunks.length === 0) chunks.push((conv.name || "").trim() || conv.id);
	return chunks;
}
