import { setIcon } from "obsidian";

/**
 * The dismissible chip above the conversation list.
 *
 * Two modes use it and must keep looking identical: "Related to X" (ADR-109)
 * and "Widened to notes" (ADR-168). They say different things but mean the same
 * thing to the reader — *the list you are looking at is not the one you asked
 * for, and here is how to leave it* — so they share one builder rather than two
 * that drift.
 */
export function renderHistoryChip(
	parent: HTMLElement,
	o: { label: string; tooltip: string; onClear(): void }
): void {
	const chip = parent.createDiv({ cls: "p-history-chip" });
	chip.createSpan({ cls: "p-history-chip-label", text: o.label });
	const clear = chip.createSpan({ cls: "p-history-chip-clear", attr: { title: o.tooltip } });
	setIcon(clear, "x");
	clear.addEventListener("click", () => o.onClear());
}
