// @vitest-environment happy-dom
//
// ADR-214: notes dragged from the vault onto the composer attach like a `#`
// pick. The drag's two carriers — Obsidian's private draggable and the public
// drag text — are both untrusted, and both are tested in the shapes Obsidian
// 1.13.7's DragManager actually writes.
import { describe, it, expect, beforeEach } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { droppedNotePaths, isNoteDrag, itemsFromDraggable, linkpathsFromText, wantsOpenInTab } from "../ui/noteDrop";
import { makePlugin, mountView, seedConversation } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";
import type { ComposerField } from "../ui/ComposerField";

function file(path: string): TFile {
	const name = path.split("/").pop()!;
	const dot = name.lastIndexOf(".");
	return Object.assign(new (TFile as unknown as new () => TFile)(), {
		path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1),
		stat: { size: 400, mtime: 0, ctime: 0 },
	});
}
function folder(path: string, children: Array<TFile | TFolder>): TFolder {
	return Object.assign(new (TFolder as unknown as new () => TFolder)(), { path, name: path.split("/").pop()!, children });
}

const plan = file("Notes/Plan.md");
const q3 = file("Notes/Q3 revenue.md");
const pdf = file("Notes/Deck.pdf");
const png = file("Notes/Chart.png");
const notes = folder("Notes", [plan, q3, pdf, png]);
const all = [plan, q3, pdf, png];

function appWith(draggable: unknown): App {
	return {
		dragManager: { draggable },
		vault: {
			getName: () => "Vault 2.0",
			getAbstractFileByPath: (p: string) => all.find((f) => f.path === p) ?? (p === "Notes" ? notes : null),
		},
		metadataCache: { getFirstLinkpathDest: (l: string) => all.find((f) => f.basename === l) ?? null },
	} as unknown as App;
}

describe("itemsFromDraggable — Obsidian's in-flight drag, checked not trusted", () => {
	it("reads each shape DragManager builds", () => {
		expect(itemsFromDraggable({ type: "file", file: plan })).toEqual([plan]);
		expect(itemsFromDraggable({ type: "folder", file: notes })).toEqual([notes]);
		expect(itemsFromDraggable({ type: "link", file: q3, linktext: "Q3 revenue" })).toEqual([q3]);
		expect(itemsFromDraggable({ type: "files", files: [plan, notes] })).toEqual([plan, notes]);
	});

	it("is not a note drag for anything else", () => {
		expect(itemsFromDraggable(null)).toBeNull();
		expect(itemsFromDraggable({ type: "link", file: null, linktext: "Missing" })).toBeNull(); // an unresolved link
		expect(itemsFromDraggable({ type: "bookmarks", items: [] })).toBeNull();
		expect(itemsFromDraggable({ type: "file", file: { path: "Notes/Plan.md" } })).toBeNull(); // shaped like one, is not one
		expect(itemsFromDraggable({ type: "files", files: ["Notes/Plan.md"] })).toBeNull();
	});
});

describe("linkpathsFromText — the drag's text, for when the draggable is gone", () => {
	it("reads Obsidian's URLs for this vault, one per line", () => {
		const text = "obsidian://open?vault=Vault%202.0&file=Notes%2FPlan\nobsidian://open?vault=Vault%202.0&file=Notes%2FQ3%20revenue";
		expect(linkpathsFromText(text, "Vault 2.0")).toEqual(["Notes/Plan", "Notes/Q3 revenue"]);
	});

	it("ignores a URL for another vault — its path means nothing here", () => {
		expect(linkpathsFromText("obsidian://open?vault=Work&file=Notes%2FPlan", "Vault 2.0")).toEqual([]);
	});

	it("reads [[links]], dropping a heading, block or alias", () => {
		expect(linkpathsFromText("see [[Plan#Goals|the plan]] and [[Q3 revenue^abc]]", "V")).toEqual(["Plan", "Q3 revenue"]);
	});

	it("reads ordinary text as no notes", () => {
		expect(linkpathsFromText("just some words", "V")).toEqual([]);
		expect(linkpathsFromText("obsidian://open?%%%", "V")).toEqual([]);
	});
});

describe("droppedNotePaths — what a drop attaches", () => {
	it("a file is its path", () => {
		expect(droppedNotePaths(appWith({ type: "file", file: q3 }), "")).toEqual(["Notes/Q3 revenue.md"]);
	});

	it("a folder is its notes — Markdown and PDF, as the # picker attaches", () => {
		expect(droppedNotePaths(appWith({ type: "folder", file: notes }), "Notes")).toEqual([
			"Notes/Plan.md", "Notes/Q3 revenue.md", "Notes/Deck.pdf",
		]);
	});

	it("a mixed selection keeps its order and names a note once", () => {
		expect(droppedNotePaths(appWith({ type: "files", files: [q3, notes] }), "")).toEqual([
			"Notes/Q3 revenue.md", "Notes/Plan.md", "Notes/Deck.pdf",
		]);
	});

	it("a file that is not a note attaches nothing", () => {
		expect(droppedNotePaths(appWith({ type: "file", file: png }), "")).toEqual([]);
	});

	it("falls back to the drag's text when the draggable is gone", () => {
		const text = "obsidian://open?vault=Vault%202.0&file=Notes%2FPlan";
		expect(droppedNotePaths(appWith(null), text)).toEqual(["Notes/Plan.md"]);
		expect(droppedNotePaths(appWith(null), "[[Q3 revenue]]")).toEqual(["Notes/Q3 revenue.md"]);
	});

	it("text that names nothing in the vault is not a note drop", () => {
		expect(droppedNotePaths(appWith(null), "[[Nowhere]] and prose")).toEqual([]);
	});

	it("survives a vault with no dragManager at all", () => {
		const app = appWith(null);
		delete (app as unknown as { dragManager?: unknown }).dragManager;
		expect(isNoteDrag(app)).toBe(false);
		expect(droppedNotePaths(app, "")).toEqual([]);
	});
});

describe("wantsOpenInTab — Obsidian's modifier keeps its meaning", () => {
	it("is ⇧ on macOS and Alt elsewhere", () => {
		expect(wantsOpenInTab({ shiftKey: true, altKey: false }, true)).toBe(true);
		expect(wantsOpenInTab({ shiftKey: false, altKey: true }, true)).toBe(false);
		expect(wantsOpenInTab({ shiftKey: false, altKey: true }, false)).toBe(true);
		expect(wantsOpenInTab({ shiftKey: true, altKey: false }, false)).toBe(false);
	});
});

// ── The real view ────────────────────────────────────────────────────────────

describe("dropping notes on the composer (the real view)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	let view: PythiaSidebarView;
	let conv: Conversation;
	let drag: { draggable: unknown };
	const composer = (): ComposerField => (view as unknown as { composer: ComposerField }).composer;

	function dragEvent(type: string, text = "", mods: { altKey?: boolean } = {}): DragEvent {
		const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
		const store = new Map([["text/plain", text]]);
		Object.defineProperty(e, "dataTransfer", { value: { getData: (k: string) => store.get(k) ?? "", dropEffect: "none", types: ["text/plain"] } });
		Object.defineProperty(e, "altKey", { value: mods.altKey ?? false });
		Object.defineProperty(e, "shiftKey", { value: false });
		return e;
	}

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
		drag = { draggable: null };
		const app = plugin.app as unknown as Record<string, unknown>;
		app.dragManager = drag;
		(app.vault as Record<string, unknown>).getAbstractFileByPath = (p: string) => all.find((f) => f.path === p) ?? null;
		conv = await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [] } as Partial<Conversation>);
		({ view } = await mountView(plugin));
	});

	it("claims a note drag while it hovers, and marks itself as the target", () => {
		drag.draggable = { type: "file", file: plan };
		const over = dragEvent("dragover");
		composer().el.dispatchEvent(over);
		expect(over.defaultPrevented).toBe(true);             // Obsidian's own handler above sees it taken
		expect(composer().el.classList.contains("is-drop-target")).toBe(true);
	});

	it("attaches a dropped note as a chip, exactly as a # pick does", () => {
		composer().value = "Compare ";
		drag.draggable = { type: "file", file: q3 };
		const drop = dragEvent("drop");
		composer().el.dispatchEvent(drop);

		expect(drop.defaultPrevented).toBe(true);
		expect(conv.contextNotes).toEqual(["Notes/Q3 revenue.md"]);
		expect(composer().value).toBe("Compare [[Q3 revenue]] ");
		expect(composer().el.querySelector(".p-composer-chip")?.getAttribute("data-token")).toBe("[[Q3 revenue]]");
		expect(composer().el.classList.contains("is-drop-target")).toBe(false);
	});

	it("attaches a dropped folder's notes, one chip each", () => {
		drag.draggable = { type: "folder", file: notes };
		composer().el.dispatchEvent(dragEvent("drop", "Notes"));
		expect(conv.contextNotes).toEqual(["Notes/Plan.md", "Notes/Q3 revenue.md", "Notes/Deck.pdf"]);
		expect(composer().el.querySelectorAll(".p-composer-chip")).toHaveLength(3);
	});

	it("leaves a drop with Obsidian's open-in-tab modifier to Obsidian", () => {
		drag.draggable = { type: "file", file: plan };
		const over = dragEvent("dragover", "", { altKey: true });
		composer().el.dispatchEvent(over);
		expect(over.defaultPrevented).toBe(false);
		composer().el.dispatchEvent(dragEvent("drop", "", { altKey: true }));
		expect(conv.contextNotes).toEqual([]);
	});

	it("drops plain text as text, attaching nothing", () => {
		const drop = dragEvent("drop", "some words");
		composer().el.dispatchEvent(drop);
		expect(composer().value).toBe("some words");
		expect(conv.contextNotes).toEqual([]);
	});

	it("takes nothing while an answer streams", () => {
		composer().disabled = true;
		drag.draggable = { type: "file", file: plan };
		composer().el.dispatchEvent(dragEvent("dragover"));
		expect(composer().el.classList.contains("is-drop-target")).toBe(false);
		composer().el.dispatchEvent(dragEvent("drop", "text too"));
		expect(conv.contextNotes).toEqual([]);
		expect(composer().value).toBe("");
	});
});
