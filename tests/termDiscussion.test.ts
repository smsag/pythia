// Writing a forked discussion back into its term's note (ADR-208).
//
// Every outcome here is one the user meets: the entry gone, the discussion empty,
// the model failing mid-call. None of them may be silent (principle 2).

import { describe, it, expect } from "vitest";
import { saveTermDiscussion, type TermDiscussionHost } from "../ui/termDiscussion";
import type { GlossaryEntry } from "../services/glossary";
import type { Conversation } from "../models/types";

const ENTRY: GlossaryEntry = {
	term: "Kartellrecht",
	definition: "Das Recht gegen wettbewerbsbeschränkende Absprachen.",
	source: "model",
};

interface Spy {
	host: TermDiscussionHost;
	said: string[];
	saved: { term: string; text: string }[];
	summarized: string[];
	/** Progress notices opened and then dismissed, in order. */
	progress: { message: string; closed: boolean }[];
}

// `entry` is null for "the note is gone" — not undefined, which JavaScript
// would quietly replace with the default.
function spy(over: Partial<TermDiscussionHost> = {}, entry: GlossaryEntry | null = ENTRY): Spy {
	const said: string[] = [];
	const saved: { term: string; text: string }[] = [];
	const summarized: string[] = [];
	const progress: { message: string; closed: boolean }[] = [];
	const host: TermDiscussionHost = {
		all: async () => (entry ? [entry] : []),
		find: () => entry ?? null,
		hydrate: async (e) => e,
		summarize: async (term) => { summarized.push(term); return "Es trennt Absprachen von Marktmacht."; },
		save: async (term, text) => { saved.push({ term, text }); return { ...ENTRY, discussion: text }; },
		progress: (message) => {
			const row = { message, closed: false };
			progress.push(row);
			return () => { row.closed = true; };
		},
		notify: (message) => said.push(message),
		...over,
	};
	return { host, said, saved, summarized, progress };
}

const conv = (over: Partial<Conversation> = {}): Conversation =>
	({ glossaryTerm: "Kartellrecht", model: "m", messages: [], ...over }) as Conversation;

describe("saveTermDiscussion (ADR-208)", () => {
	it("summarizes the conversation and writes the section", async () => {
		const s = spy();
		const out = await saveTermDiscussion(s.host, conv());
		expect(s.summarized).toEqual(["Kartellrecht"]);
		expect(s.saved).toEqual([{ term: "Kartellrecht", text: "Es trennt Absprachen von Marktmacht." }]);
		expect(out?.discussion).toBe("Es trennt Absprachen von Marktmacht.");
		expect(s.said).toHaveLength(1);
	});

	it("does nothing at all on a conversation that was not opened from a term", async () => {
		const s = spy();
		expect(await saveTermDiscussion(s.host, conv({ glossaryTerm: undefined }))).toBeNull();
		expect(s.summarized).toEqual([]);
		expect(s.progress).toEqual([]);
		// Not an error either — the row that triggers this is not shown there.
		expect(s.said).toEqual([]);
	});

	it("says so when the entry is gone, and never asks the model", async () => {
		// The note is the user's; they may have deleted it since the fork.
		const s = spy({}, null);
		expect(await saveTermDiscussion(s.host, conv())).toBeNull();
		expect(s.summarized).toEqual([]);
		expect(s.said).toHaveLength(1);
		expect(s.said[0]).toContain("Kartellrecht");
	});

	it("reports a refused write without claiming it saved", async () => {
		// `save` refuses an empty summary and speaks for itself; this must not
		// then announce a success on top of it.
		const s = spy({ summarize: async () => "", save: async () => null });
		expect(await saveTermDiscussion(s.host, conv())).toBeNull();
		expect(s.said).toEqual([]);
	});

	it("surfaces a failed model call instead of swallowing it", async () => {
		const s = spy({ summarize: async () => { throw new Error("rate limited"); } });
		expect(await saveTermDiscussion(s.host, conv())).toBeNull();
		expect(s.said.join()).toContain("rate limited");
	});

	it("always dismisses the progress notice — on success, on refusal and on failure", async () => {
		for (const over of [
			{},
			{ save: async () => null },
			{ summarize: async () => { throw new Error("boom"); } },
		] as Partial<TermDiscussionHost>[]) {
			const s = spy(over);
			await saveTermDiscussion(s.host, conv());
			expect(s.progress).toHaveLength(1);
			expect(s.progress[0].closed).toBe(true);
		}
	});

	it("passes the hydrated definition, not the empty one the index carries", async () => {
		// `all()` reads frontmatter only; without the hydrate the summarizer would
		// be told the term has no definition and would write one back as news.
		const definitions: string[] = [];
		const s = spy({
			all: async () => [{ ...ENTRY, definition: "" }],
			find: () => ({ ...ENTRY, definition: "" }),
			hydrate: async () => ENTRY,
			summarize: async (_t, definition) => { definitions.push(definition); return "x"; },
		});
		await saveTermDiscussion(s.host, conv());
		expect(definitions).toEqual([ENTRY.definition]);
	});
});
