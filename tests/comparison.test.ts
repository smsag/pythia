import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "../models/types";
import {
	startComparison,
	comparisonPrompt,
	addCandidate,
	removeCandidate,
	keepCandidate,
	cancelComparison,
	forkNameFor,
	normalizeComparison,
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

	it("keeps the chosen answer as the assistant turn and forks the other", () => {
		const c = pending();
		const result = keepCandidate(c, "b1");
		expect(result?.kept).toMatchObject({ id: "b1", role: "assistant", content: "answer B", model: "gpt-4o" });
		expect(c.messages.map((m) => m.id)).toEqual(["u1", "b1"]);
		expect(c.comparison).toBeUndefined();
		expect(result?.forks).toHaveLength(1);
		const fork = result!.forks[0];
		expect(fork.name).toBe("Energy · Sonnet 5");
		expect(fork.model).toBe("claude-sonnet-5");
		expect(fork.provider).toBe("anthropic");
		expect(fork.forkedFromMessageId).toBe("b1");
		expect(fork.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
	});

	it("moves favorites and merge links on a forked answer to its fork", () => {
		const c = pending();
		const result = keepCandidate(c, "b1");
		expect(c.favorites).toBeUndefined();
		expect(c.merges).toBeUndefined();
		expect(result!.forks[0].favorites?.map((f) => f.id)).toEqual(["f1"]);
		expect(result!.forks[0].merges?.map((m) => m.id)).toEqual(["m1"]);
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

describe("forkNameFor", () => {
	it("names the fork after the conversation and the model", () => {
		expect(forkNameFor("Energy", "gpt-4o")).toBe("Energy · GPT-4o");
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
