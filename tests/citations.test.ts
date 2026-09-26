import { describe, it, expect } from "vitest";
import {
	parseCitations,
	stripCitationMarkers,
	eachCitationSegment,
	stripForeignCitations,
	resolveWebCitations,
} from "../services/citations";

describe("parseCitations", () => {
	it("returns [] when there are no markers", () => {
		expect(parseCitations("plain text, no citations")).toEqual([]);
		expect(parseCitations("")).toEqual([]);
	});

	it("numbers sources by first appearance", () => {
		const c = "A⟦cite:note:First.md⟧ then B⟦cite:web:example.com⟧.";
		const s = parseCitations(c);
		expect(s).toHaveLength(2);
		expect(s[0]).toMatchObject({ n: 1, kind: "vault", ref: "First.md", title: "First" });
		expect(s[1]).toMatchObject({ n: 2, kind: "web", ref: "example.com", title: "example.com" });
	});

	it("dedupes repeated (kind, ref) but keeps distinct refs", () => {
		const c = "X⟦cite:note:A.md⟧ Y⟦cite:note:A.md⟧ Z⟦cite:note:B.md⟧";
		const s = parseCitations(c);
		expect(s.map((x) => x.ref)).toEqual(["A.md", "B.md"]);
		expect(s.map((x) => x.n)).toEqual([1, 2]);
	});

	it("treats same ref under different kinds as distinct", () => {
		const c = "⟦cite:note:example.com⟧ ⟦cite:web:example.com⟧";
		const s = parseCitations(c);
		expect(s).toHaveLength(2);
		expect(s[0].kind).toBe("vault");
		expect(s[1].kind).toBe("web");
	});

	it("derives titles: basename without .md, bare domain without www.", () => {
		const s = parseCitations("⟦cite:note:folder/sub/My Note.md⟧ ⟦cite:web:www.ecb.europa.eu⟧");
		expect(s[0].title).toBe("My Note");
		expect(s[1].title).toBe("ecb.europa.eu");
	});
});

describe("stripCitationMarkers", () => {
	it("removes markers and tidies spacing before punctuation", () => {
		const c = "The rate is 1.75%⟦cite:web:ecb.europa.eu⟧, confirmed⟦cite:note:Memo.md⟧.";
		expect(stripCitationMarkers(c)).toBe("The rate is 1.75%, confirmed.");
	});

	it("is a no-op when there are no markers", () => {
		expect(stripCitationMarkers("nothing here")).toBe("nothing here");
	});
});

describe("eachCitationSegment", () => {
	it("streams text and marker segments in document order", () => {
		const c = "a⟦cite:note:A.md⟧b⟦cite:web:x.com⟧";
		const sources = parseCitations(c);
		const events: string[] = [];
		eachCitationSegment(
			c,
			sources,
			(t) => events.push(`T:${t}`),
			(s) => events.push(`M:${s ? s.n : "?"}`),
		);
		expect(events).toEqual(["T:a", "M:1", "T:b", "M:2"]);
	});

	it("passes null for a marker with no matching source", () => {
		const seen: (number | null)[] = [];
		eachCitationSegment("x⟦cite:note:Z.md⟧", [], () => {}, (s) => seen.push(s ? s.n : null));
		expect(seen).toEqual([null]);
	});
});

describe("stripForeignCitations", () => {
	it("removes GPT-style 【N†source】 markers and tidies spacing", () => {
		const c = "Mbappé: 22 goals 【1†source】 【2†source】 【4†source】 .";
		expect(stripForeignCitations(c)).toBe("Mbappé: 22 goals.");
	});
	it("leaves ordinary 【…】 without a dagger untouched", () => {
		expect(stripForeignCitations("見出し【重要】です")).toBe("見出し【重要】です");
	});
	it("is a no-op with no fullwidth brackets", () => {
		expect(stripForeignCitations("plain text")).toBe("plain text");
	});
});

describe("resolveWebCitations (ADR-226)", () => {
	const results = [
		{ n: 1, title: "ECB", url: "https://www.ecb.europa.eu/press/x" },
		{ n: 2, title: "HB", url: "https://handelsblatt.com/y" },
		{ n: 3, title: "HB 2", url: "https://handelsblatt.com/z" },
	];

	it("a numbered marker opens THAT article — the full URL, not the site's homepage", () => {
		const { sources } = resolveWebCitations(parseCitations("Rate cut⟦cite:web:3⟧."), results);
		expect(sources[0]).toMatchObject({ n: 1, kind: "web", ref: "https://handelsblatt.com/z", title: "handelsblatt.com", cite: "3" });
	});

	it("keeps two articles from one site as two sources (deduplicated by URL, not domain)", () => {
		const { sources } = resolveWebCitations(parseCitations("A⟦cite:web:2⟧ B⟦cite:web:3⟧"), results);
		expect(sources.map((s) => s.ref)).toEqual([
			"https://handelsblatt.com/y", "https://handelsblatt.com/z", "https://www.ecb.europa.eu/press/x",
		]);
	});

	it("appends every uncited result once, after the cited ones, with vault sources untouched", () => {
		const { sources } = resolveWebCitations(parseCitations("A⟦cite:note:Memo.md⟧ B⟦cite:web:2⟧"), results);
		expect(sources.map((s) => [s.n, s.kind, s.title])).toEqual([
			[1, "vault", "Memo"],
			[2, "web", "handelsblatt.com"],
			[3, "web", "ecb.europa.eu"],
			[4, "web", "handelsblatt.com"],
		]);
	});

	it("a domain marker (an older message, or a model that ignored the instruction) takes the first result from that domain", () => {
		const { sources } = resolveWebCitations(parseCitations("Fact⟦cite:web:handelsblatt.com⟧."), results);
		expect(sources[0]).toMatchObject({ ref: "https://handelsblatt.com/y", cite: "handelsblatt.com" });
		expect(sources).toHaveLength(3);
	});

	it("drops a marker no fetched result answers for — a made-up citation is not a source", () => {
		const { sources, dropped } = resolveWebCitations(parseCitations("X⟦cite:web:9⟧ Y⟦cite:web:nowhere.org⟧"), results);
		expect(dropped).toEqual(["9", "nowhere.org"]);
		expect(sources.every((s) => s.ref.startsWith("https://"))).toBe(true);
	});

	it("the chip is found by what the marker said, and an unresolved marker draws no chip", () => {
		const { sources } = resolveWebCitations(parseCitations("A⟦cite:web:2⟧ B⟦cite:web:9⟧"), results);
		const seen: (string | null)[] = [];
		eachCitationSegment("A⟦cite:web:2⟧ B⟦cite:web:9⟧", sources, () => {}, (s) => seen.push(s ? s.ref : null));
		expect(seen).toEqual(["https://handelsblatt.com/y", null]);
	});
});
