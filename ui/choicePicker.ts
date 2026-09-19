import { Platform, setIcon } from "obsidian";
import { ActionSheet, type ActionSheetItem } from "./ActionSheet";
import { attachOutsideDismiss } from "./outsideDismiss";

/** One row in a header picker or menu (ADR-165). */
export type ChoiceItem = ActionSheetItem;

export interface ChoicePickerOptions {
	/** The view content pane (`containerEl.children[1]`) — the popover mounts here. */
	container: HTMLElement;
	/** The control that opened the picker; the popover hangs below it. */
	anchor: HTMLElement;
	title?: string;
	items: ChoiceItem[];
	/** Reused bottom sheet for mobile (one per view). */
	sheet: ActionSheet;
}

/**
 * Position `pop` below `anchor`, right-aligned to it and kept inside
 * `container`, with its height capped to the space left below. Absolute within
 * the (position: relative) view root, so an Obsidian ancestor that turns
 * `position: fixed` into a clipped containing block cannot misplace it. Shared
 * by the model popover and every choice picker (principle 4).
 */
export function placeBelow(container: HTMLElement, anchor: HTMLElement, pop: HTMLElement, width: number): void {
	const cRect = container.getBoundingClientRect();
	const rect = anchor.getBoundingClientRect();
	const top = rect.bottom - cRect.top + 4;
	let left = rect.right - cRect.left - width;
	left = Math.max(4, Math.min(left, cRect.width - width - 4));
	pop.style.position = "absolute";
	pop.style.top = `${top}px`;
	pop.style.left = `${left}px`;
	pop.style.width = `${width}px`;
	pop.style.maxHeight = `${Math.max(120, cRect.height - top - 8)}px`;
}

/**
 * Open a short list of choices for one header control: an anchored popover on
 * desktop, the bottom action sheet on mobile — the same split the Send menu
 * uses. Each row can carry a one-line explanation, because the reason to pick
 * it must be readable without hover (ADR-165). Returns a close function; the
 * anchor carries `.open` while the popover is up.
 */
export function openChoicePicker(o: ChoicePickerOptions): () => void {
	if (Platform.isMobile) {
		o.sheet.open(o.items, { title: o.title });
		return () => o.sheet.close();
	}

	const pop = o.container.createDiv({ cls: "p-choice-pop" });
	const width = Math.round(Math.min(280, Math.max(200, o.container.getBoundingClientRect().width - 24)));
	placeBelow(o.container, o.anchor, pop, width);
	o.anchor.addClass("open");
	if (o.title) pop.createDiv({ cls: "p-choice-title", text: o.title });

	let closed = false;
	const close = (): void => {
		if (closed) return;
		closed = true;
		detach();
		pop.remove();
		o.anchor.removeClass("open");
	};
	const detach = attachOutsideDismiss(
		(target) => pop.contains(target) || o.anchor.contains(target),
		close,
		{ escape: true },
	);

	for (const item of o.items) {
		const row = pop.createDiv({ cls: "p-choice-row" });
		row.toggleClass("is-active", !!item.active);
		row.toggleClass("is-disabled", !!item.disabled);
		const icon = row.createSpan({ cls: "p-choice-icon" });
		const glyph = item.icon || (item.active ? "check" : "");
		if (glyph) setIcon(icon, glyph);
		const text = row.createDiv({ cls: "p-choice-text" });
		text.createSpan({ cls: "p-choice-label", text: item.label });
		if (item.detail) text.createSpan({ cls: "p-choice-detail", text: item.detail });
		if (item.disabled) continue;
		if (item.trailing) {
			const tr = item.trailing;
			const btn = row.createEl("button", {
				cls: "pb pb-icon p-choice-trailing",
				attr: { "aria-label": tr.label, title: tr.label },
			});
			setIcon(btn, tr.icon);
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation(); // never reaches the row: the other verb
				close();
				tr.onSelect();
			});
		}
		// mousedown, not click: keeps focus where it was, like the model popover.
		row.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			close();
			item.onSelect();
		});
	}
	return close;
}
