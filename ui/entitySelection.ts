/**
 * Reading a glossary-entity selection out of the DOM (ADR-151).
 *
 * Define (a term) and Person resolve against different sources but accept the
 * same *shape* of selection: a short span inside an assistant answer, with the
 * whole message as its passage. That rule was written twice the moment people
 * were added — this is the one copy.
 *
 * Assistant content only, because the terminology and the names that need
 * explaining are the model's. The whole message is the passage because the sense
 * of a term, and the identity of a person, is usually fixed a sentence or two
 * away from where the word itself appears.
 */
export interface EntitySelection {
	text: string;
	/** The full text of the message the selection sits in. */
	passage: string;
}

export type EntitySelectionResult =
	| { ok: true; selection: EntitySelection }
	/** Not assistant content, or nothing selected — dismiss silently. */
	| { ok: false; reason: "not-applicable" }
	/** A real selection, but too long to be an entry — tell the user. */
	| { ok: false; reason: "too-long" };

export function readEntitySelection(maxWords: number): EntitySelectionResult {
	const sel = window.getSelection();
	const text = (sel?.toString() ?? "").trim();
	const anchor = sel?.anchorNode;
	const msgEl = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("[data-msg-id]");
	if (!msgEl || msgEl.classList.contains("p-msg-user")) return { ok: false, reason: "not-applicable" };

	const words = text.split(/\s+/).filter(Boolean).length;
	if (!text || words > maxWords || text.length > 60) return { ok: false, reason: "too-long" };

	return { ok: true, selection: { text, passage: msgEl.textContent ?? "" } };
}
