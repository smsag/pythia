import { describe, it, expect } from "vitest";
import {
	parseCitations,
	stripCitationMarkers,
	eachCitationSegment,
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
