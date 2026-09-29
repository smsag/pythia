import { describe, it, expect } from "vitest";
import { compactMermaid, COMPACT_MERMAID_INIT } from "../ui/mermaidSpacing";

describe("compactMermaid (ADR-245)", () => {
	it("adds the compact spacing as the first line of a mermaid block", () => {
		const md = "Text\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
		expect(compactMermaid(md)).toBe(`Text\n\n\`\`\`mermaid\n${COMPACT_MERMAID_INIT}\nflowchart TD\n  A --> B\n\`\`\`\n`);
	});

	it("leaves a block that configures itself alone", () => {
		const init = "```mermaid\n%%{init: {\"theme\": \"dark\"}}%%\nflowchart TD\n```";
		const front = "```mermaid\n---\nconfig:\n  look: handDrawn\n---\nflowchart TD\n```";
		expect(compactMermaid(init)).toBe(init);
		expect(compactMermaid(front)).toBe(front);
	});

	it("touches no other fence, and a tilde fence too", () => {
		const md = "```js\nconst mermaid = 1;\n```\n~~~mermaid\nsequenceDiagram\n~~~";
		const out = compactMermaid(md);
		expect(out.startsWith("```js\nconst mermaid = 1;\n```")).toBe(true);
		expect(out).toContain(`~~~mermaid\n${COMPACT_MERMAID_INIT}\nsequenceDiagram`);
	});

	it("returns markdown without a mermaid block unchanged", () => {
		const md = "No diagrams here.";
		expect(compactMermaid(md)).toBe(md);
	});
});
