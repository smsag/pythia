import { describe, it, expect } from "vitest";
import {
	answerByNumber, answerLabel, answerNumbers, answerResolver, isAnswerCited, labelledAnswer, resolveAnswerCitations,
} from "../services/answerCitations";
import { eachCitationSegment, parseCitations, stripForeignCitations } from "../services/citations";
import { historyAnswerNumbers, historyContent } from "../services/messageUtils";
import { buildSystemPrompt } from "../services/ContextBuilder";
import { CITE_ANSWERS_INSTRUCTION } from "../services/promptConstants";
import { citationsToFootnotes, FootnoteNumbering, messageSourcesResolver } from "../services/noteFootnotes";
import { updateNoteFootnotes, withExportFootnotes } from "../services/anchorFootnotes";
import { findAnchors } from "../services/noteAnchors";
import { applyPendingTemplate, armPendingTemplate } from "../services/pendingTemplate";
import { sanitizeConversationFields } from "../services/persistence";
import { isRetryWithheld } from "../ui/TruncationController";
import { resumeDeepLink } from "../utils";
import type { Conversation, Message, PythiaTemplate } from "../models/types";

const T = "2026-09-29T12:00:00.000Z";
const msg = (id: string, role: Message["role"], content: string, over: Partial<Message> = {}): Message =>
	({ id, role, content, timestamp: T, ...over });

function conv(over: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1", name: "Rent cap scenarios", systemPrompt: "", contextNotes: [], resumeMode: "full",
		provider: "anthropic", model: "m", createdAt: T, updatedAt: T,
		messages: [
			msg("u1", "user", "What about the index clause?", { chapterName: "Index clause" }),
			msg("a1", "assistant", "The index lags a year."),
			msg("u2", "user", "And new leases?", { chapterName: "New leases" }),
			msg("a2", "assistant", "Die Kappung gilt nur für neue Verträge und nicht für die alten."),
		],
		...over,
	} as Conversation;
}
const link = (id: string, m: string) => resumeDeepLink(id, "V", m);

describe("Pythia numbers the answers, never the model (ADR-250)", () => {
	it("numbers answers 1, 2, … in conversation order, questions not at all", () => {
		expect([...answerNumbers(conv().messages)]).toEqual([["a1", 1], ["a2", 2]]);
		expect(answerByNumber(conv().messages, 2)?.id).toBe("a2");
		expect(answerByNumber(conv().messages, 3)).toBeNull();
	});

	it("labels an answer once, even if it copied a label into itself", () => {
		expect(labelledAnswer("Text", 3)).toBe("⟦answer:3⟧\nText");
		expect(labelledAnswer("⟦answer:9⟧ Text", 3)).toBe("⟦answer:3⟧\nText");
		expect(answerLabel(7)).toBe("⟦answer:7⟧");
	});

	it("only a conversation that cites answers sends them labelled", () => {
		expect(historyAnswerNumbers(conv())).toBeUndefined();
		const numbers = historyAnswerNumbers(conv({ citeAnswers: true }))!;
		expect(historyContent(conv().messages[3], numbers)).toBe("⟦answer:2⟧\nDie Kappung gilt nur für neue Verträge und nicht für die alten.");
		expect(historyContent(conv().messages[2], numbers)).toBe("And new leases?");
		expect(historyContent(conv().messages[3])).toBe(conv().messages[3].content);
	});

	it("the instruction joins the system prompt only with the flag", () => {
		expect(buildSystemPrompt(conv())).not.toContain(CITE_ANSWERS_INSTRUCTION);
		expect(buildSystemPrompt(conv({ citeAnswers: true }))).toContain(CITE_ANSWERS_INSTRUCTION);
	});

	it("a label the model copied into its reply is noise, never shown", () => {
		expect(stripForeignCitations("⟦answer:4⟧\nThe cap ⟦answer:2⟧ holds.")).toBe("The cap holds.");
	});
});

describe("resolving ⟦cite:answer:n⟧", () => {
	it("a number becomes that answer, titled by its chapter; one naming nothing is dropped", () => {
		const text = "Capped.⟦cite:answer:2⟧ Lagging.⟦cite:answer:1⟧ Invented.⟦cite:answer:9⟧ Also ⟦cite:answer:x⟧";
		const cited = parseCitations(text);
		expect(cited.map((c) => c.kind)).toEqual(["answer", "answer", "answer", "answer"]);
		const { sources, dropped } = resolveAnswerCitations(cited, conv().messages);
		expect(sources).toEqual([
			{ n: 1, kind: "answer", ref: "a2", title: "New leases", cite: "2" },
			{ n: 2, kind: "answer", ref: "a1", title: "Index clause", cite: "1" },
		]);
		expect(dropped).toEqual(["9", "x"]);
	});

	it("vault and web sources pass through, and the chip finds its answer by the number said", () => {
		const cited = parseCitations("A⟦cite:note:N.md⟧ B⟦cite:answer:1⟧");
		const { sources } = resolveAnswerCitations(cited, conv().messages);
		expect(sources.map((s) => [s.n, s.kind])).toEqual([[1, "vault"], [2, "answer"]]);
		const hits: (string | null)[] = [];
		eachCitationSegment("B⟦cite:answer:1⟧", sources, () => {}, (s) => hits.push(s?.ref ?? null));
		expect(hits).toEqual(["a1"]);
	});
});

describe("an answer citation in a note is a footnote linking the answer", () => {
	it("in a note tool's content, the number resolves against the conversation", () => {
		const out = citationsToFootnotes("The cap applies only to new leases.⟦cite:answer:2⟧", [], "", answerResolver(conv(), link, "en", true));
		expect(out).toBe(`The cap applies only to new leases.[^1]\n\n[^1]: [„Rent cap scenarios › New leases“](${link("c1", "a2")}) (Pythia, 29 Sep 2026)\n`);
	});

	it("quote marks follow the cited answer's language, else the fallback; a number naming nothing is dropped", () => {
		// a2 is German, whatever the fallback says.
		expect(citationsToFootnotes("X.⟦cite:answer:2⟧", [], "", answerResolver(conv(), link, "en", true))).toContain("[„Rent cap scenarios › New leases“]");
		// a1 is too short to tell: the fallback decides.
		const out = citationsToFootnotes("Lags.⟦cite:answer:1⟧ Nope.⟦cite:answer:5⟧", [], "", answerResolver(conv(), link, "it", true));
		expect(out).toContain("[«Rent cap scenarios › Index clause»]");
		expect(out).not.toContain("⟦");
		expect(out.match(/\[\^\d\]:/g)).toHaveLength(1);
	});

	it("in Save to note, a stored source finds its answer by the number it said", () => {
		const m = msg("a3", "assistant", "Summary.⟦cite:answer:2⟧", { sources: [{ n: 1, kind: "answer", ref: "a2", title: "New leases", cite: "2" }] });
		const out = new FootnoteNumbering([m.content]).apply(m.content, messageSourcesResolver(m.sources, answerResolver(conv(), link)));
		expect(out).toContain(`[^1]: [„Rent cap scenarios › New leases“](${link("c1", "a2")}) (Pythia, 29 Sep 2026)`);
	});

	it("an archive names the answer without a link — its conversation is being removed", () => {
		const m = msg("a3", "assistant", "S.⟦cite:answer:2⟧", { sources: [{ n: 1, kind: "answer", ref: "a2", title: "New leases", cite: "2" }] });
		const out = new FootnoteNumbering([m.content]).apply(m.content, messageSourcesResolver(m.sources, answerResolver(conv(), null)));
		expect(out).toContain("[^1]: „Rent cap scenarios › New leases“ (Pythia, 29 Sep 2026)");
		expect(out).not.toContain("obsidian://");
	});

	it("the footnote's link is a note anchor, and never gets a footnote of its own", () => {
		const note = citationsToFootnotes("Capped.⟦cite:answer:2⟧", [], "", answerResolver(conv(), link, "en", true));
		expect(findAnchors(note).map((a) => a.ref)).toEqual([{ id: "c1", msg: "a2" }]);
		const resolve = () => ({ state: "none" as const, conversationName: "X" });
		expect(updateNoteFootnotes(note, resolve)).toBe(note);
		const printed = withExportFootnotes(note, resolve);
		expect(printed).toBe("Capped.[^1]\n\n[^1]: „Rent cap scenarios › New leases“ (Pythia, 29 Sep 2026)\n");
	});
});

describe("the template flag", () => {
	const tpl = { id: "T.md", name: "Vision", systemPrompt: "Write a vision.", contextNotes: [], citeAnswers: true } as PythiaTemplate;

	it("an armed template numbers the answers for its one send only", () => {
		const c = conv();
		c.pendingTemplate = armPendingTemplate(tpl);
		expect(applyPendingTemplate(c).citeAnswers).toBe(true);
		expect(c.citeAnswers).toBeUndefined();
		const plain = conv();
		plain.pendingTemplate = armPendingTemplate({ ...tpl, citeAnswers: undefined });
		expect(applyPendingTemplate(plain).citeAnswers).toBeUndefined();
	});

	it("reads back from data.json only as true", () => {
		const c = conv({ citeAnswers: "yes" as unknown as true });
		sanitizeConversationFields(c);
		expect(c.citeAnswers).toBeUndefined();
		const d = conv({ citeAnswers: true });
		sanitizeConversationFields(d);
		expect(d.citeAnswers).toBe(true);
	});
});

describe("a cited answer is not removed from under its note", () => {
	it("Retry is withheld on an answer a note cites", () => {
		const c = conv();
		const answer = c.messages[3];
		expect(isRetryWithheld(c, answer)).toBe(false);
		c.noteAnchors = [{ path: "Vision.md", messageId: "a2", createdAt: T }];
		expect(isAnswerCited(c, "a2")).toBe(true);
		expect(isRetryWithheld(c, answer)).toBe(true);
		expect(isAnswerCited(c, "a1")).toBe(false);
	});
});
