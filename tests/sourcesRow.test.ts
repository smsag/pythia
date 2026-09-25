// @vitest-environment happy-dom
//
// The sources row under an assistant answer (ADR-140). `ui/sourcesRow.ts` takes
// `app` as an argument rather than reading it off the view, so the row renders
// without mounting anything — only the `obsidian` module has to be stubbed.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	Notice: class { constructor(public msg: string) {} },
	TFile: class {},
	// Records the icon id, so the source-type icons (ADR-193) can be asserted.
	setIcon: (el: HTMLElement, id: string) => { el.setAttribute("data-icon", id); },
}));

import { renderSourcesRow } from "../ui/sourcesRow";
import type { App } from "obsidian";
import type { MessageSource } from "../models/types";

// Obsidian extends Element.prototype with these at runtime; happy-dom does not.
function installDomHelpers(): void {
	type Opts = { cls?: string; text?: string; attr?: Record<string, string> };
	const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	proto.createEl = function (this: Element, tag: string, o?: Opts): Element {
		const el = document.createElement(tag);
		if (o?.cls) (el as HTMLElement).className = o.cls;
		if (o?.text != null) el.textContent = o.text;
		if (o?.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("div", o);
	};
	proto.createSpan = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("span", o);
	};
}
installDomHelpers();

const app = {} as App;
const web = (n: number, domain: string): MessageSource => ({ n, kind: "web", ref: domain, title: domain });
const vault = (n: number, path: string, title: string): MessageSource => ({ n, kind: "vault", ref: path, title });

function render(sources: MessageSource[], template?: string): HTMLElement {
	document.body.innerHTML = "";
	const row = document.createElement("div");
	document.body.appendChild(row);
	renderSourcesRow(app, row, sources, template);
	return row;
}

const labels = (row: HTMLElement) =>
	Array.from(row.querySelectorAll(".p-sources-label")).map((e) => e.textContent);

describe("renderSourcesRow — template row (ADR-140)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("lists the template first, before the citations", () => {
		const row = render([web(1, "example.com")], "Templates/Podcast Summary.md");
		expect(labels(row)).toEqual(["Template:", "Web:"]);
	});

	it("orders the rows from the user outwards: template, vault, web", () => {
		// Web is listed last as the only part that is neither the reader's nor
		// correctable by them — the citations arrive web-first here to prove the
		// row order does not follow the source order.
		const row = render([web(1, "a.com"), vault(2, "Notes/B.md", "B")], "Templates/T.md");
		expect(labels(row)).toEqual(["Template:", "Vault:", "Web:"]);
	});

	it("renders the template by basename, with no wikilink brackets", () => {
		// ADR-153: the run-in `Template:` already says it is a note, so the
		// brackets repeat it and cost four characters of a narrow row.
		const row = render([], "Templates/Podcast Summary.md");
		expect(row.querySelector(".p-wikilink-name")?.textContent).toBe("Podcast Summary");
		expect(row.textContent).not.toContain("[[");
		expect(row.textContent).not.toContain("]]");
	});

	it("gives the template no citation number", () => {
		// The numbers match the superscript chips in the prose. Nothing cites the
		// template, so a number here would point at nothing.
		const row = render([], "Templates/Podcast Summary.md");
		expect(row.querySelector(".p-source-num")).toBeNull();
	});

	it("still numbers the citations beside it", () => {
		const row = render([web(1, "a.com"), web(2, "b.com")], "Templates/T.md");
		expect(Array.from(row.querySelectorAll(".p-source-num")).map((e) => e.textContent)).toEqual(["1", "2"]);
	});

	it("renders the row for a template alone, with no citations at all", () => {
		const row = render([], "Templates/Podcast Summary.md");
		expect(row.querySelector(".p-sources")).not.toBeNull();
	});

	it("renders nothing when there is neither a template nor a source", () => {
		expect(render([]).querySelector(".p-sources")).toBeNull();
	});

	it("keeps the template row out of a conversation that uses none", () => {
		const row = render([web(1, "example.com")]);
		expect(labels(row)).toEqual(["Web:"]);
	});

	it("labels the vault row Vault even when there is no web row", () => {
		// It used to be relabelled SOURCES in that case, so the same row read two
		// different ways depending on what else happened to be on screen.
		const row = render([vault(1, "Notes/A.md", "A")], "Templates/T.md");
		expect(labels(row)).toEqual(["Template:", "Vault:"]);
	});
});

// ── Run-in labels (ADR-153) ───────────────────────────────────────────────────

describe("renderSourcesRow — run-in labels (ADR-153)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("ends every label with a colon, so it reads as a prefix and not a heading", () => {
		const row = render([web(1, "a.com"), vault(2, "Notes/B.md", "B")], "Templates/T.md");
		expect(labels(row).every((l) => l?.endsWith(":"))).toBe(true);
	});

	it("puts the label first in its row, ahead of the first entry", () => {
		const row = render([web(1, "example.com")]);
		const first = row.querySelector(".p-sources-row")?.firstElementChild;
		expect(first?.className).toBe("p-sources-label");
		expect(first?.textContent).toBe("Web:");
	});

	it("renders a vault citation with no brackets either", () => {
		const row = render([vault(1, "Notes/Some Note.md", "Some Note")]);
		expect(row.querySelector(".p-wikilink-name")?.textContent).toBe("Some Note");
		expect(row.textContent).not.toContain("[[");
	});

	// ADR-193 replaces ADR-153's trailing ↗: every entry leads with the icon of its
	// source type, the same icon as the toolbar control that brings it in.
	it("leads each entry with its source icon: globe for web, the library for a note (ADR-212), layout-template for the template", () => {
		const row = render([web(1, "example.com"), vault(2, "Notes/A.md", "A")], "Templates/Podcast.md");
		const iconsIn = (label: string) => Array.from(row.querySelectorAll(".p-sources-row"))
			.find((r) => r.querySelector(".p-sources-label")?.textContent === `${label}:`)!
			.querySelectorAll(".p-source-icon");
		expect(Array.from(iconsIn("Web")).map((i) => i.getAttribute("data-icon"))).toEqual(["globe"]);
		expect(Array.from(iconsIn("Vault")).map((i) => i.getAttribute("data-icon"))).toEqual(["library"]);
		expect(Array.from(iconsIn("Template")).map((i) => i.getAttribute("data-icon"))).toEqual(["layout-template"]);
		expect(row.querySelector(".p-source-web")?.textContent).toBe("example.com");
		expect(row.textContent).not.toContain("↗");
	});
	it("keeps the citation number ahead of the icon, matching the superscript in the prose", () => {
		const row = render([web(3, "example.com")]);
		const item = row.querySelector(".p-source")!;
		expect(item.firstElementChild?.className).toBe("p-source-num");
		expect(item.children[1]?.className).toBe("p-source-icon");
	});
});
