import { setIcon } from "obsidian";

/**
 * The one collapsible box above the conversation (ADR-192): the context
 * inspector and the summary cards were two hand-built accordions that had
 * drifted apart — different fill, icon size, title colour, chevron and hover —
 * and neither header could be reached from the keyboard.
 *
 * The header is a real `<button>` carrying `aria-expanded`, so Tab, Enter and
 * Space work and a screen reader hears the state. Actions (a regenerate icon)
 * sit BESIDE it in `actions`, never inside: a button inside a button is invalid
 * HTML and swallows the inner click. `meta` holds the header's right-aligned
 * text (a timestamp, a budget percentage).
 */
export interface Accordion {
	root: HTMLElement;
	toggle: HTMLButtonElement;
	meta: HTMLElement;
	actions: HTMLElement;
	body: HTMLElement;
}

let seq = 0;

export function buildAccordion(
	parent: HTMLElement,
	o: { cls: string; icon: string; title: string; open?: boolean; onToggle?: (open: boolean) => void },
): Accordion {
	const root = parent.createDiv({ cls: `p-acc ${o.cls}` });
	const head = root.createDiv({ cls: "p-acc-head" });
	const bodyId = `p-acc-body-${++seq}`;
	const toggle = head.createEl("button", {
		cls: "p-acc-toggle",
		attr: { type: "button", "aria-controls": bodyId },
	});
	setIcon(toggle.createSpan({ cls: "p-acc-chevron" }), "chevron-right");
	setIcon(toggle.createSpan({ cls: "p-acc-icon" }), o.icon);
	toggle.createSpan({ cls: "p-acc-title", text: o.title });
	const meta = toggle.createSpan({ cls: "p-acc-meta" });
	const actions = head.createDiv({ cls: "p-acc-actions" });
	const body = root.createDiv({ cls: "p-acc-body", attr: { id: bodyId } });
	setAccordionOpen(root, !!o.open);
	toggle.addEventListener("click", () => {
		const open = !root.hasClass("open");
		setAccordionOpen(root, open);
		o.onToggle?.(open);
	});
	return { root, toggle, meta, actions, body };
}

/** Open or close from outside (the summary cards fold when scrolled away). */
export function setAccordionOpen(root: HTMLElement, open: boolean): void {
	root.toggleClass("open", open);
	root.querySelector(".p-acc-toggle")?.setAttribute("aria-expanded", String(open));
}
