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
	protected callUtility(): Promise<string> { return Promise.resolve(""); }
	protected prepareStream(): Promise<void> { return Promise.resolve(); }
	protected runStreamRound(): Promise<RoundResult> {
		return Promise.resolve({ action: "done", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, hasUsage: false });
	}
	protected handleToolCalls(): Promise<void> { return Promise.resolve(); }

	/** `languageLabel` is protected; expose it so the resolution order is testable. */
	lang(conversation?: Conversation): string {
		return this.languageLabel(conversation);
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
