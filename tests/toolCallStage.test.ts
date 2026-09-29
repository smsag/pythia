// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness";
import { ToolCallController, type ToolCallDeps } from "../ui/ToolCallController";
import { Ablage, normalizeAblage, type AblageSlot } from "../services/ablage";
import type { Conversation, ToolCall } from "../models/types";

function controller() {
	let slot: AblageSlot | undefined;
	const ablage = new Ablage({ slot: () => slot, setSlot: (s) => { slot = s; }, persist: async () => {} });
	const deps: ToolCallDeps = {
		app: {} as ToolCallDeps["app"],
		plugin: { ablage } as unknown as ToolCallDeps["plugin"],
		messagesEl: () => document.createElement("div"),
		registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
		reveal: () => {},
	};
	const calls = new ToolCallController(deps);
	calls.begin(() => {});
	return { calls, ablage };
}

const stage: ToolCall = { id: "s", name: "stage_text", input: { content: "Held text" } };

describe("stage_text in the send path (ADR-246, review of #269)", () => {
	it("fills the Ablage, marked as the model's", async () => {
		const { calls, ablage } = controller();
		const conv = { id: "c", contextNotes: [], writeMode: "stage", messages: [] } as unknown as Conversation;
		expect(await calls.handler(conv, false)(stage)).toMatch(/^Placed in the Ablage/);
		expect(ablage.item).toMatchObject({ text: "Held text", byModel: true, conversationId: "c" });
	});

	it("a Stop that raced the call puts nothing in the Ablage", async () => {
		const { calls, ablage } = controller();
		const conv = { id: "c", contextNotes: [], writeMode: "stage", messages: [] } as unknown as Conversation;
		const stop = new AbortController();
		stop.abort();
		expect(await calls.handler(conv, false)(stage, stop.signal)).toMatch(/stopped/);
		expect(ablage.item).toBeUndefined();
	});

	it("is allowed by the write mode it was offered with, not the conversation's own", async () => {
		const { calls, ablage } = controller();
		// A conversation from a `create` template, with a `stage` template armed for this send.
		const conv = { id: "c", contextNotes: [], writeMode: "create", messages: [] } as unknown as Conversation;
		expect(await calls.handler(conv, false, null, "stage")(stage)).toMatch(/^Placed/);
		expect(ablage.item?.text).toBe("Held text");
		expect(await controller().calls.handler(conv, false)(stage)).toMatch(/not allowed/);
	});

	it("byModel survives data.json only as a literal true", () => {
		const at = "2026-09-29T10:00:00Z";
		expect(normalizeAblage({ updatedAt: at, item: { text: "a", createdAt: at, byModel: true } })?.item?.byModel).toBe(true);
		expect(normalizeAblage({ updatedAt: at, item: { text: "a", createdAt: at, byModel: "yes" } })?.item?.byModel).toBeUndefined();
	});
});
