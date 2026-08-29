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

	// Defensive coercion: persistence only guarantees `messages` is an array — not
	// that each element is an object or that `name`/`summaryText`/`content` are
	// strings. This runs over the whole corpus on every index sync, so one
	// malformed record (null element, undefined content, e.g. an interrupted
	// stream) must not throw and take related-conversations down with it.
	const asText = (v: unknown): string => (typeof v === "string" ? v : "");

	const lead = [asText(conv.name), asText(conv.summaryText)]
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
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	for (const m of messages) {
		let text = asText(m?.content).trim();
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
	if (chunks.length === 0) chunks.push(asText(conv.name).trim() || conv.id);
	return chunks;
}
