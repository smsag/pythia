import { describe, it, expect } from "vitest";
import { Ablage, ABLAGE_MAX_CHARS, ablagePreview, mergeAblage, normalizeAblage, type AblageSlot } from "../services/ablage";

function store(start?: AblageSlot) {
	let slot = start;
	let persisted = 0;
	let now = Date.parse("2026-09-29T10:00:00Z");
	const ablage = new Ablage({
		slot: () => slot,
		setSlot: (s) => { slot = s; },
		persist: async () => { persisted++; },
	}, () => new Date(now += 1000));
	return { ablage, slot: () => slot, persisted: () => persisted };
}

describe("the Ablage holds one item (ADR-246)", () => {
	it("a new item replaces the last", async () => {
		const s = store();
		await s.ablage.put("first");
		await s.ablage.put("second");
		expect(s.ablage.item?.text).toBe("second");
		expect(s.persisted()).toBe(2);
	});

	it("refuses empty and over-long text, and stores nothing", async () => {
		const s = store();
		expect(await s.ablage.put("   ")).toBe("empty");
		expect(await s.ablage.put("x".repeat(ABLAGE_MAX_CHARS + 1))).toBe("too-long");
		expect(s.slot()).toBeUndefined();
		expect(s.persisted()).toBe(0);
	});

	it("take empties it — but only if it still holds the item the user chose", async () => {
		const s = store();
		await s.ablage.put("shown");
		const shown = s.ablage.item!.createdAt;
		await s.ablage.put("replaced meanwhile");
		expect(await s.ablage.take(shown)).toBeNull();
		expect(s.ablage.item?.text).toBe("replaced meanwhile");

		const current = s.ablage.item!.createdAt;
		expect((await s.ablage.take(current))?.text).toBe("replaced meanwhile");
		expect(s.ablage.item).toBeUndefined();
		expect(s.slot()?.updatedAt).toBeDefined(); // emptied, and says when
	});
});

describe("data.json boundary", () => {
	it("keeps a valid slot and drops a malformed one", () => {
		const ok = normalizeAblage({ updatedAt: "2026-09-29T10:00:00Z", item: { text: "hi", createdAt: "2026-09-29T10:00:00Z", conversationId: "c1" } });
		expect(ok?.item).toEqual({ text: "hi", createdAt: "2026-09-29T10:00:00Z", conversationId: "c1" });
		expect(normalizeAblage({ item: { text: "hi" } })).toBeUndefined();
		expect(normalizeAblage("nope")).toBeUndefined();
		// A bad item leaves an empty slot, never a raw value.
		expect(normalizeAblage({ updatedAt: "2026-09-29T10:00:00Z", item: { text: 42 } })).toEqual({ updatedAt: "2026-09-29T10:00:00Z" });
	});

	it("keeps only http(s) sources", () => {
		const slot = normalizeAblage({ updatedAt: "2026-09-29T10:00:00Z", item: { text: "a", createdAt: "2026-09-29T10:00:00Z",
			sources: [{ n: 1, url: "https://a.org", title: "A" }, { n: 2, url: "javascript:alert(1)" }, { n: "3", url: "https://b.org" }] } });
		expect(slot?.item?.sources).toEqual([{ n: 1, url: "https://a.org", title: "A" }]);
	});

	it("a sync never undoes an insert: the newer write wins, a tie keeps memory", () => {
		const emptied: AblageSlot = { updatedAt: "2026-09-29T11:00:00Z" };
		const stale: AblageSlot = { updatedAt: "2026-09-29T10:00:00Z", item: { text: "old", createdAt: "2026-09-29T10:00:00Z" } };
		expect(mergeAblage(emptied, stale)).toBe(emptied);
		expect(mergeAblage(stale, emptied)).toBe(emptied);
		const tie: AblageSlot = { updatedAt: "2026-09-29T11:00:00Z", item: { text: "disk", createdAt: "2026-09-29T11:00:00Z" } };
		expect(mergeAblage(emptied, tie)).toBe(emptied);
	});
});

describe("ablagePreview", () => {
	it("is the first non-empty line, cut with an ellipsis", () => {
		expect(ablagePreview("\n\n  Hello world  \nmore")).toBe("Hello world");
		expect(ablagePreview("a".repeat(60), 10)).toBe("aaaaaaaaa…");
	});
});
