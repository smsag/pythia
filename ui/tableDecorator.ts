import { setIcon } from "obsidian";
import { t } from "../i18n";
import { copyTextWithFeedback } from "./clipboard";
import { attachDragToPan } from "./dragToPan";
import { appendPinButton, tableMarkdown, type PinBlock } from "./pinSources";

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
export function decorateTables(container: HTMLElement, onPin?: PinBlock): void {
	container.querySelectorAll<HTMLTableElement>("table:not([data-decorated])").forEach((table) => {
		table.dataset.decorated = "1";
		const frame = createEl("div", { cls: "p-scroll-frame" });
		table.parentNode?.insertBefore(frame, table);
		frame.appendChild(table);
		attachDragToPan(frame);
		if (onPin) addTableActions(frame, table, onPin);
	});
}

/**
 * In an answer, a table gets Copy and Pin (ADR-216), hover-revealed like a code
 * block's. They sit OUTSIDE the scroll frame — inside it they would scroll away
 * with the table. Both take the same Markdown, from `tableMarkdown`.
 */
function addTableActions(frame: HTMLElement, table: HTMLTableElement, onPin: PinBlock): void {
	const block = createEl("div", { cls: "p-table-block" });
	frame.parentNode?.insertBefore(block, frame);
	const actions = block.createDiv({ cls: "p-table-actions" });
	block.appendChild(frame);
	const copyBtn = actions.createEl("button", { cls: "pb pb-icon p-table-btn", attr: { title: t("tableCopyTooltip") } });
	setIcon(copyBtn, "copy");
	copyBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		void copyTextWithFeedback(copyBtn, tableMarkdown(table));
	});
	appendPinButton(actions, "p-table-btn", "table", () => tableMarkdown(table), onPin);
}
