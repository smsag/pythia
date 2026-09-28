import { describe, it, expect } from "vitest";
import { declaresPythiaTemplate } from "../services/ToolHandler";

// A note the model writes must never become a prompt template: its body would be
// a system prompt and its context_notes rewrite targets in every later conversation.

describe("declaresPythiaTemplate — a tool never writes a template", () => {
	it("recognises the template frontmatter in its spellings", () => {
		for (const fm of [
			"type: Pythia Prompt Template",
			'type: "pythia prompt template"',
			"TYPE:   'Pythia  Prompt Template'",
			"type: >\n  Pythia Prompt\n  Template",
			'type: "Pythia\\x20Prompt\\x20Template"',
		]) {
			expect(declaresPythiaTemplate(`---\n${fm}\n---\nbody`), fm).toBe(true);
		}
	});

	it("leaves ordinary notes alone", () => {
		expect(declaresPythiaTemplate("---\ntags: [pythia]\n---\nA Pythia Prompt Template is…")).toBe(false);
		expect(declaresPythiaTemplate("No frontmatter at all")).toBe(false);
	});
});
