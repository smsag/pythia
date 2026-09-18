import { describe, it, expect } from "vitest";
import { applyPendingTemplate, armPendingTemplate } from "../services/pendingTemplate";
import type { Conversation, PythiaTemplate } from "../models/types";

// ADR-177: applying a template to a running conversation is a one-shot. It
// shapes the next answer and is then gone — nothing is written onto the
// conversation, which is what the old apply path did to nine fields at once.

const tpl = (over: Partial<PythiaTemplate> = {}): PythiaTemplate => ({
	id: "Pythia/Templates/Term Note.md",
	name: "Term Note",
	systemPrompt: "You write glossary term notes.",
	contextNotes: [],
	...over,
});

const conv = (over: Partial<Conversation> = {}): Conversation => ({
	id: "c1",
	name: "Chat",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "You are a helpful assistant.",
	contextNotes: ["Notes/Mine.md"],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-5",
	messages: [],
	favorites: [],
	...over,
});

describe("armPendingTemplate", () => {
	it("snapshots what the template contributes, so a later edit cannot change the turn", () => {
		const source = tpl({ model: "claude-haiku-4-5", maxTokens: 2000, contextNotes: ["A.md"] });
		const armed = armPendingTemplate(source);

		expect(armed).toMatchObject({ id: source.id, name: "Term Note", model: "claude-haiku-4-5", maxTokens: 2000 });
		// A copy, not a reference into the template's own array.
		source.contextNotes.push("B.md");
		expect(armed.contextNotes).toEqual(["A.md"]);
	});

	it("leaves out what the template does not set", () => {
		const armed = armPendingTemplate(tpl());
		expect(armed.model).toBeUndefined();
		expect(armed.effort).toBeUndefined();
		expect(armed.contextNotes).toBeUndefined();
	});
});

describe("applyPendingTemplate", () => {
	it("returns the conversation itself when nothing is armed", () => {
		const c = conv();
		expect(applyPendingTemplate(c)).toBe(c);
	});

	it("layers the template over a clone and never mutates the conversation", () => {
		const c = conv({ pendingTemplate: armPendingTemplate(tpl({ model: "claude-haiku-4-5", maxTokens: 2000 })) });
		const turn = applyPendingTemplate(c);

		expect(turn.systemPrompt).toBe("You write glossary term notes.");
		expect(turn.model).toBe("claude-haiku-4-5");
		expect(turn.maxTokens).toBe(2000);
		// The conversation is untouched — this is the whole point of ADR-177.
		expect(c.systemPrompt).toBe("You are a helpful assistant.");
		expect(c.model).toBe("claude-sonnet-5");
		expect(c.maxTokens).toBeUndefined();
	});

	it("keeps the conversation's own value for anything the template does not set", () => {
		const c = conv({ effort: "high", temperature: 0.2, pendingTemplate: armPendingTemplate(tpl()) });
		const turn = applyPendingTemplate(c);

		expect(turn.effort).toBe("high");
		expect(turn.temperature).toBe(0.2);
		expect(turn.model).toBe("claude-sonnet-5");
		expect(turn.provider).toBe("anthropic");
	});

	it("attributes the answer to the template that shaped it", () => {
		const c = conv({ templateId: "Pythia/Templates/Other.md", pendingTemplate: armPendingTemplate(tpl()) });
		expect(applyPendingTemplate(c).templateId).toBe("Pythia/Templates/Term Note.md");
	});

	it("unions the notes, the user's own first, without duplicates", () => {
		const c = conv({
			contextNotes: ["Notes/Mine.md", "Shared.md"],
			pendingTemplate: armPendingTemplate(tpl({ contextNotes: ["Shared.md", "Tpl.md"] })),
		});
		const turn = applyPendingTemplate(c);

		expect(turn.contextNotes).toEqual(["Notes/Mine.md", "Shared.md", "Tpl.md"]);
		expect(c.contextNotes).toEqual(["Notes/Mine.md", "Shared.md"]);
	});

	it("shares the message array — the provider reads it, and the turn must see new turns", () => {
		const c = conv({ pendingTemplate: armPendingTemplate(tpl()) });
		const turn = applyPendingTemplate(c);
		expect(turn.messages).toBe(c.messages);
	});
});
