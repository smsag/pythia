import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	Notice: class {},
	Modal: class {},
	parseYaml: () => ({}),
}));
vi.mock("../i18n", () => ({ t: (key: string) => key }));
vi.mock("../suggest/PromptInputModal", () => ({ PromptInputModal: class {} }));

import { fillPromptPlaceholder } from "../services/PromptOptimizerService";

describe("fillPromptPlaceholder", () => {
	it("puts the prompt in place of every {{prompt}}", () => {
		expect(fillPromptPlaceholder("A {{prompt}} B {{prompt}}", "x")).toBe("A x B x");
	});

	it("returns the prompt alone when the template has no placeholder", () => {
		expect(fillPromptPlaceholder("no placeholder here", "raw")).toBe("raw");
	});

	it("inserts $-patterns literally instead of expanding them", () => {
		// A string replacer turned `$&` into "{{prompt}}" and `$$` into "$".
		const prompt = "match $& and $1, cost $$5, before $` after $'";
		expect(fillPromptPlaceholder("Improve: {{prompt}}", prompt)).toBe(`Improve: ${prompt}`);
	});
});
