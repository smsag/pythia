// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { Notice, TFile } from "obsidian";
import { onNoteLinkClick, openNotePath, paintNoteWrites } from "../ui/noteLinks";
import type { Message } from "../models/types";

/** The test stub records every message (tests/mocks/obsidian.ts); the real type does not declare it. */
const shown = (): string[] => (Notice as unknown as { shown: string[] }).shown;

const file = (path: string): TFile => Object.assign(new TFile(), { path }) as TFile;

function fakeApp(existing: string[]) {
	const files = new Map(existing.map((p) => [p, file(p)]));
	const openFile = vi.fn().mockResolvedValue(undefined);
	const app = {
		vault: { getAbstractFileByPath: (p: string) => files.get(p) ?? null },
		metadataCache: {
			getFirstLinkpathDest: (linkpath: string) =>
				files.get(linkpath) ?? files.get(`${linkpath}.md`) ?? [...files.values()].find((f) => f.path.endsWith(`/${linkpath}.md`)) ?? null,
		},
		workspace: { getLeaf: vi.fn(() => ({ openFile })), openLinkText: vi.fn().mockResolvedValue(undefined) },
	};
	return { app, openFile, files };
}

const click = (el: Element, init: MouseEventInit = {}): MouseEvent => {
	const e = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(e);
	return e;
};

beforeEach(() => { shown().length = 0; });

describe("openNotePath (ADR-218)", () => {
	it("opens the file at the path", async () => {
		const { app, openFile } = fakeApp(["Out/A.md"]);
		await openNotePath(app as never, "Out/A.md");
		expect(openFile).toHaveBeenCalledTimes(1);
	});

	it("says the note is gone rather than creating one", async () => {
		const { app, openFile } = fakeApp([]);
		await openNotePath(app as never, "Out/A.md");
		expect(openFile).not.toHaveBeenCalled();
		expect(app.workspace.openLinkText).not.toHaveBeenCalled();
		expect(shown()).toEqual(["A was renamed or deleted"]);
	});
});

describe("onNoteLinkClick — [[links]] in the conversation (ADR-218)", () => {
	const chat = (app: unknown): HTMLElement => {
		const el = document.createElement("div");
		el.innerHTML = '<p>See <a class="internal-link" data-href="Out/A" href="Out/A">A</a> and <a class="internal-link" data-href="Gone#Intro" href="Gone#Intro">Gone</a> or <a class="external-link" href="https://x.org">x</a></p>';
		el.addEventListener("click", (e) => onNoteLinkClick(app as never, e));
		return el;
	};

	it("opens a link that resolves, keeping its heading", () => {
		const { app } = fakeApp(["Out/A.md"]);
		const e = click(chat(app).querySelector('[data-href="Out/A"]')!);
		expect(e.defaultPrevented).toBe(true);
		expect(app.workspace.openLinkText).toHaveBeenCalledWith("Out/A", "", false);
	});

	it("opens in a new tab on a modifier click", () => {
		const { app } = fakeApp(["Out/A.md"]);
		click(chat(app).querySelector('[data-href="Out/A"]')!, { metaKey: true });
		expect(app.workspace.openLinkText).toHaveBeenCalledWith("Out/A", "", true);
	});

	it("stops a link that no longer resolves and says so — never creates the note", () => {
		const { app } = fakeApp([]);
		const e = click(chat(app).querySelector('[data-href="Gone#Intro"]')!);
		expect(e.defaultPrevented).toBe(true);
		expect(app.workspace.openLinkText).not.toHaveBeenCalled();
		expect(shown()).toEqual(["Gone was renamed or deleted"]);
	});

	it("leaves external links and plain text alone", () => {
		const { app } = fakeApp([]);
		const el = chat(app);
		expect(click(el.querySelector(".external-link")!).defaultPrevented).toBe(false);
		expect(click(el.querySelector("p")!).defaultPrevented).toBe(false);
	});
});

describe("paintNoteWrites — the chip outlives the turn (ADR-218)", () => {
	const msg = (): Message => ({
		id: "a", role: "assistant", content: "done", timestamp: "t",
		noteWrites: [{ path: "Out/Plan.md", action: "created" }, { path: "Notes/Log.md", action: "prepended" }],
	});

	it("draws one done chip per written note from the message", () => {
		const { app } = fakeApp([]);
		const row = document.createElement("div");
		paintNoteWrites(app as never, row, msg());
		const links = [...row.querySelectorAll(".pythia-tool-call--done .pythia-tool-call-link")].map((a) => a.textContent);
		expect(links).toEqual(["✓ Created Plan", "✓ Prepended to Log"]);
		// The name leads with the vault-note icon, and no [[ ]] (ADR-193/212).
		expect(row.querySelectorAll(".pythia-tool-call-link .p-source-icon")).toHaveLength(2);
	});

	it("opens the note where it is NOW — the path is read at tap time", async () => {
		const { app, openFile } = fakeApp(["Notes/Renamed.md"]);
		const m = msg();
		const row = document.createElement("div");
		paintNoteWrites(app as never, row, m);
		m.noteWrites![0].path = "Notes/Renamed.md"; // what renameVaultPath does, in place
		click(row.querySelector(".pythia-tool-call-link")!);
		await Promise.resolve();
		expect(openFile).toHaveBeenCalledTimes(1);
		expect(shown()).toEqual([]);
	});

	it("draws nothing for an answer that wrote nothing", () => {
		const row = document.createElement("div");
		paintNoteWrites(fakeApp([]).app as never, row, { id: "a", role: "assistant", content: "x", timestamp: "t" });
		expect(row.children).toHaveLength(0);
	});
});
