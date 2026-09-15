import type { App } from "obsidian";
import type { MessageSource } from "../models/types";
import { eachCitationSegment } from "../services/citations";
import { openCitationSource } from "./sourcesRow";

/**
 * Replace the `⟦cite:…⟧` markers left in rendered markdown with numbered
 * superscript chips.
 *
 * Extracted from `sidebar.ts` (ADR-097 ratchet, ADR-136 session): it reads
 * nothing from the view but the `App` it needs to open a source, and it belongs
 * beside the other citation code — `services/citations.ts` parses the markers,
 * `ui/sourcesRow.ts` renders the list, and this paints them inline.
 *
 * Nodes are collected before mutating, because replacing one invalidates a live
 * TreeWalker mid-iteration.
 */
export function paintCitations(app: App, body: HTMLElement, sources: MessageSource[]): void {
	const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (node.nodeValue && node.nodeValue.indexOf("⟦cite:") !== -1) targets.push(node as Text);
	}
	for (const textNode of targets) {
		const text = textNode.nodeValue ?? "";
		const frag = document.createDocumentFragment();
		eachCitationSegment(
			text,
			sources,
			(t) => { if (t) frag.appendChild(document.createTextNode(t)); },
			(src) => {
				if (!src) return; // drop an unresolved marker entirely
				const chip = document.createElement("sup");
				chip.className = "p-cite";
				chip.textContent = String(src.n);
				chip.title = src.title;
				chip.addEventListener("click", (e) => { e.stopPropagation(); void openCitationSource(app, src); });
				frag.appendChild(chip);
			},
		);
		textNode.parentNode?.replaceChild(frag, textNode);
	}
}
