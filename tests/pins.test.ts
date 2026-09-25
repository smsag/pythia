// ADR-216: the rules for pinning answer content, which hold wherever a pin
// comes from — the limits are refused, never applied quietly; a load keeps what
// the user pinned; a pin is a snapshot that outlives the message it came from.
import { describe, it, expect } from "vitest";
import type { Conversation, Pin } from "../models/types";
import { addPin, isRefusal, pinExcerpt, PIN_LIMIT, PIN_MAX_CHARS, removePin, type PinDraft } from "../services/pins";
import { normalizePins, partitionEvictions } from "../services/persistence";
import { spliceExchange } from "../services/conversationEdits";
import { keepCandidate, startComparison } from "../services/comparison";

function conv(over: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1", name: "C", createdAt: "", updatedAt: "2026-01-01T00:00:00Z", provider: "anthropic", model: "m",
		messages: [], contextNotes: [], ...over,
	} as Conversation;
}
const draft = (source: string, over: Partial<PinDraft> = {}): PinDraft => ({ messageId: "a1", kind: "text", source, ...over });
let n = 0;
const id = (): string => `p${++n}`;

describe("addPin", () => {
	it("adds a pin with an id and a date, and keeps the occurrence of a text pin", () => {
		const c = conv();
		const pin = addPin(c, draft("the passage", { occurrenceIndex: 2 }), "p-a", "2026-09-25T10:00:00Z");
		expect(isRefusal(pin)).toBe(false);
		expect(c.pins).toEqual([{ id: "p-a", messageId: "a1", kind: "text", source: "the passage", occurrenceIndex: 2, createdAt: "2026-09-25T10:00:00Z" }]);
	});

	it("refuses the pin after the limit, with the reason — never drops an older one", () => {
		const c = conv();
		for (let i = 0; i < PIN_LIMIT; i++) addPin(c, draft(`p ${i}`), id(), "");
		const r = addPin(c, draft("one too many"), id(), "");
		expect(r).toEqual({ reason: "limit", limit: PIN_LIMIT });
		expect(c.pins).toHaveLength(PIN_LIMIT);
		expect(c.pins?.[0].source).toBe("p 0");
	});

	it("refuses a pin that is too long, and never truncates it", () => {
		const c = conv();
		const r = addPin(c, draft("x".repeat(PIN_MAX_CHARS + 1), { kind: "code" }), id(), "");
		expect(r).toEqual({ reason: "tooLong", chars: PIN_MAX_CHARS + 1, max: PIN_MAX_CHARS });
		expect(c.pins).toBeUndefined();
		expect(isRefusal(addPin(c, draft("x".repeat(PIN_MAX_CHARS)), id(), ""))).toBe(false);
	});

	it("a second press on the same thing is not a second pin", () => {
		const c = conv();
		const first = addPin(c, draft("same", { occurrenceIndex: 0 }), "p-1", "");
		const again = addPin(c, draft("same", { occurrenceIndex: 0 }), "p-2", "");
		expect(again).toBe(first);
		expect(c.pins).toHaveLength(1);
		// …but the same text at another place in the answer is another pin.
		addPin(c, draft("same", { occurrenceIndex: 1 }), "p-3", "");
		expect(c.pins).toHaveLength(2);
	});

	it("an empty selection pins nothing", () => {
		expect(addPin(conv(), draft("   "), id(), "")).toEqual({ reason: "empty" });
	});
});

describe("removePin", () => {
	it("removes one, and drops the field when the last goes", () => {
		const c = conv();
		addPin(c, draft("a"), "p-a", "");
		addPin(c, draft("b"), "p-b", "");
		removePin(c, "p-a");
		expect(c.pins?.map((p) => p.id)).toEqual(["p-b"]);
		removePin(c, "p-b");
		expect("pins" in c).toBe(false);
	});
});

describe("pinExcerpt — the one line the collapsed strip shows", () => {
	it("text: its first line", () => {
		expect(pinExcerpt("text", "\n  First line\nsecond")).toBe("First line");
	});
	it("code and diagrams: the first line of code, not the fence", () => {
		expect(pinExcerpt("code", "```python\ndef revenue(q):\n    return 1\n```")).toBe("def revenue(q):");
		expect(pinExcerpt("diagram", "```mermaid\ngraph TD\n  A-->B\n```")).toBe("graph TD");
	});
	it("a chart: its title", () => {
		expect(pinExcerpt("chart", '```pythia-chart\n{"type":"bar","title":"Revenue by quarter"}\n```')).toBe("Revenue by quarter");
	});
	it("a table: its header row", () => {
		expect(pinExcerpt("table", "| Quarter | Revenue |\n| --- | --- |\n| Q1 | 10 |")).toBe("Quarter · Revenue");
	});
	it("a table: escaped cells read as text, and an escaped pipe does not split a cell", () => {
		expect(pinExcerpt("table", "| a \\| b | \\*note\\* |\n| --- | --- |")).toBe("a | b · *note*");
	});
	it("is cut to one line with an ellipsis", () => {
		const long = pinExcerpt("text", "word ".repeat(40), 20);
		expect(long.length).toBeLessThanOrEqual(20);
		expect(long.endsWith("…")).toBe(true);
	});
});

describe("normalizePins — a load validates, and keeps what the user pinned", () => {
	it("drops malformed pins and keeps good ones", () => {
		const c = conv({
			pins: [
				{ id: "ok", messageId: "a1", kind: "code", source: "```\nx\n```", createdAt: "" },
				{ id: "bad-kind", messageId: "a1", kind: "video", source: "x", createdAt: "" },
				{ id: "empty", messageId: "a1", kind: "text", source: "   ", createdAt: "" },
				{ id: "no-msg", kind: "text", source: "x", createdAt: "" },
				null,
				"a string",
			] as unknown as Pin[],
		});
		normalizePins(c);
		expect(c.pins?.map((p) => p.id)).toEqual(["ok"]);
	});

	it("does NOT enforce the limits — another device may have written more", () => {
		const many = Array.from({ length: PIN_LIMIT + 1 }, (_, i) => ({ id: `p${i}`, messageId: "a1", kind: "text", source: `s${i}`, createdAt: "" }));
		const huge = { id: "big", messageId: "a1", kind: "code", source: "x".repeat(PIN_MAX_CHARS + 5000), createdAt: "" };
		const c = conv({ pins: [...many, huge] as Pin[] });
		normalizePins(c);
		expect(c.pins).toHaveLength(PIN_LIMIT + 2);
	});

	it("repairs a missing id and drops a bad occurrence index", () => {
		const c = conv({ pins: [{ messageId: "a1", kind: "text", source: "x", occurrenceIndex: -3 }] as unknown as Pin[] });
		normalizePins(c, () => "fresh");
		expect(c.pins?.[0].id).toBe("fresh");
		expect(c.pins?.[0].occurrenceIndex).toBeUndefined();
	});

	it("removes a field that is not a list, or is an empty one", () => {
		const a = conv({ pins: "nope" as unknown as Pin[] });
		normalizePins(a);
		expect("pins" in a).toBe(false);
		const b = conv({ pins: [] });
		normalizePins(b);
		expect("pins" in b).toBe(false);
	});
});

describe("a pin is a snapshot: it outlives its message", () => {
	const pinned = (): Conversation => conv({
		messages: [
			{ id: "u1", role: "user", content: "q", timestamp: "" },
			{ id: "a1", role: "assistant", content: "answer", timestamp: "" },
		] as Conversation["messages"],
		pins: [{ id: "p", messageId: "a1", kind: "text", source: "answer", createdAt: "" }],
	});

	it("deleting the exchange leaves the pin", () => {
		const c = pinned();
		spliceExchange(c, "u1", "a1");
		expect(c.messages).toHaveLength(0);
		expect(c.pins?.map((p) => p.id)).toEqual(["p"]);
	});

	it("keeping another candidate in a comparison leaves the pin", () => {
		const c = pinned();
		startComparison(c, "u1", "a1");
		const other = c.comparison!.candidates[0];
		c.comparison!.candidates.push({ ...other, id: "cand-2", content: "other", model: "m2" });
		keepCandidate(c, "cand-2");
		expect(c.pins?.map((p) => p.id)).toEqual(["p"]);
	});
});

describe("eviction — a pinned conversation is kept, like a starred one", () => {
	it("keeps the pinned conversation over a newer plain one", () => {
		const old = conv({ id: "old", updatedAt: "2020-01-01T00:00:00Z", pins: [{ id: "p", messageId: "a", kind: "text", source: "x", createdAt: "" }] });
		const plainA = conv({ id: "a", updatedAt: "2026-01-02T00:00:00Z" });
		const plainB = conv({ id: "b", updatedAt: "2026-01-03T00:00:00Z" });
		const { kept, removed } = partitionEvictions([old, plainA, plainB], 2, []);
		expect(kept.map((c) => c.id)).toContain("old");
		expect(removed.map((c) => c.id)).toEqual(["a"]);
	});
});
