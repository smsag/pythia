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

	it("lists the template first, before the web sources", () => {
		const row = render([web(1, "example.com")], "Templates/Podcast Summary.md");
		expect(labels(row)).toEqual(["TEMPLATE", "WEB"]);
	});

	it("renders the template as a wikilink, by basename", () => {
		const row = render([], "Templates/Podcast Summary.md");
		expect(row.querySelector(".p-wikilink-name")?.textContent).toBe("Podcast Summary");
		expect(row.textContent).toContain("[[");
		expect(row.textContent).toContain("]]");
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
		expect(labels(row)).toEqual(["WEB"]);
	});

	it("keeps the single QUELLEN row when every citation is a vault note", () => {
		const row = render([vault(1, "Notes/A.md", "A")], "Templates/T.md");
		expect(labels(row)).toEqual(["TEMPLATE", "SOURCES"]);
	});

	it("splits WEB and VAULT under the template when both are cited", () => {
		const row = render([web(1, "a.com"), vault(2, "Notes/B.md", "B")], "Templates/T.md");
		expect(labels(row)).toEqual(["TEMPLATE", "WEB", "VAULT"]);
	});
});
