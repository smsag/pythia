import { describe, it, expect } from "vitest";
import { getToolDefinitions, STAGE_TEXT_TOOL, STAGE_TEXT_UNPLACED, ToolHandler } from "../services/ToolHandler";
import type { NoteWriter } from "../services/NoteWriter";

// stage_text fills the Ablage and writes no note (ADR-246).
describe("stage_text", () => {
	it("is the only write tool of write mode 'stage'", () => {
		const names = getToolDefinitions("Scratch", "stage").map((d) => d.name);
		expect(names).toContain("stage_text");
		expect(names).not.toContain("create_note");
		// render_chart writes nothing and is always offered (ADR-210).
		expect([...ToolHandler.allowedToolNames("stage")].filter((n) => n !== "render_chart")).toEqual(["stage_text"]);
	});

	it("is not offered with write mode 'none' (a comparison run)", () => {
		expect(getToolDefinitions("Scratch", "none").map((d) => d.name)).not.toContain("stage_text");
	});

	it("takes the text only — there is no path", () => {
		expect((STAGE_TEXT_TOOL.inputSchema as { required: string[] }).required).toEqual(["content"]);
	});

	it("is never reported as done by the handler, which cannot reach the Ablage", async () => {
		const handler = new ToolHandler({} as NoteWriter);
		const call = { id: "1", name: "stage_text", input: { content: "x" } };
		expect(await handler.execute(call, ToolHandler.allowedToolNames("stage"))).toBe(STAGE_TEXT_UNPLACED);
		expect(await handler.execute(call, ToolHandler.allowedToolNames("create"))).toMatch(/not allowed/);
	});
});
