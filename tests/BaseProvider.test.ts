import { describe, it, expect, vi, beforeEach } from "vitest";

// Track every Notice constructed so tests can assert the non-destructive surface.
const { noticeMessages } = vi.hoisted(() => ({ noticeMessages: [] as string[] }));

// Obsidian's UI locale, mutable so the "follow Obsidian" language setting can be
// exercised (ADR-148).
const { obsidianLocale } = vi.hoisted(() => ({ obsidianLocale: { value: "en" } }));

vi.mock("obsidian", () => ({
	App: class {},
	Notice: class { constructor(message?: string) { noticeMessages.push(message ?? ""); } },
	TFile: class {},
	TFolder: class {},
	Component: class {},
	MarkdownRenderer: { render: async () => {} },
	requestUrl: async () => ({}),
	normalizePath: (p: string) => p,
	setIcon: () => {},
}));

// t() echoes the key, appending the interpolated error so the Notice text is assertable.
vi.mock("../i18n", () => ({
	t: (key: string, params?: Record<string, string>) =>
		params ? `${key}: ${params.error ?? ""}` : key,
	getObsidianLocale: () => obsidianLocale.value,
}));

import { BaseProvider, type RoundResult } from "../services/BaseProvider";
import type { App } from "obsidian";
import { TFile as TFileCls } from "obsidian";
import type { PythiaSettings } from "../settings";
import type { Conversation, TokenUsage } from "../models/types";

/**
 * Minimal concrete BaseProvider that stubs the abstract streaming hooks and
 * exposes the protected `finishOrError` router under test (ADR: preserve the
 * streamed partial on a post-stream error — engineering-review, 2.1.1).
 */
class TestProvider extends BaseProvider {
	protected resetClient(): void {}
	get fastModel(): string { return "fast"; }
	/** Every utility prompt sent, so prompt wording is assertable (ADR-166). */
	prompts: string[] = [];
	/** What the next utility call replies, so a reply parser is assertable (ADR-206). */
	reply = "";
	/** The model each utility call ran on, so "which model" is assertable (ADR-208). */
	models: string[] = [];
	protected callUtility(model: string, userMessage: string): Promise<string> {
		this.models.push(model);
		this.prompts.push(userMessage);
		return Promise.resolve(this.reply);
	}
	protected prepareStream(): Promise<void> { return Promise.resolve(); }
	protected runStreamRound(): Promise<RoundResult> {
		return Promise.resolve({ action: "done", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, hasUsage: false, truncated: false });
	}
	protected handleToolCalls(): Promise<void> { return Promise.resolve(); }

	/** `languageLabel` is protected; expose it so the resolution order is testable. */
	lang(conversation?: Conversation): string {
		return this.languageLabel(conversation);
	}

	/** `resolveUserContent` is protected; expose it so the ADR-183 warning rules
	 *  can be exercised without a real stream. */
	resolve(conv: Conversation, notes: string[], msg: string, auto?: ReadonlySet<string>) {
		return this.resolveUserContent(conv, notes, msg, auto);
	}

	finish(
		error: unknown,
		fullText: string,
		onComplete: (fullText: string, tokenUsage?: TokenUsage) => void,
		onError: (error: Error) => void,
	): void {
		this.finishOrError(error, fullText, onComplete, onError);
	}
}

function makeProvider(settings: Partial<PythiaSettings> = {}): TestProvider {
	return new TestProvider({} as App, settings as PythiaSettings, "", "anthropic");
}

const conv = (outputLanguage?: Conversation["outputLanguage"]): Conversation =>
	({ outputLanguage } as Conversation);

describe("BaseProvider.finishOrError", () => {
	beforeEach(() => { noticeMessages.length = 0; });

	it("keeps the partial and surfaces no error on a user-initiated abort", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const err = new Error("cancelled");
		err.name = "AbortError";
		p.finish(err, "partial answer", onComplete, onError);
		expect(onComplete).toHaveBeenCalledWith("partial answer");
		expect(onError).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
	});

	it("keeps the streamed partial and shows a non-destructive Notice on a genuine post-stream error", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		p.finish(new Error("Overloaded"), "streamed so far", onComplete, onError);
		// The visible reply is preserved as the assistant turn...
		expect(onComplete).toHaveBeenCalledWith("streamed so far");
		// ...and the destructive path is NOT taken.
		expect(onError).not.toHaveBeenCalled();
		// ...while the user is told it was cut short.
		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).toContain("Overloaded");
	});

	it("routes to onError (dropping the empty placeholder) when nothing streamed yet", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const err = new Error("connection failed");
		p.finish(err, "", onComplete, onError);
		expect(onError).toHaveBeenCalledWith(err);
		expect(onComplete).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
	});

	it("wraps a non-Error thrown value before routing to onError", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		p.finish("string failure", "", onComplete, onError);
		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledTimes(1);
		const arg = onError.mock.calls[0][0] as Error;
		expect(arg).toBeInstanceOf(Error);
		expect(arg.message).toBe("string failure");
	});
});

// ── Output language resolution (ADR-148) ──────────────────────────────────────

describe("BaseProvider.languageLabel", () => {
	beforeEach(() => { obsidianLocale.value = "en"; });

	it("falls back to the global setting when the conversation has no override", () => {
		expect(makeProvider({ outputLanguage: "it" }).lang(conv())).toBe("Italian");
	});

	it("lets a conversation override the global setting", () => {
		expect(makeProvider({ outputLanguage: "it" }).lang(conv("es"))).toBe("Spanish");
	});

	it("lets a conversation override a fixed global language back to 'auto'", () => {
		expect(makeProvider({ outputLanguage: "de" }).lang(conv("auto"))).toBe("");
	});

	it("uses the global setting for utility calls that have no conversation in reach", () => {
		expect(makeProvider({ outputLanguage: "de" }).lang()).toBe("German");
	});

	it("follows Obsidian's UI locale for the 'obsidian' setting", () => {
		obsidianLocale.value = "fr";
		expect(makeProvider({ outputLanguage: "obsidian" }).lang(conv())).toBe("French");
		expect(makeProvider({ outputLanguage: "auto" }).lang(conv("obsidian"))).toBe("French");
	});
});

// ── Definition language (ADR-166) ─────────────────────────────────────────────

describe("glossary prompts follow the passage under AUTO", () => {
	const PASSAGE_RULE = "Write the definition in the language the passage is written in.";

	it("AUTO names the passage's language instead of adding nothing", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.defineTerm("Zähler", "Der Zähler wird abgelesen.");
		await p.describePerson("Anna Weber", "Anna Weber leitet das Projekt.");
		expect(p.prompts[0]).toContain(PASSAGE_RULE);
		expect(p.prompts[1]).toContain(PASSAGE_RULE);
	});

	it("a named language is instructed as before, without the passage rule", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.defineTerm("Zähler", "Der Zähler wird abgelesen.", conv("it"));
		expect(p.prompts[0]).toContain("Respond in Italian.");
		expect(p.prompts[0]).not.toContain(PASSAGE_RULE);
	});

	it("chat and other utility prompts keep ADR-148's silence under AUTO", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.generateChapterName("Wie liest man einen Zähler ab?");
		expect(p.prompts[0]).not.toContain("language");
	});

	it("translateDefinition names the target and carries the definition", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		p.reply = "A device that records events.";
		const out = await p.translateDefinition("Ein Gerät, das Ereignisse erfasst.", "English");
		expect(p.prompts[0]).toContain("into English");
		expect(p.prompts[0]).toContain("Ein Gerät, das Ereignisse erfasst.");
		expect(out).toEqual({ definition: "A device that records events.", term: "" });
	});
});

// ── ADR-206: the term's equivalent is asked for, not waited for ──────────────

describe("cross-language surface forms (ADR-206)", () => {
	it("defineTerm asks for English and for the conversation's language", async () => {
		const p = makeProvider({ outputLanguage: "de" });
		await p.defineTerm("Kartellrecht", "Cartel law prohibits price-fixing.", conv("en"));
		expect(p.prompts[0]).toContain("established equivalent in English");
		await p.defineTerm("Kartellrecht", "Kartellrecht verbietet Preisabsprachen.", conv("it"));
		expect(p.prompts[1]).toContain("established equivalent in English and Italian");
	});

	it("under AUTO it still asks for English, and never waits for a bilingual passage", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.defineTerm("Kartellrecht", "Kartellrecht verbietet Preisabsprachen.", conv("auto"));
		expect(p.prompts[0]).toContain("established equivalent in English");
		// ADR-149's scope rule is what left "cartel law" unmarked; it must not return.
		expect(p.prompts[0]).not.toContain("Leave the line empty if the passage is monolingual");
		expect(p.prompts[0]).toContain("even when the passage is monolingual");
	});

	it("translateDefinition asks for the term and reads it back", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		p.reply = "TERM: cartel law\nDEFINITION:\nThe body of rules against price-fixing.";
		const out = await p.translateDefinition("Das Recht gegen Preisabsprachen.", "English", "Kartellrecht");
		expect(p.prompts[0]).toContain('equivalent of "Kartellrecht"');
		expect(out).toEqual({ definition: "The body of rules against price-fixing.", term: "cartel law" });
	});

	it("a person is translated without being asked for a name", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		p.reply = "A lawyer at the firm.";
		const out = await p.translateDefinition("Eine Anwältin der Kanzlei.", "English");
		expect(p.prompts[0]).not.toContain("TERM:");
		expect(out.term).toBe("");
	});
});

// ── ADR-183: warnings are about notes the USER attached ─────────────────────
describe("BaseProvider.resolveUserContent — auto-retrieved notes stay quiet", () => {
	beforeEach(() => { noticeMessages.length = 0; });

	/** Every note path is missing, which is the case that warns. */
	const appMissingEverything = { vault: { getAbstractFileByPath: () => null } } as unknown as App;
	const provider = () => new TestProvider(appMissingEverything, {} as PythiaSettings, "", "anthropic");
	const c = { contextNotes: [] } as unknown as Conversation;

	it("warns about a missing note the user attached", async () => {
		await provider().resolve(c, ["Manual/gone.md"], "hi");
		expect(noticeMessages.some((m) => m.startsWith("contextNotesWarning"))).toBe(true);
	});

	it("says NOTHING about a missing note that RAG retrieved", async () => {
		// The index can outlive a note. The user never chose it and cannot remove
		// it, so a warning is noise they can only learn to ignore.
		await provider().resolve(c, ["Auto/gone.md"], "hi", new Set(["Auto/gone.md"]));
		expect(noticeMessages.some((m) => m.startsWith("contextNotesWarning"))).toBe(false);
	});

	it("still warns when a manual note is missing alongside an auto one", async () => {
		await provider().resolve(c, ["Manual/gone.md", "Auto/gone.md"], "hi", new Set(["Auto/gone.md"]));
		expect(noticeMessages.filter((m) => m.startsWith("contextNotesWarning")).length).toBe(1);
	});
});

// ── ADR-184: the size warning is about what the user attached ───────────────
describe("BaseProvider.resolveUserContent — the token warning is manual-only", () => {
	beforeEach(() => { noticeMessages.length = 0; });

	const big = "word ".repeat(4000); // far past any sane maxAttachedNotesTokens
	// Must be the MOCKED TFile: buildAttachedNotesContent gates on `instanceof`.
	const asFile = (path: string) => Object.assign(new (TFileCls as new () => object)(), { path, extension: "md" });
	const appWith = (body: string) => ({
		vault: {
			getAbstractFileByPath: (p: string) => asFile(p),
			read: async () => body,
		},
	}) as unknown as App;

	const provider = (body: string) =>
		new TestProvider(appWith(body), { maxAttachedNotesTokens: 100 } as PythiaSettings, "", "anthropic");
	const c = { contextNotes: [] } as unknown as Conversation;
	const warned = () => noticeMessages.some((m) => m.startsWith("attachedNotesTokenWarning"));

	it("warns when the notes the user attached are large", async () => {
		await provider(big).resolve(c, ["Manual/big.md"], "hi");
		expect(warned()).toBe(true);
	});

	it("does NOT warn about size when every note was auto-retrieved", async () => {
		// ADR-183 said the attached-note warnings are manual-only, but only the
		// missing-note one was filtered — so a conversation with nothing attached
		// could be told its attached notes were large, every turn.
		await provider(big).resolve(c, ["Auto/big.md"], "hi", new Set(["Auto/big.md"]));
		expect(warned()).toBe(false);
	});

	it("still warns when a large MANUAL note sits beside auto ones", async () => {
		await provider(big).resolve(c, ["Manual/big.md", "Auto/big.md"], "hi", new Set(["Auto/big.md"]));
		expect(warned()).toBe(true);
	});
});

// ── ADR-208: the wrong sense, and the discussion that fixes it ──────────────

describe("term discussion and the sense hint (ADR-208)", () => {
	it("defineTerm carries the reader's correction, and says what to do when the passage disagrees", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.defineTerm("Zug", "Der Zug fuhr ein.", conv("de"), "nicht die Eisenbahn, der Schachzug");
		expect(p.prompts[0]).toContain("nicht die Eisenbahn, der Schachzug");
		expect(p.prompts[0]).toContain("never silently define something else");
	});

	it("says nothing about a sense when none was given", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.defineTerm("Zug", "Der Zug fuhr ein.", conv("de"));
		expect(p.prompts[0]).not.toContain("which sense they mean");
		await p.defineTerm("Zug", "Der Zug fuhr ein.", conv("de"), "   ");
		expect(p.prompts[1]).not.toContain("which sense they mean");
	});

	it("summarizes the discussion on the conversation's own model, not the fast one", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		const c = {
			model: "conversation-model",
			messages: [
				{ role: "user", content: "Gilt das auch für Einkaufsgemeinschaften?" },
				{ role: "assistant", content: "Nur oberhalb einer Marktanteilsschwelle." },
			],
		} as unknown as Conversation;
		await p.summarizeTermDiscussion("Kartellrecht", "Das Recht gegen Preisabsprachen.", c);
		expect(p.models[0]).toBe("conversation-model");
		expect(p.models[0]).not.toBe(p.fastModel);
		expect(p.prompts[0]).toContain("Einkaufsgemeinschaften");
		expect(p.prompts[0]).toContain("Das Recht gegen Preisabsprachen.");
	});

	it("tells the summarizer to keep the session and the tangents out of the note", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		await p.summarizeTermDiscussion("Kartellrecht", "Eine Definition.", { model: "m", messages: [] } as unknown as Conversation);
		expect(p.prompts[0]).toContain("Never narrate the session");
		expect(p.prompts[0]).toContain("reply with nothing at all");
		// It must not try to fix the definition — that field has its own repair.
		expect(p.prompts[0]).toContain("do not correct it here");
	});
});
