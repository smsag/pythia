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
