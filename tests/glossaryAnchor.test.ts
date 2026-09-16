// @vitest-environment happy-dom
//
// Where the glossary anchor is inserted (ADR-156). Fork and merge put their card
// immediately after the mark; the glossary used to put it after the mark's whole
// paragraph, so in a long paragraph the definition arrived far below the word
// that opened it.

import { describe, it, expect, beforeEach } from "vitest";
// Imported for its side effect: installs Obsidian's Element.prototype helpers
// (createDiv/createSpan/createEl) onto happy-dom, which the controller calls.
import "./helpers/viewHarness";
import { GlossaryController } from "../ui/GlossaryController";
import type PythiaPlugin from "../main";
import type { GlossaryEntry } from "../services/glossary";
import { t } from "../i18n";

const ENTRY: GlossaryEntry = {
	term: "Zähler",
	definition: "Ein Gerät, das diskrete Ereignisse erfasst.",
	source: "model",
	updatedAt: "2026-09-15T00:00:00.000Z",
	model: "claude-haiku-4-5",
};

function makeController(entry: GlossaryEntry = ENTRY): GlossaryController {
	const plugin = {
		settings: { defaultAnthropicModel: "claude-sonnet-4-6", glossaryNote: "Glossary.md" },
		app: { workspace: { openLinkText: () => {} } },
		glossaryService: {
			all: async () => [entry],
			find: () => entry,
			hydrate: async (e: GlossaryEntry) => e,
		},
	} as unknown as InstanceType<typeof PythiaPlugin>;

	return new GlossaryController({
		plugin,
		getConversation: () => null,
		getMessagesEl: () => document.body,
		renderMarkdown: (md, el) => { el.textContent = md; },
	});
}

/** A term marked mid-sentence, with a good deal of paragraph after it. */
function paragraphWithMark(): HTMLElement {
	document.body.innerHTML = `
		<div data-msg-id="m1">
			<p id="para">Der <pythia-term class="p-term" data-term="Zähler" id="mark">Zähler</pythia-term>
			wird monatlich abgelesen, und danach folgt noch sehr viel weiterer Text,
			der die Entfernung zwischen Wort und Karte gross macht.</p>
		</div>`;
	return document.querySelector<HTMLElement>("#mark")!;
}

describe("glossary anchor placement (ADR-156)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("inserts the card immediately after the tapped mark, not after its paragraph", async () => {
		const mark = paragraphWithMark();
		await makeController().toggleAnchor("Zähler", mark);

		const anchor = document.querySelector<HTMLElement>(".p-term-anchor")!;
		expect(anchor).not.toBeNull();
		expect(mark.nextElementSibling).toBe(anchor);
	});

	it("keeps the card inside the paragraph, which is what puts it beside the word", async () => {
		const mark = paragraphWithMark();
		await makeController().toggleAnchor("Zähler", mark);

		const anchor = document.querySelector<HTMLElement>(".p-term-anchor")!;
		expect(anchor.closest("#para")).not.toBeNull();
	});

	it("matches where the fork and merge anchors go — after the mark, not the block", async () => {
		// ADR-138/156: the three cards differ only in their left rule's stroke.
		// Placement is part of being the same component.
		const mark = paragraphWithMark();
		await makeController().toggleAnchor("Zähler", mark);

		const para = document.querySelector<HTMLElement>("#para")!;
		expect(para.nextElementSibling).toBeNull();      // NOT parked after the block
	});

	it("opens a person entry in the same place", async () => {
		const mark = paragraphWithMark();
		await makeController({ ...ENTRY, kind: "person", term: "Anna Weber" }).toggleAnchor("Zähler", mark);

		const anchor = document.querySelector<HTMLElement>(".p-term-anchor")!;
		expect(anchor.classList.contains("p-term-anchor--person")).toBe(true);
		expect(mark.nextElementSibling).toBe(anchor);
	});

	it("tapping the same term again closes the card instead of moving it", async () => {
		const mark = paragraphWithMark();
		const c = makeController();
		await c.toggleAnchor("Zähler", mark);
		await c.toggleAnchor("Zähler", mark);
		expect(document.querySelector(".p-term-anchor")).toBeNull();
	});
});

// ── Definitions in the conversation's language (ADR-166) ──────────────────────

describe("glossary anchor language (ADR-166)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	function controllerFor(outputLanguage: string, translate: (e: GlossaryEntry, lang: string) => Promise<string | null>): GlossaryController {
		const plugin = {
			settings: { defaultAnthropicModel: "claude-sonnet-4-6", outputLanguage },
			app: { workspace: { openLinkText: () => {} } },
			glossaryService: {
				all: async () => [ENTRY],
				find: () => ENTRY,
				hydrate: async (e: GlossaryEntry) => e,
				translate,
				pathFor: () => "Glossary/Terms/Zähler.md",
			},
		} as unknown as InstanceType<typeof PythiaPlugin>;
		return new GlossaryController({
			plugin,
			getConversation: () => null,
			getMessagesEl: () => document.body,
			renderMarkdown: (md, el) => { el.textContent = md; },
		});
	}
	const body = () => document.querySelector<HTMLElement>(".p-term-anchor-body")!;
	const meta = () => document.querySelector<HTMLElement>(".p-term-anchor-meta")!.textContent ?? "";

	it("shows the translation into the instructed language and says it is one", async () => {
		const calls: string[] = [];
		const c = controllerFor("en", async (_e, lang) => { calls.push(lang); return "A device that records discrete events."; });
		await c.toggleAnchor("Zähler", paragraphWithMark());
		expect(calls).toEqual(["en"]);
		expect(body().textContent).toBe("A device that records discrete events.");
		expect(meta()).toContain(t("glossaryTranslatedFrom", { code: "DE" }));
	});

	it("under AUTO a German answer shows the German definition without a call", async () => {
		const calls: string[] = [];
		const c = controllerFor("auto", async (_e, lang) => { calls.push(lang); return "x"; });
		await c.toggleAnchor("Zähler", paragraphWithMark());
		expect(calls).toEqual([]);
		expect(body().textContent).toBe(ENTRY.definition);
		expect(meta()).not.toContain(t("glossaryTranslated"));
	});

	it("falls back to the stored definition, unmarked, when no translation comes back", async () => {
		const c = controllerFor("en", async () => null);
		await c.toggleAnchor("Zähler", paragraphWithMark());
		expect(body().textContent).toBe(ENTRY.definition);
		expect(meta()).not.toContain(t("glossaryTranslated"));
	});

	it("shows a placeholder, never the untranslated text, while the translation runs", async () => {
		let resolve!: (v: string) => void;
		const c = controllerFor("en", () => new Promise<string>((r) => { resolve = r; }));
		const opening = c.toggleAnchor("Zähler", paragraphWithMark());
		await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
		expect(body().classList.contains("is-pending")).toBe(true);
		expect(body().textContent).toBe(t("glossaryTranslating", { code: "EN" }));
		resolve("A device.");
		await opening;
		expect(body().textContent).toBe("A device.");
	});
});
