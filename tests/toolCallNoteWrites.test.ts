// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { ToolCallController, type ToolCallDeps } from "../ui/ToolCallController";
import { noteWriteResult } from "../services/noteWrites";
import type { Conversation, ToolCall } from "../models/types";

function controller(result: string) {
	const messages = document.createElement("div");
	const deps: ToolCallDeps = {
		app: {} as ToolCallDeps["app"],
		plugin: { toolHandler: { execute: async () => result } } as unknown as ToolCallDeps["plugin"],
		messagesEl: () => messages,
		registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
		reveal: () => {},
	};
	return { calls: new ToolCallController(deps), messages };
}

const conv = { contextNotes: [], writeMode: "all", messages: [] } as unknown as Conversation;
const create: ToolCall = { id: "t", name: "create_note", input: { path: "Out/Plan.md", content: "x" } };

describe("ToolCallController — a confirmed write is recorded for the message (ADR-218)", () => {
	it("records the path the vault reported and draws the done chip", async () => {
		const { calls, messages } = controller(noteWriteResult("created", "Out/Plan 2.md"));
		calls.begin(() => {});
		const pending = calls.handler(conv, false)(create);
		await Promise.resolve();
		messages.querySelector<HTMLButtonElement>(".pythia-tool-call-btn--action")!.click();
		await pending;
		expect(calls.takeNoteWrites()).toEqual({ noteWrites: [{ path: "Out/Plan 2.md", action: "created" }] });
		expect(messages.querySelector(".pythia-tool-call--done .pythia-tool-call-link")?.textContent).toBe("✓ Created [[Plan 2]]");
	});

	it("records nothing for a declined write, and a new send starts empty", async () => {
		const { calls, messages } = controller(noteWriteResult("created", "Out/Plan.md"));
		calls.begin(() => {});
		const pending = calls.handler(conv, false)(create);
		await Promise.resolve();
		messages.querySelectorAll<HTMLButtonElement>("button")[1].click(); // cancel
		await pending;
		expect(calls.takeNoteWrites()).toEqual({});
	});
});
