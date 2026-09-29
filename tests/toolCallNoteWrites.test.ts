// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { ToolCallController, type ToolCallDeps } from "../ui/ToolCallController";
import { noteWriteResult } from "../services/noteWrites";
import type { Conversation, ToolCall } from "../models/types";

function controller(result: string) {
	const messages = document.createElement("div");
	const recorded: string[] = [];
	const deps: ToolCallDeps = {
		app: {} as ToolCallDeps["app"],
		plugin: {
			app: { vault: { getName: () => "V" } },
			toolHandler: { execute: async () => result },
			noteAnchors: { fallbackLanguage: () => "en", recordFromPath: async (p: string) => { recorded.push(p); } },
		} as unknown as ToolCallDeps["plugin"],
		messagesEl: () => messages,
		registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
		reveal: () => {},
	};
	return { calls: new ToolCallController(deps), messages, recorded };
}

const conv = { contextNotes: [], writeMode: "all", messages: [] } as unknown as Conversation;
const create: ToolCall = { id: "t", name: "create_note", input: { path: "Out/Plan.md", content: "x" } };

describe("ToolCallController — a confirmed write is recorded for the message (ADR-218)", () => {
	it("records the path the vault reported and draws the done chip", async () => {
		const { calls, messages, recorded } = controller(noteWriteResult("created", "Out/Plan 2.md"));
		calls.begin(() => {});
		const pending = calls.handler(conv, false)(create);
		await Promise.resolve();
		messages.querySelector<HTMLButtonElement>(".pythia-tool-call-btn--action")!.click();
		await pending;
		expect(calls.takeNoteWrites()).toEqual({ noteWrites: [{ path: "Out/Plan 2.md", action: "created" }] });
		expect(messages.querySelector(".pythia-tool-call--done .pythia-tool-call-link")?.textContent).toBe("✓ Created Plan 2");
		// Its links to answers are recorded at once, from the path the vault used (ADR-250).
		expect(recorded).toEqual(["Out/Plan 2.md"]);
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

describe("ToolCallController — a turn that only wrote a note keeps its record (ADR-218 addendum)", () => {
	async function wrote(calls: ToolCallController, messages: HTMLElement): Promise<void> {
		calls.begin(() => {});
		const pending = calls.handler(conv, false)(create);
		await Promise.resolve();
		messages.querySelector<HTMLButtonElement>(".pythia-tool-call-btn--action")!.click();
		await pending;
	}

	it("gives an empty answer text that names the note, without draining the record", async () => {
		const { calls, messages } = controller(noteWriteResult("created", "Out/Plan.md"));
		await wrote(calls, messages);
		expect(calls.writesOnlyContent()).toBe("Wrote [[Out/Plan|Plan]].");
		expect(calls.takeNoteWrites()).toEqual({ noteWrites: [{ path: "Out/Plan.md", action: "created" }] });
	});

	it("builds the turn to keep when the stream fails after the write, and drains", async () => {
		const { calls, messages } = controller(noteWriteResult("created", "Out/Plan.md"));
		await wrote(calls, messages);
		const msg = calls.writesOnlyMessage("m1");
		expect(msg).toMatchObject({ role: "assistant", content: "Wrote [[Out/Plan|Plan]].", model: "m1", noteWrites: [{ path: "Out/Plan.md" }] });
		expect(calls.writesOnlyMessage("m1")).toBeNull();
	});

	it("keeps nothing when nothing was written", () => {
		const { calls } = controller("");
		calls.begin(() => {});
		expect(calls.writesOnlyContent()).toBe("");
		expect(calls.writesOnlyMessage("m1")).toBeNull();
	});
});

describe("ToolCallController — Stop while the confirm chip waits never writes", () => {
	function counting() {
		const messages = document.createElement("div");
		let executed = 0;
		const deps: ToolCallDeps = {
			app: {} as ToolCallDeps["app"],
			plugin: { toolHandler: { execute: async () => { executed++; return noteWriteResult("created", "Out/Plan.md"); } } } as unknown as ToolCallDeps["plugin"],
			messagesEl: () => messages,
			registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
			reveal: () => {},
		};
		return { calls: new ToolCallController(deps), messages, executed: () => executed };
	}

	it("settles as declined on abort, and a late click on the button does nothing", async () => {
		const { calls, messages, executed } = counting();
		const stop = new AbortController();
		calls.begin(() => {});
		const pending = calls.handler(conv, false)(create, stop.signal);
		await Promise.resolve();
		const action = messages.querySelector<HTMLButtonElement>(".pythia-tool-call-btn--action")!;
		stop.abort();
		action.click();
		await pending;
		expect(executed()).toBe(0);
		expect(calls.takeNoteWrites()).toEqual({});
		expect(messages.querySelector(".pythia-tool-call--cancelled")).not.toBeNull();
	});

	it("never shows the confirm for a send that is already stopped", async () => {
		const { calls, executed } = counting();
		const stop = new AbortController();
		stop.abort();
		calls.begin(() => {});
		await calls.handler(conv, false)(create, stop.signal);
		expect(executed()).toBe(0);
	});
});
