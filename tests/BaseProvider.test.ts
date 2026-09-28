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
import { APIUserAbortError } from "@anthropic-ai/sdk/core/error";
import type { ToolCallHandler } from "../services/LLMProvider";

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
	/** The max-output budget each utility call asked for (ADR-208 review). */
	budgets: number[] = [];
	protected callUtility(model: string, userMessage: string, maxTokens: number): Promise<string> {
		this.models.push(model);
		this.prompts.push(userMessage);
		this.budgets.push(maxTokens);
		return Promise.resolve(this.reply);
	}
	protected prepareStream(): Promise<void> { return Promise.resolve(); }
	protected runStreamRound(_signal: AbortSignal, _onToken: (text: string) => void): Promise<RoundResult> {
		return Promise.resolve({ action: "done", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, hasUsage: false, truncated: false });
	}
	protected handleToolCalls(_onToolCall: ToolCallHandler, _signal: AbortSignal): Promise<void> { return Promise.resolve(); }

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
		signal?: AbortSignal,
		tokenUsage?: TokenUsage,
	): void {
		this.finishOrError(error, fullText, onComplete, onError, signal, tokenUsage, tokenUsage ? { truncated: false } : undefined);
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
		expect(onComplete).toHaveBeenCalledWith("partial answer", undefined, undefined);
		expect(onError).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
	});

	it("treats the SDK's real APIUserAbortError (name \"Error\") as a stop, not a failure", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		p.finish(new APIUserAbortError(), "partial", onComplete, onError);
		expect(onComplete).toHaveBeenCalledWith("partial", undefined, undefined);
		expect(onError).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
	});

	it("treats any error as a stop once the send's signal fired, even with nothing streamed", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		const stop = new AbortController();
		stop.abort();
		p.finish(new Error("Connection error."), "", onComplete, onError, stop.signal);
		expect(onComplete).toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
	});

	it("passes the usage of the completed rounds through a stop and a kept partial", () => {
		const p = makeProvider();
		const usage = { inputTokens: 10, outputTokens: 5 };
		const onComplete = vi.fn();
		p.finish(new APIUserAbortError(), "partial", onComplete, vi.fn(), undefined, usage);
		p.finish(new Error("Overloaded"), "partial", onComplete, vi.fn(), undefined, usage);
		expect(onComplete).toHaveBeenNthCalledWith(1, "partial", usage, { truncated: false });
		expect(onComplete).toHaveBeenNthCalledWith(2, "partial", usage, { truncated: false });
	});

	it("keeps the streamed partial and shows a non-destructive Notice on a genuine post-stream error", () => {
		const p = makeProvider();
		const onComplete = vi.fn();
		const onError = vi.fn();
		p.finish(new Error("Overloaded"), "streamed so far", onComplete, onError);
		// The visible reply is preserved as the assistant turn...
		expect(onComplete).toHaveBeenCalledWith("streamed so far", undefined, undefined);
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

// ── Review of ADR-208: the budget and which end of a long discussion is kept ──

describe("term discussion — budget and truncation (ADR-208 review)", () => {
	const longConv = (turns: number): Conversation => ({
		model: "m",
		messages: Array.from({ length: turns }, (_, i) => ({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `turn ${i} ${"x".repeat(400)}`,
		})),
	} as unknown as Conversation);

	it("keeps the END of a discussion that does not fit — understanding is where it lands", async () => {
		const p = makeProvider({ outputLanguage: "auto" });
		const c = longConv(120);
		await p.summarizeTermDiscussion("Kartellrecht", "Eine Definition.", c);
		expect(p.prompts[0]).toContain("turn 119");
		expect(p.prompts[0]).not.toContain("turn 0 ");
	});

	it("is not given a smaller budget than the shorter summary it is modelled on", async () => {
		// Lowering a cap truncates rather than shortens, and on a reasoning model
		// the same budget pays for hidden reasoning (ADR-141).
		const p = makeProvider({ outputLanguage: "auto" });
		await p.summarizeTermDiscussion("X", "d", longConv(2));
		expect(p.budgets[0]).toBeGreaterThanOrEqual(1024);
	});
});

// ── Stop during a tool call (a pending confirmation chip) ─────────────────────

/** Streams one tool-calling round with usage, then "answers" the tool through
 *  the handler the way a provider does: check the signal, pass it on. */
class ToolRoundProvider extends TestProvider {
	rounds = 0;
	protected override runStreamRound(_signal: AbortSignal, onToken: (text: string) => void): Promise<RoundResult> {
		this.rounds++;
		onToken("Let me write that. ");
		return Promise.resolve({ action: "tool_use", inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, hasUsage: true, truncated: false });
	}
	protected override async handleToolCalls(onToolCall: ToolCallHandler, signal: AbortSignal): Promise<void> {
		for (const id of ["a", "b"]) {
			this.throwIfStopped(signal);
			await onToolCall({ id, name: "create_note", input: {} }, signal);
		}
	}
	protected override resolveUserContent(): Promise<{ userContent: string; systemPrompt: string; pdfAttachments: [] }> {
		return Promise.resolve({ userContent: "hi", systemPrompt: "", pdfAttachments: [] });
	}
}

describe("BaseProvider — Stop while a tool call waits", () => {
	beforeEach(() => { noticeMessages.length = 0; });

	it("runs no further tool or round, keeps the partial with its usage, and raises no error", async () => {
		const p = new ToolRoundProvider({} as App, {} as PythiaSettings, "", "anthropic");
		const seen: string[] = [];
		const onComplete = vi.fn();
		const onError = vi.fn();
		await p.streamMessage({ model: "m" } as Conversation, "hi", [], () => {}, onComplete, onError, async (call, signal) => {
			seen.push(call.id);
			expect(signal).toBeDefined();
			p.abort(); // the user presses Stop while the chip is showing
			return "User declined.";
		});
		expect(seen).toEqual(["a"]); // the second call never ran
		expect(p.rounds).toBe(1); // and no round followed
		expect(onError).not.toHaveBeenCalled();
		expect(noticeMessages).toHaveLength(0);
		expect(onComplete).toHaveBeenCalledWith("Let me write that. ", { inputTokens: 100, outputTokens: 20 }, { truncated: false });
	});
});
