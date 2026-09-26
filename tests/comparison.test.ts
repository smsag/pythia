import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "../models/types";
import {
	startComparison,
	comparisonPrompt,
	addCandidate,
	removeCandidate,
	keepCandidate,
	cancelComparison,
	canSwitchAlternative,
	switchAlternative,
	normalizeComparison,
	normalizeAlternatives,
	answerIds,
} from "../services/comparison";
import { parseConversations } from "../services/persistence";

const u = (id: string, content = "prompt"): Message => ({ id, role: "user", content, timestamp: "2026-09-16T10:00:00.000Z" });
const a = (id: string, content = "answer", model = "claude-sonnet-5"): Message =>
	({ id, role: "assistant", content, timestamp: "2026-09-16T10:00:05.000Z", model, tokenUsage: { inputTokens: 10, outputTokens: 20 } });

function conv(messages: Message[], over: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1", name: "Energy", createdAt: "", updatedAt: "", systemPrompt: "", contextNotes: [],
		resumeMode: "full", provider: "anthropic", model: "claude-sonnet-5", messages, ...over,
	};
}

describe("startComparison", () => {
	it("moves the last answer out of messages into candidate 0", () => {
		const c = conv([u("u1"), a("a1")]);
		const cmp = startComparison(c, "u1", "a1", () => "cmp1");
		expect(cmp?.id).toBe("cmp1");
		expect(c.messages.map((m) => m.id)).toEqual(["u1"]);
		expect(cmp?.candidates).toHaveLength(1);
		expect(cmp?.candidates[0]).toMatchObject({ id: "a1", model: "claude-sonnet-5", provider: "anthropic", content: "answer" });
		expect(comparisonPrompt(c)?.id).toBe("u1");
	});

	it("refuses when the pair is not the conversation's last exchange", () => {
		const c = conv([u("u1"), a("a1"), u("u2"), a("a2")]);
		expect(startComparison(c, "u1", "a1")).toBeNull();
		expect(c.messages).toHaveLength(4);
	});

	it("refuses a second comparison while one is pending", () => {
		const c = conv([u("u1"), a("a1")]);
		expect(startComparison(c, "u1", "a1")).not.toBeNull();
		expect(startComparison(c, "u1", "a1")).toBeNull();
	});

	it("falls back to the conversation model when the message carries none", () => {
		const msg = a("a1"); delete msg.model;
		const c = conv([u("u1"), msg], { model: "gpt-4o", provider: "openai" });
		expect(startComparison(c, "u1", "a1")?.candidates[0].model).toBe("gpt-4o");
	});
});

describe("keepCandidate", () => {
	function pending(): Conversation {
		const c = conv([u("u1")], { favorites: [{ id: "f1", messageId: "a1", name: "orig" }], merges: [{ id: "m1", conversationId: "x", messageId: "a1", text: "t", createdAt: "" }] });
		c.comparison = { id: "cmp", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "a1", provider: "anthropic", model: "claude-sonnet-5", content: "answer A", timestamp: "" },
		] };
		addCandidate(c, { id: "b1", provider: "openai", model: "gpt-4o", content: "answer B", timestamp: "", tokenUsage: { inputTokens: 1, outputTokens: 2 } });
		return c;
	}

	it("keeps the chosen answer as the assistant turn, with the others as tabs (ADR-219)", () => {
		const c = pending();
		const result = keepCandidate(c, "b1");
		expect(result?.kept).toMatchObject({ id: "b1", role: "assistant", content: "answer B", model: "gpt-4o" });
		expect(c.messages.map((m) => m.id)).toEqual(["u1", "b1"]);
		expect(c.comparison).toBeUndefined();
		expect(c.messages[1].alternatives?.map((x) => x.id)).toEqual(["a1"]);
		expect(c.messages[1].alternatives?.[0]).toMatchObject({ content: "answer A", model: "claude-sonnet-5" });
		expect(result).toEqual({ kept: c.messages[1] }); // no forks any more
	});

	it("leaves favorites and merge links on a non-kept answer on the conversation", () => {
		const c = pending();
		keepCandidate(c, "b1");
		expect(c.favorites?.map((f) => f.id)).toEqual(["f1"]);
		expect(c.merges?.map((m) => m.id)).toEqual(["m1"]);
	});

	it("adds no alternatives when there was only one answer", () => {
		const c = conv([u("u1"), a("a1")]);
		startComparison(c, "u1", "a1");
		keepCandidate(c, "a1");
		expect("alternatives" in c.messages[1]).toBe(false);
	});

	it("keeps favorites on the kept answer where they are", () => {
		const c = pending();
		keepCandidate(c, "a1");
		expect(c.favorites?.map((f) => f.id)).toEqual(["f1"]);
		expect(c.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
	});

	it("returns null for an unknown candidate and changes nothing", () => {
		const c = pending();
		expect(keepCandidate(c, "nope")).toBeNull();
		expect(c.comparison?.candidates).toHaveLength(2);
	});
});

describe("removeCandidate / cancelComparison", () => {
	it("never removes candidate 0", () => {
		const c = conv([u("u1"), a("a1")]);
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "b1", provider: "openai", model: "gpt-4o", content: "", timestamp: "" });
		removeCandidate(c, "a1");
		removeCandidate(c, "b1");
		expect(c.comparison?.candidates.map((x) => x.id)).toEqual(["a1"]);
	});

	it("cancel restores the original answer verbatim", () => {
		const original = a("a1");
		const c = conv([u("u1"), original]);
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "b1", provider: "openai", model: "gpt-4o", content: "B", timestamp: "" });
		expect(cancelComparison(c)).toBe(true);
		expect(c.comparison).toBeUndefined();
		expect(c.messages[1]).toEqual(original);
		expect(cancelComparison(c)).toBe(false);
	});
});

describe("switchAlternative — which tab the conversation holds (ADR-219)", () => {
	function kept(): Conversation {
		const c = conv([u("u1")]);
		c.comparison = { id: "cmp", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "a1", provider: "anthropic", model: "claude-sonnet-5", content: "answer A", timestamp: "" },
			{ id: "b1", provider: "openai", model: "gpt-4o", content: "answer B", timestamp: "" },
			{ id: "c1x", provider: "mistral", model: "mistral-large-latest", content: "answer C", timestamp: "" },
		] };
		keepCandidate(c, "a1");
		return c;
	}

	it("swaps the kept answer with a tab, each keeping its own id, and keeps the tab order", () => {
		const c = kept();
		expect(switchAlternative(c, "a1", "c1x")).toBe(true);
		const last = c.messages[1];
		expect(last).toMatchObject({ id: "c1x", content: "answer C", model: "mistral-large-latest" });
		expect(last.alternatives?.map((x) => x.id)).toEqual(["b1", "a1"]);
		expect(last.alternatives?.[1]).toMatchObject({ content: "answer A", provider: "anthropic" });
	});

	it("is refused once the answer is no longer the last message", () => {
		const c = kept();
		c.messages.push(u("u2"), a("a2"));
		expect(canSwitchAlternative(c, "a1")).toBe(false);
		expect(switchAlternative(c, "a1", "b1")).toBe(false);
		expect(c.messages[1].id).toBe("a1");
	});

	it("is refused for an unknown tab, a pending comparison, or an answer without tabs", () => {
		const c = kept();
		expect(switchAlternative(c, "a1", "nope")).toBe(false);
		const plain = conv([u("u1"), a("a1")]);
		expect(canSwitchAlternative(plain, "a1")).toBe(false);
		const pendingNow = kept();
		pendingNow.comparison = { id: "x", userMessageId: "u1", createdAt: "", candidates: [] };
		expect(canSwitchAlternative(pendingNow, "a1")).toBe(false);
	});
});

describe("a comparison keeps what the original answer carried", () => {
	it("round-trips its cost snapshot and note-write chip through start → keep and start → cancel", () => {
		const original: Message = { ...a("a1"), cost: { usd: 0.01, asOf: "2026-09-16" }, noteWrites: [{ path: "Out/X.md", action: "created" }] };
		for (const finish of ["keep", "cancel"] as const) {
			const c = conv([u("u1"), { ...original }]);
			startComparison(c, "u1", "a1");
			if (finish === "keep") keepCandidate(c, "a1"); else cancelComparison(c);
			expect(c.messages[1]).toMatchObject({ cost: original.cost, noteWrites: original.noteWrites });
		}
	});
});

describe("normalizeComparison (load-time guard)", () => {
	it("drops empty candidates left by a run the app closed on", () => {
		const c = conv([u("u1")]);
		c.comparison = { id: "x", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "a1", provider: "anthropic", model: "m", content: "ok", timestamp: "" },
			{ id: "b1", provider: "openai", model: "m2", content: "", timestamp: "" },
		] };
		normalizeComparison(c);
		expect(c.comparison?.candidates.map((x) => x.id)).toEqual(["a1"]);
	});

	it("restores the original answer when the comparison cannot be resumed", () => {
		const c = conv([u("u1")]);
		c.comparison = { id: "x", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "a1", provider: "anthropic", model: "m", content: "ok", timestamp: "" },
			{ id: "b1", provider: "openai", model: "m2", content: "", timestamp: "" },
		] };
		// Prompt no longer last → cannot resume.
		c.messages.push(a("a9"));
		normalizeComparison(c);
		expect(c.comparison).toBeUndefined();
	});

	it("drops a malformed comparison and puts candidate 0 back when the prompt is last", () => {
		const c = conv([u("u1")]);
		c.comparison = { id: "x", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "b1", provider: "openai", model: "m2", content: "", timestamp: "" },
		] };
		normalizeComparison(c);
		expect(c.comparison).toBeUndefined();
		expect(c.messages).toHaveLength(1);

		const d = conv([u("u1")]);
		(d as unknown as { comparison: unknown }).comparison = "garbage";
		normalizeComparison(d);
		expect(d.comparison).toBeUndefined();
	});

	it("runs as part of parseConversations", () => {
		const { conversations } = parseConversations([
			{ id: "c", messages: [{ id: "u1", role: "user", content: "p" }], comparison: { userMessageId: "u1", candidates: [{ id: "a1", model: "m", content: "x" }] } },
		]);
		expect(conversations[0].comparison?.candidates[0].id).toBe("a1");
		expect(typeof conversations[0].comparison?.id).toBe("string");
	});
});


describe("a second comparison on an answer that already has tabs (ADR-219)", () => {
	function withTabs(): Conversation {
		const c = conv([u("u1")]);
		c.comparison = { id: "cmp", userMessageId: "u1", createdAt: "", candidates: [
			{ id: "a1", provider: "anthropic", model: "claude-sonnet-5", content: "A", timestamp: "" },
			{ id: "b1", provider: "openai", model: "gpt-4o", content: "B", timestamp: "" },
		] };
		keepCandidate(c, "a1");
		return c;
	}

	it("brings the earlier tabs back as candidates", () => {
		const c = withTabs();
		startComparison(c, "u1", "a1");
		expect(c.comparison?.candidates.map((x) => x.id)).toEqual(["a1", "b1"]);
	});

	it("keeping afterwards keeps every answer as a tab", () => {
		const c = withTabs();
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "c1", provider: "mistral", model: "mistral-large-latest", content: "C", timestamp: "" });
		keepCandidate(c, "c1");
		expect(c.messages[1].alternatives?.map((x) => x.id)).toEqual(["a1", "b1"]);
	});

	it("discard puts the answer back with its earlier tabs, not the runs it added", () => {
		const c = withTabs();
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "c1", provider: "mistral", model: "mistral-large-latest", content: "C", timestamp: "" });
		cancelComparison(c);
		expect(c.messages[1].id).toBe("a1");
		expect(c.messages[1].alternatives?.map((x) => x.id)).toEqual(["b1"]);
	});
});

describe("a tab keeps what makes its cards (ADR-225)", () => {
	const target = { path: "Notes/X.md", from: { line: 1, ch: 0 }, to: { line: 1, ch: 4 }, text: "old" };

	it("a switch keeps the Continue card of a cut-off answer and a rewrite proposal's target, both ways", () => {
		const c = conv([u("u1"), { ...a("a1", "cut"), truncated: true, rewriteTarget: target }]);
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "b1", provider: "openai", model: "gpt-4o", content: "B", timestamp: "" });
		keepCandidate(c, "b1");
		expect(c.messages[1].alternatives?.[0]).toMatchObject({ id: "a1", truncated: true, rewriteTarget: target });
		expect(switchAlternative(c, "b1", "a1")).toBe(true);
		expect(c.messages[1]).toMatchObject({ id: "a1", truncated: true, rewriteTarget: target });
		expect(c.messages[1].alternatives?.[0].truncated).toBeUndefined();
	});

	it("answerIds names the answer and every tab", () => {
		const c = conv([u("u1"), a("a1")]);
		startComparison(c, "u1", "a1");
		addCandidate(c, { id: "b1", provider: "openai", model: "gpt-4o", content: "B", timestamp: "" });
		keepCandidate(c, "a1");
		expect(answerIds(c.messages[1])).toEqual(["a1", "b1"]);
		expect(answerIds(a("x"))).toEqual(["x"]);
	});

	it("load drops a malformed flag, target or token count on a tab, keeping the tab", () => {
		const tabs = normalizeAlternatives([
			{ id: "b1", model: "m", content: "B", timestamp: "", truncated: "yes", rewriteTarget: { path: "X.md" }, tokenUsage: { inputTokens: "10" } },
			{ id: "c1", model: "m", content: "C", timestamp: "", truncated: true, rewriteTarget: target, tokenUsage: { inputTokens: 1, outputTokens: 2 } },
		]);
		expect(tabs?.[0]).not.toHaveProperty("truncated");
		expect(tabs?.[0]).not.toHaveProperty("rewriteTarget");
		expect(tabs?.[0]).not.toHaveProperty("tokenUsage");
		expect(tabs?.[1]).toMatchObject({ truncated: true, rewriteTarget: target, tokenUsage: { inputTokens: 1, outputTokens: 2 } });
	});
});

