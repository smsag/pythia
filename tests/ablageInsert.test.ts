import { describe, it, expect } from "vitest";
import type { Editor } from "obsidian";
import type PythiaPlugin from "../main";
import { Ablage, type AblageSlot } from "../services/ablage";
import { insertFromAblage } from "../ui/ablageEntries";

function setup(note: string) {
	let slot: AblageSlot | undefined;
	const ablage = new Ablage({ slot: () => slot, setSlot: (s) => { slot = s; }, persist: async () => {} });
	let doc = note;
	const inserted: string[] = [];
	const editor = {
		getValue: () => doc,
		replaceSelection: (text: string) => { inserted.push(text); doc += text; },
	} as unknown as Editor;
	return { plugin: { ablage } as unknown as PythiaPlugin, ablage, editor, inserted };
}

describe("insertFromAblage (ADR-246)", () => {
	it("inserts the item once, as one edit, and empties the Ablage", async () => {
		const s = setup("");
		await s.ablage.put("Hello");
		await insertFromAblage(s.plugin, s.editor, s.ablage.item!.createdAt);
		expect(s.inserted).toEqual(["Hello"]);
		expect(s.ablage.item).toBeUndefined();
	});

	it("inserts nothing when the Ablage changed since the menu was drawn", async () => {
		const s = setup("");
		await s.ablage.put("shown");
		const shown = s.ablage.item!.createdAt;
		s.ablage.item!.createdAt = "2000-01-01T00:00:00.000Z"; // another put landed
		await insertFromAblage(s.plugin, s.editor, shown);
		expect(s.inserted).toEqual([]);
		expect(s.ablage.item).toBeDefined();
	});

	it("numbers its footnotes around the note's own", async () => {
		const s = setup("Existing claim.[^1]\n\n[^1]: Mine.\n");
		await s.ablage.put("New claim. ⟦cite:web:1⟧", { sources: [{ n: 1, url: "https://example.org/a", title: "Example" }] });
		await insertFromAblage(s.plugin, s.editor, s.ablage.item!.createdAt);
		expect(s.inserted[0]).not.toContain("⟦cite");
		expect(s.inserted[0]).not.toMatch(/\[\^1\]/);
		expect(s.inserted[0]).toContain("https://example.org/a");
	});
});
