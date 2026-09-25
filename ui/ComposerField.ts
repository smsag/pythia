import { appendSourceIcon } from "./icons";
import {
	CHIP_CLASS, composerText, domPosition, partsFor, textOffset, type ComposerPart,
} from "./composerText";

type Register = <K extends keyof HTMLElementEventMap>(
	el: HTMLElement, type: K, handler: (e: HTMLElementEventMap[K]) => void,
) => void;

export interface ComposerFieldOptions {
	placeholder: string;
	/** The view's `registerDomEvent`, so every listener dies with the view. */
	register: Register;
	/** The tokens that draw as chips, and each one's label — the notes this
	 *  composition attached. Read whenever a whole value is set. */
	chips(): ReadonlyMap<string, string>;
}

/**
 * The composer: a `contenteditable` that holds text and note chips (D-52).
 *
 * It keeps a textarea's surface — `value`, `selectionStart`, `setSelectionRange`,
 * `disabled`, `focus` — so the picker, the send shortcut and the optimizer did
 * not have to learn a second kind of input. Every offset is in the TEXT the
 * field reads as (`composerText`), where a chip is its `[[Name]]` token: that is
 * what ADR-211's count sees and what the model is sent.
 *
 * Edits go through `execCommand` wherever the browser allows, because only those
 * enter the native undo stack — and undo is what re-attaches a note whose chip
 * was deleted. A browser (or a test DOM) without it gets the same result by DOM
 * edits, without undo.
 */
export class ComposerField {
	readonly el: HTMLDivElement;
	/** The caret, in text offsets, as of the last time the field had it — a
	 *  textarea keeps its selection when it loses focus, and so does this. */
	private lastCursor = 0;

	constructor(parent: HTMLElement, private readonly o: ComposerFieldOptions) {
		this.el = parent.createDiv({
			cls: "p-composer",
			attr: {
				contenteditable: "true",
				role: "textbox",
				"aria-multiline": "true",
				"aria-label": o.placeholder,
				"data-placeholder": o.placeholder,
				spellcheck: "true",
			},
		});
		this.el.addClass("is-empty");
		const remember = (): void => { this.lastCursor = this.readCursor() ?? this.lastCursor; };
		o.register(this.el, "input", () => { remember(); this.refreshEmpty(); this.drawChipIcons(); });
		o.register(this.el, "keyup", remember);
		o.register(this.el, "pointerup", remember);
		o.register(this.el, "blur", remember);
		o.register(this.el, "copy", (e) => this.onCopy(e, false));
		o.register(this.el, "cut", (e) => this.onCopy(e, true));
		o.register(this.el, "paste", (e) => this.onPaste(e));
		o.register(this.el, "drop", (e) => this.onDrop(e));
	}

	// ── The textarea surface ───────────────────────────────────────────────

	get value(): string {
		return composerText(this.el);
	}

	/** Replace everything. A tracked note's token comes back as its chip; the
	 *  caret goes to the end, as it does in a textarea. */
	set value(text: string) {
		this.el.replaceChildren(...this.nodesFor(partsFor(text, this.o.chips())));
		this.lastCursor = text.length;
		this.refreshEmpty();
		if (this.focused()) this.setSelectionRange(text.length, text.length);
	}

	get selectionStart(): number {
		return this.readCursor() ?? Math.min(this.lastCursor, this.value.length);
	}

	/** Place the caret or a selection. Only moves the DOM selection when the field
	 *  has focus: taking it would raise the soft keyboard on a phone. */
	setSelectionRange(start: number, end: number): void {
		this.lastCursor = end;
		if (!this.focused()) return;
		const a = domPosition(this.el, start);
		const b = domPosition(this.el, end);
		this.el.ownerDocument.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
	}

	get disabled(): boolean {
		return this.el.getAttribute("contenteditable") === "false";
	}

	set disabled(off: boolean) {
		this.el.setAttribute("contenteditable", off ? "false" : "true");
		this.el.setAttribute("aria-disabled", String(off));
		this.el.toggleClass("is-disabled", off);
	}

	focus(): void {
		this.el.focus();
		this.setSelectionRange(this.lastCursor, this.lastCursor);
	}

	// ── Edits ──────────────────────────────────────────────────────────────

	/** Replace `[start, end)` with `text` (empty text deletes it). A tracked
	 *  note's token in `text` goes in as its chip. */
	replaceRange(start: number, end: number, text: string): void {
		if (start === end && !text) return;
		if (this.focused()) {
			this.setSelectionRange(start, end);
			const parts = partsFor(text, this.o.chips());
			const done = !text ? this.exec("delete", "")
				: parts.some((p) => typeof p !== "string") ? this.exec("insertHTML", parts.map(partHtml).join(""))
				: this.exec("insertText", text);
			if (done) { this.afterEdit(); return; }
		}
		const v = this.value;
		this.value = v.slice(0, start) + text + v.slice(end);
		this.setSelectionRange(start + text.length, start + text.length);
	}

	/** Insert text and chips at `at`; the caret ends after them. */
	insertAt(at: number, parts: readonly ComposerPart[]): void {
		const length = parts.reduce((n, p) => n + (typeof p === "string" ? p.length : p.token.length), 0);
		if (this.focused()) {
			this.setSelectionRange(at, at);
			if (this.exec("insertHTML", parts.map(partHtml).join(""))) { this.afterEdit(); return; }
		}
		const point = domPosition(this.el, at);
		const nodes = this.nodesFor(parts);
		if (point.node.nodeType === 3) {
			const rest = (point.node as Text).splitText(point.offset);
			rest.before(...nodes);
		} else {
			const ref = point.node.childNodes[point.offset] ?? null;
			for (const n of nodes) point.node.insertBefore(n, ref);
		}
		this.refreshEmpty();
		this.setSelectionRange(at + length, at + length);
	}

	// ── Internals ──────────────────────────────────────────────────────────

	private focused(): boolean {
		return this.el.ownerDocument.activeElement === this.el;
	}

	/** The caret in text offsets, or null when the selection is not in here. */
	private readCursor(): number | null {
		const sel = this.el.ownerDocument.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		if (!this.el.contains(range.startContainer)) return null;
		return textOffset(this.el, { node: range.startContainer, offset: range.startOffset });
	}

	private selectedRange(): [number, number] | null {
		const sel = this.el.ownerDocument.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const r = sel.getRangeAt(0);
		if (!this.el.contains(r.startContainer) || !this.el.contains(r.endContainer)) return null;
		return [
			textOffset(this.el, { node: r.startContainer, offset: r.startOffset }),
			textOffset(this.el, { node: r.endContainer, offset: r.endOffset }),
		];
	}

	/** `execCommand` is deprecated but is the only edit that enters the native
	 *  undo stack of an editable element. False = do it by hand. */
	private exec(command: string, arg: string): boolean {
		try {
			return this.el.ownerDocument.execCommand(command, false, arg);
		} catch {
			return false; // not supported here (a test DOM): the caller edits the DOM instead
		}
	}

	private afterEdit(): void {
		this.drawChipIcons();
		this.refreshEmpty();
		this.lastCursor = this.readCursor() ?? this.lastCursor;
	}

	private nodesFor(parts: readonly ComposerPart[]): Node[] {
		return parts.map((p) => {
			if (typeof p === "string") return this.el.ownerDocument.createTextNode(p);
			const chip = this.el.ownerDocument.createElement("span");
			chip.className = CHIP_CLASS;
			chip.setAttribute("contenteditable", "false");
			chip.dataset.token = p.token;
			chip.append(this.icon(), this.el.ownerDocument.createTextNode(p.label));
			return chip;
		});
	}

	private icon(): HTMLElement {
		const icon = appendSourceIcon(this.el.ownerDocument.createElement("span"), "note");
		icon.remove();
		return icon;
	}

	/** A chip inserted as HTML (the undoable path) arrives without its icon;
	 *  an SVG is not something to hand-write into a string. */
	private drawChipIcons(): void {
		for (const chip of Array.from(this.el.querySelectorAll<HTMLElement>(`.${CHIP_CLASS}`))) {
			if (!chip.querySelector(".p-source-icon")) chip.prepend(this.icon());
		}
	}

	private refreshEmpty(): void {
		this.el.toggleClass("is-empty", this.value.length === 0);
	}

	/** A chip copies as its token, so it pastes back into a note as a link. */
	private onCopy(e: ClipboardEvent, cut: boolean): void {
		const range = this.selectedRange();
		if (!range || !e.clipboardData) return; // nothing of ours selected: the browser's copy stands
		e.preventDefault();
		e.clipboardData.setData("text/plain", this.value.slice(range[0], range[1]));
		if (cut && !this.disabled) this.replaceRange(range[0], range[1], "");
	}

	/** Paste is text only — no pasted markup, colour or image reaches the field. */
	private onPaste(e: ClipboardEvent): void {
		if (!e.clipboardData) return;
		e.preventDefault();
		const [start, end] = this.selectedRange() ?? [this.selectionStart, this.selectionStart];
		this.replaceRange(start, end, e.clipboardData.getData("text/plain"));
	}

	private onDrop(e: DragEvent): void {
		const text = e.dataTransfer?.getData("text/plain");
		if (!text) return;
		e.preventDefault();
		const at = this.selectionStart;
		this.replaceRange(at, at, text);
	}
}

/** One part as markup for `insertHTML`. Every string is escaped: a note name is
 *  user data, and `<` is a legal character in one. */
function partHtml(p: ComposerPart): string {
	if (typeof p === "string") return escapeHtml(p).replace(/\n/g, "<br>");
	return `<span class="${CHIP_CLASS}" contenteditable="false" data-token="${escapeHtml(p.token)}">${escapeHtml(p.label)}</span>`;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

