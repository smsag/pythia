import { attachDragToPan } from "./dragToPan";

/**
 * Wrap rendered markdown tables so a wide one scrolls sideways instead of being
 * squeezed into the sidebar (ADR-131).
 *
 * The squeeze is the problem this solves. A table with automatic layout shrinks
 * to its container rather than overflowing it, so without help a four-column
 * table in a 300px sidebar wraps every cell — and, with the word-breaking rules
 * Obsidian themes apply to table cells, wraps them mid-word, turning a heading
 * like "Messbarkeit" into "Messba / rkeit". The frame added here gives the table
 * somewhere to overflow to; `styles.css` supplies the matching cell rules that
 * stop words being split and give each column a floor width.
 *
 * Idempotent: a table is marked `data-decorated` and skipped on later passes, so
 * re-rendering a message or re-opening a summary card never nests frames.
 */
export function decorateTables(container: HTMLElement): void {
	container.querySelectorAll<HTMLElement>("table:not([data-decorated])").forEach((table) => {
		table.dataset.decorated = "1";
		const frame = createEl("div", { cls: "p-scroll-frame" });
		table.parentNode?.insertBefore(frame, table);
		frame.appendChild(table);
		attachDragToPan(frame);
	});
}
