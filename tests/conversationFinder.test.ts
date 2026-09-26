import { describe, it, expect } from "vitest";
import type { Conversation } from "../models/types";
import {
	meaningOnly,
	meaningQuery,
	searchTitles,
	SEARCH_RESULT_LIMIT,
	titleScore,
} from "../services/conversationFinder";
import { tokenize } from "../services/noteRelevance";

let seq = 0;
function conv(name: string, updatedAt = "2026-01-01T00:00:00.000Z", body = ""): Conversation {
	return {
		id: `c${seq++}`,
		name,
		createdAt: updatedAt,
		updatedAt,
		systemPrompt: "",
		contextNotes: [],
		resumeMode: "full",
		provider: "anthropic",
		model: "claude",
		messages: body ? [{ id: `m${seq++}`, role: "user", content: body, timestamp: updatedAt }] : [],
	} as Conversation;
}

describe("titleScore", () => {
	it("needs every typed word in the title", () => {
		expect(titleScore(tokenize("exposé seestraße"), "Exposé Seestraße 4")).toBeGreaterThan(0);
		expect(titleScore(tokenize("exposé garten"), "Exposé Seestraße 4")).toBe(0);
	});

	it("finds a word inside a German compound, for less than a whole word", () => {
		const inside = titleScore(tokenize("vertrag"), "Mietvertrag prüfen");
		const whole = titleScore(tokenize("vertrag"), "Vertrag prüfen");
		expect(inside).toBeGreaterThan(0);
		expect(whole).toBeGreaterThan(inside);
	});
});

describe("searchTitles", () => {
	it("searches titles only, never the messages", () => {
		const inTitle = conv("Küche planen");
		const inBody = conv("Einrichtung", undefined, "die Küche soll hell werden");
		expect(searchTitles("küche", [inTitle, inBody]).hits).toEqual([inTitle]);
	});

	it("puts the closer match first, then the newer", () => {
		const older = conv("Vertrag Seestraße", "2026-01-01T00:00:00.000Z");
		const newer = conv("Vertrag Bergweg", "2026-03-01T00:00:00.000Z");
		const compound = conv("Mietvertrag Hof", "2026-05-01T00:00:00.000Z");
		expect(searchTitles("vertrag", [compound, older, newer]).hits).toEqual([newer, older, compound]);
	});

	it("answers nothing for nothing typed", () => {
		expect(searchTitles("   ", [conv("a")])).toEqual({ queryTokens: [], hits: [] });
	});

	it("caps the list", () => {
		const many = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, i) => conv(`Kajak ${i}`));
		expect(searchTitles("kajak", many).hits).toHaveLength(SEARCH_RESULT_LIMIT);
	});

	it("survives a conversation without a name", () => {
		const broken = { ...conv("x"), name: undefined } as unknown as Conversation;
		expect(() => searchTitles("x", [broken])).not.toThrow();
	});
});

describe("meaning joins the titles", () => {
	it("asks only once something with a meaning was typed", () => {
		expect(meaningQuery("kü")).toBeNull();
		expect(meaningQuery("  helle küche ")).toBe("helle küche");
	});

	it("adds what the titles missed, in meaning's order, each once, only if it still exists", () => {
		const a = conv("Küche");
		const b = conv("Einrichtung");
		const c = conv("Licht");
		const byId = new Map([a, b, c].map((x) => [x.id, x]));
		expect(meaningOnly([a], [c.id, a.id, "deleted", b.id, c.id], byId)).toEqual([c, b]);
	});
});
