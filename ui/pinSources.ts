import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { PinKind } from "../models/types";
import { PIN_ICON } from "./icons";

/**
 * What a rendered block IS, as text (ADR-216) — the ONE builder per kind, used
 * by that block's Copy button and by its Pin, so "what Copy copies" and "what a
 * pin stores" can never be two answers.
 */

/**
 * A fence that cannot be closed by the code inside it: one backtick longer than
 * the longest backtick run in `body`, and never fewer than three (CommonMark).
 * A fixed ``` was closed early by any code that itself contained one — a
 * Markdown example — and the pin and its Copy both came out broken.
 */
export function fenceFor(body: string): string {
	const longest = Math.max(0, ...Array.from(body.matchAll(/`+/g), (m) => m[0].length));
	return "`".repeat(Math.max(3, longest + 1));
}

/** A code block, as the fenced block it was written as. `textContent`, not
 *  `innerText`: the code's exact characters, with no dependence on layout — and
 *  Obsidian's own copy button sits beside the `<code>`, not in it. */
export function codeBlockSource(pre: HTMLElement): string {
	const codeEl = pre.querySelector("code");
	const lang = codeEl?.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
	const raw = ((codeEl ?? pre).textContent ?? "").replace(/\n$/, "");
	const fence = fenceFor(raw);
	return `${fence}${lang}\n${raw}\n${fence}`;
}

/** A rendered diagram (Mermaid, …), as its fenced source; "" when the renderer
 *  left no source to read. */
export function diagramSource(el: HTMLElement): string {
	const source = (el.querySelector("code")?.textContent ?? "").replace(/\n$/, "");
	if (!source) return "";
	const lang = el.className.match(/\bblock-language-(\S+)\b/)?.[1] ?? "mermaid";
	const fence = fenceFor(source);
	return `${fence}${lang}\n${source}\n${fence}`;
}

/**
 * One cell as Markdown table text that renders as what the cell SHOWED.
 *
 * The cell's visible text is written back into Markdown, so every character
 * Markdown or HTML would read as syntax is backslash-escaped (CommonMark lets
 * any ASCII punctuation be escaped): a cell showing `<div>` or `*` as text must
 * not come back as an element or as emphasis — in the pin, or wherever the copy
 * is pasted. `=`, `~` and `$` because Obsidian reads `==`, `~~` and `$…$`. A
 * `|` would end the cell; a line break would end the row, so it becomes `<br>` —
 * the one piece of markup this writes on purpose.
 */
export function cellText(cell: Element): string {
	return (cell.textContent ?? "")
		.trim()
		.replace(/[\\`*_[\]<>|~=$]/g, (c) => `\\${c}`)
		.replace(/\r?\n+/g, "<br>");
}

/**
 * A rendered table, as a Markdown pipe table. The first row is the header, as
 * Markdown requires; a ragged row is padded so every row has the header's
 * width. Inline formatting (links, bold) is reduced to its text — a table is
 * pinned and copied for its values.
 */
export function tableMarkdown(table: HTMLTableElement): string {
	const rows = Array.from(table.rows).map((r) => Array.from(r.cells).map(cellText));
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const line = (cells: string[]): string => `| ${[...cells, ...Array(width - cells.length).fill("")].join(" | ")} |`;
	return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

/** What the decorators call when a block's pin is pressed: the kind, its
 *  source, and the element it was pressed on (to find the message). */
export type PinBlock = (kind: PinKind, source: string, from: HTMLElement) => void;

/** The pin button a pinnable block carries, beside its Copy. */
export function appendPinButton(parent: HTMLElement, cls: string, kind: PinKind, source: () => string, onPin: PinBlock): HTMLButtonElement {
	const btn = parent.createEl("button", { cls: `pb pb-icon ${cls} p-pin-btn`, attr: { title: t("pinTooltip") } });
	setIcon(btn, PIN_ICON);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		onPin(kind, source(), btn);
	});
	return btn;
}
