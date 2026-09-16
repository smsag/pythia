import { describe, it, expect } from "vitest";
import { estimateTokensFromBytes, estimateTokensFromText } from "../services/messageUtils";

describe("estimateTokensFromBytes", () => {
	it("returns ~N for small byte counts", () => {
		expect(estimateTokensFromBytes(40)).toBe("~10");
	});

	it("rounds to nearest token", () => {
		expect(estimateTokensFromBytes(5)).toBe("~1");
		expect(estimateTokensFromBytes(6)).toBe("~2");
	});

	it("formats counts >= 1000 as ~Xk with one decimal", () => {
		expect(estimateTokensFromBytes(4000)).toBe("~1.0k");
		expect(estimateTokensFromBytes(6000)).toBe("~1.5k");
		expect(estimateTokensFromBytes(40000)).toBe("~10.0k");
	});

	it("handles zero bytes", () => {
		expect(estimateTokensFromBytes(0)).toBe("~0");
	});
});

describe("estimateTokensFromText", () => {
	it("returns character count divided by 4, rounded", () => {
		expect(estimateTokensFromText("abcd")).toBe(1);       // 4 chars = 1 token
		expect(estimateTokensFromText("abcdefgh")).toBe(2);    // 8 chars = 2 tokens
	});

	it("rounds half up", () => {
		expect(estimateTokensFromText("ab")).toBe(1);          // 2 chars → 0.5 → rounds to 1
		expect(estimateTokensFromText("a")).toBe(0);           // 1 char → 0.25 → rounds to 0
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokensFromText("")).toBe(0);
	});

	it("returns a number (not a formatted string)", () => {
		expect(typeof estimateTokensFromText("hello world")).toBe("number");
	});
});

// ── todayISO / withConversationBacklink ──────────────────────────────────────

import { todayISO, withConversationBacklink } from "../utils";

describe("todayISO", () => {
	it("uses the local calendar date, not UTC", () => {
		// 23:30 local on the 15th: toISOString() would already say the 16th east of UTC.
		const local = new Date(2026, 8, 15, 23, 30);
		expect(todayISO(local)).toBe("2026-09-15");
	});

	it("zero-pads month and day", () => {
		expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05");
	});
});

describe("withConversationBacklink", () => {
	it("appends a resume deep link with the vault and id encoded", () => {
		const out = withConversationBacklink("text", { id: "a b", name: "Chat" }, "My Vault");
		expect(out).toBe("text\n\n[↗ Chat](obsidian://pythia?vault=My%20Vault&cmd=resume&id=a%20b)");
	});

	it("escapes brackets in the name so the link text cannot close early", () => {
		const out = withConversationBacklink("t", { id: "1", name: "A [b] c" }, "V");
		expect(out).toContain("[↗ A \\[b\\] c](");
	});

	it("returns the text unchanged without a conversation", () => {
		expect(withConversationBacklink("t", null, "V")).toBe("t");
	});
});

import { safeNoteName, normalizeVaultPath, yamlString } from "../services/pathUtils";

describe("pathUtils", () => {
	it("safeNoteName replaces illegal characters and never returns an empty name", () => {
		expect(safeNoteName('a/b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
		expect(safeNoteName("   ")).toBe("Untitled");
	});

	it("normalizeVaultPath collapses slashes and dot segments but leaves .. for the writer to reject", () => {
		expect(normalizeVaultPath("\\A\\.\\B\\\\c.md")).toBe("A/B/c.md");
		expect(normalizeVaultPath("../x.md")).toBe("../x.md");
	});

	it("yamlString produces a valid double-quoted scalar", () => {
		expect(yamlString('He said "hi": #1')).toBe('"He said \\"hi\\": #1"');
	});
});
