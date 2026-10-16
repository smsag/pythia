import { describe, it, expect, vi, afterEach } from "vitest";

// The palette's conversation search (Browse / Resume conversations) asks
// Schreibstube by meaning after a pause in typing, like the panel. Its question
// ends with the next query and with the modal (ADR-257 addendum): a tap that
// closes the modal inside the pause must not ask Schreibstube while the
// conversation opens.

vi.mock("obsidian", () => {
	class SuggestModal {
		constructor(public app: unknown) {}
		setPlaceholder(): void {}
		setInstructions(): void {}
		onClose(): void {}
	}
	return { SuggestModal, FuzzySuggestModal: SuggestModal, setIcon: () => {}, App: class {} };
});

import type { App } from "obsidian";
import type { Conversation } from "../models/types";
import { ConversationSuggestModal } from "../suggest/ConversationSuggest";
import { MEANING_DEBOUNCE_MS } from "../services/conversationFinder";

const conv = (id: string, name: string): Conversation =>
	({ id, name, messages: [], updatedAt: "2026-10-16T10:00:00Z" }) as unknown as Conversation;

afterEach(() => { vi.useRealTimers(); });

function modalWith(ask: (text: string, limit: number, signal?: AbortSignal) => Promise<string[]> | null) {
	return new ConversationSuggestModal(
		{} as App,
		[conv("a", "Küchenplanung"), conv("b", "Tax filing")],
		() => {},
		undefined,
		ask
	);
}

describe("ConversationSuggestModal: search by meaning (ADR-257)", () => {
	it("asks nothing once the modal closed inside the pause", async () => {
		vi.useFakeTimers();
		const ask = vi.fn(() => Promise.resolve<string[]>([]));
		const modal = modalWith(ask);
		void modal.getSuggestions("tax filing");
		modal.onClose();
		await vi.advanceTimersByTimeAsync(MEANING_DEBOUNCE_MS + 10);

		expect(ask).not.toHaveBeenCalled();
	});

	it("drops its question when the modal closes", async () => {
		vi.useFakeTimers();
		const signals: AbortSignal[] = [];
		const modal = modalWith((_t, _l, signal) => { signals.push(signal!); return new Promise(() => {}); });
		void modal.getSuggestions("tax filing");
		await vi.advanceTimersByTimeAsync(MEANING_DEBOUNCE_MS + 10);
		modal.onClose();

		expect(signals.map((s) => s.aborted)).toEqual([true]);
	});

	it("drops the question for an older query, and asks only after the last pause", async () => {
		vi.useFakeTimers();
		const asked: { text: string; signal: AbortSignal }[] = [];
		const modal = modalWith((text, _l, signal) => { asked.push({ text, signal: signal! }); return new Promise(() => {}); });
		void modal.getSuggestions("kü");
		void modal.getSuggestions("küche");
		await vi.advanceTimersByTimeAsync(MEANING_DEBOUNCE_MS + 10);
		void modal.getSuggestions("küchenplan");
		await vi.advanceTimersByTimeAsync(MEANING_DEBOUNCE_MS + 10);

		expect(asked.map((q) => q.text)).toEqual(["küche", "küchenplan"]);
		expect(asked.map((q) => q.signal.aborted)).toEqual([true, false]);
	});

	it("shows what meaning found below the titles", async () => {
		vi.useFakeTimers();
		const modal = modalWith(() => Promise.resolve(["a"]));
		const result = modal.getSuggestions("tax filing");
		await vi.advanceTimersByTimeAsync(MEANING_DEBOUNCE_MS + 10);

		expect((await result).map((c) => c.id)).toEqual(["b", "a"]);
	});
});
