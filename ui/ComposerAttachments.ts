import type { Conversation } from "../models/types";
import { noteBasename } from "../services/pathUtils";
import type { ComposerField } from "./ComposerField";
import type { ComposerPart } from "./composerText";
import {
	noteToken, removeToken, tokenSpacing, tokensPresent, type TrackedNote,
} from "./composerTokens";

export interface ComposerAttachmentsDeps {
	inputEl(): ComposerField;
	getConversation(): Conversation | null;
	saveConversation(conv: Conversation): void;
	refreshPills(): void;
	/** The composer grew or shrank by a link — resize it and re-estimate. */
	onComposerChanged(): void;
}

/**
 * The notes a composition attached, and the links standing for them in the
 * composer (ADR-211).
 *
 * `InlineSuggest` needs no part of this: it still removes its own `#query` and
 * leaves the cursor where it was, and the link goes in there. The trigger text
 * belongs to the picker; the link belongs here.
 *
 * Two things this owns are easy to get wrong:
 *
 * - **Sync, not detach.** Every input event makes `contextNotes` match the links
 *   actually present, in both directions — so an undo that brings a link back
 *   re-attaches its note instead of leaving the composer disagreeing with the
 *   row above it.
 * - **A link is a chip, and a chip reads as its link** (D-52). The composer draws
 *   each tracked token as one atom with the vault-note icon, but its text is
 *   still `[[Name]]` — so the count below, the send and the model are unchanged.
 *   `chips()` is how the field knows which tokens to draw that way.
 * - **Tracking is cleared on send, not on attach.** A note stays attached to the
 *   conversation afterwards (that is what `contextNotes` means), but its link has
 *   left the composer with the message, so there is nothing left to delete. This
 *   is what stops a stray edit three turns later from detaching a note earlier
 *   answers were built on: by then the pill's × is the only handle, which is
 *   exactly what it was before this feature.
 */
export class ComposerAttachments {
	private tracked: TrackedNote[] = [];

	constructor(private readonly d: ComposerAttachmentsDeps) {}

	/** A note (or a folder's worth) picked from the `#` menu. */
	attach(paths: string[]): void {
		const conv = this.d.getConversation();
		if (!conv || paths.length === 0) return;

		const input = this.d.inputEl();
		const tokens = paths.map(noteToken);
		const at = input.selectionStart;
		const { lead, trail } = tokenSpacing(input.value, at);
		const parts: ComposerPart[] = [];
		if (lead) parts.push(lead);
		tokens.forEach((token, i) => {
			if (i > 0) parts.push(" ");
			parts.push({ token, label: noteBasename(paths[i]) });
		});
		if (trail) parts.push(trail);
		input.insertAt(at, parts);

		let changed = false;
		for (let i = 0; i < paths.length; i++) {
			const path = paths[i];
			// One entry per path even if it is picked twice: the second link is then
			// a second occurrence of a token already tracked, so deleting one of the
			// two leaves the note attached — which is what the remaining link says.
			if (!this.tracked.some((n) => n.path === path)) {
				this.tracked.push({ path, token: tokens[i] });
			}
			if (!conv.contextNotes.includes(path)) { conv.contextNotes.push(path); changed = true; }
		}
		if (changed) this.d.saveConversation(conv);
		this.d.refreshPills();
		this.d.onComposerChanged();
	}

	/**
	 * Make the attachments match the links in the composer. Called on every
	 * keystroke, and costs one string scan per note THIS composition attached —
	 * proportional to what the user did, never to the vault (principle 5).
	 */
	sync(): void {
		if (this.tracked.length === 0) return;
		const conv = this.d.getConversation();
		if (!conv) return;

		const { present, absent } = tokensPresent(this.d.inputEl().value, this.tracked);
		let changed = false;
		for (const path of absent) {
			if (conv.contextNotes.includes(path)) {
				conv.contextNotes = conv.contextNotes.filter((n) => n !== path);
				changed = true;
			}
		}
		for (const path of present) {
			if (!conv.contextNotes.includes(path)) { conv.contextNotes.push(path); changed = true; }
		}
		if (!changed) return;
		this.d.saveConversation(conv);
		this.d.refreshPills();
	}

	/** A pill's × removed this note — take its link out of the composer too, so
	 *  the two handles never disagree. The pill has already detached it. */
	forget(path: string): void {
		const index = this.tracked.findIndex((n) => n.path === path);
		if (index === -1) return;
		const [note] = this.tracked.splice(index, 1);
		const input = this.d.inputEl();
		const next = removeToken(input.value, note.token);
		if (next === input.value) return;
		const cursor = Math.min(input.selectionStart, next.length);
		input.value = next;
		input.setSelectionRange(cursor, cursor);
		this.d.onComposerChanged();
	}

	/** The tokens the composer draws as chips, each with its note's name. */
	chips(): ReadonlyMap<string, string> {
		return new Map(this.tracked.map((n) => [n.token, noteBasename(n.path)]));
	}

	/** The message went; its links went with it. The notes stay attached. */
	clear(): void {
		this.tracked = [];
	}
}
