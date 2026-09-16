import { describe, it, expect } from "vitest";
import { resolveEffortState, resolveLanguageState } from "../ui/instructionState";
import { parameterSupport } from "../models/knownModels";

// The header's effort and language segments (ADR-165) show what a send is
// actually sent with. These rules decide it; the header only paints them.

const effortModel = "claude-sonnet-5";

describe("resolveEffortState", () => {
	it("the fixture model supports effort", () => {
		expect(parameterSupport("anthropic", effortModel).effort).toBe(true);
	});

	it("shows the global default, not pinned, when the conversation has none", () => {
		expect(resolveEffortState({ provider: "anthropic", model: effortModel, effort: undefined }, "high"))
			.toEqual({ level: "high", pinned: false, supported: true });
	});

	it("shows the conversation's own level as pinned", () => {
		expect(resolveEffortState({ provider: "anthropic", model: effortModel, effort: "low" }, "high"))
			.toEqual({ level: "low", pinned: true, supported: true });
	});

	it("reports no level when neither the conversation nor the settings name one", () => {
		expect(resolveEffortState({ provider: "anthropic", model: effortModel, effort: undefined }, undefined).level)
			.toBeNull();
	});

	it("a pinned level on a model without effort is kept but not shown as pinned", () => {
		const s = resolveEffortState({ provider: "openai", model: "gpt-4o", effort: "low" }, "high");
		expect(s.supported).toBe(false);
		expect(s.pinned).toBe(false);
	});
});

describe("resolveLanguageState", () => {
	it("a fixed language is its upper-case code", () => {
		expect(resolveLanguageState("de", "auto", "en")).toEqual({ setting: "de", code: "DE", pinned: true, instructed: true });
	});

	it("auto shows AUTO and is not an instruction", () => {
		expect(resolveLanguageState("auto", "de", "en")).toEqual({ setting: "auto", code: "AUTO", pinned: true, instructed: false });
	});

	it("inherits the global setting unpinned", () => {
		expect(resolveLanguageState(undefined, "auto", "de")).toEqual({ setting: "auto", code: "AUTO", pinned: false, instructed: false });
		expect(resolveLanguageState(undefined, "en", "de").pinned).toBe(false);
	});

	it("obsidian resolves to the UI locale's language", () => {
		expect(resolveLanguageState("obsidian", "auto", "de").code).toBe("DE");
		expect(resolveLanguageState("obsidian", "auto", "pt-br").code).toBe("PT");
	});

	it("obsidian with an unknown locale falls back to English, like the prompt", () => {
		expect(resolveLanguageState("obsidian", "auto", "xx").code).toBe("EN");
		expect(resolveLanguageState("obsidian", "auto", "").code).toBe("EN");
	});
});
