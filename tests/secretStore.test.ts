import { describe, it, expect, vi } from "vitest";
import { SecretStore } from "../services/SecretStore";

// One setter for the four connections (principle 4): each stores the secret
// NAME, refreshes the in-memory key and hands it to the one service that uses it.

function plugin(secrets: Record<string, string>, failing = false) {
	return {
		settings: { anthropicSecretName: "", openaiSecretName: "", mistralSecretName: "", searchSecretName: "" },
		pluginDataStore: { persist: vi.fn().mockResolvedValue(undefined) },
		app: { secretStorage: { getSecret: vi.fn(async (n: string) => { if (failing) throw new Error("locked"); return secrets[n] ?? null; }) } },
		llmRouter: { updateApiKey: vi.fn() },
		webSearchService: { updateApiKey: vi.fn() },
		plaintextApiKey: "", plaintextOpenAIKey: "", plaintextMistralKey: "", plaintextSearchKey: "",
	};
}

describe("SecretStore.setKey", () => {
	it("stores the name, reads the key and routes a provider key to the router", async () => {
		const p = plugin({ "my-openai": "sk-1" });
		await new SecretStore(p as never).setKey("openai", "my-openai");
		expect(p.settings.openaiSecretName).toBe("my-openai");
		expect(p.plaintextOpenAIKey).toBe("sk-1");
		expect(p.llmRouter.updateApiKey).toHaveBeenCalledWith("openai", "sk-1");
		expect(p.pluginDataStore.persist).toHaveBeenCalled();
	});

	it("routes the search key to web search, not the router", async () => {
		const p = plugin({ tav: "tvly-1" });
		await new SecretStore(p as never).setKey("search", "tav");
		expect(p.plaintextSearchKey).toBe("tvly-1");
		expect(p.webSearchService.updateApiKey).toHaveBeenCalledWith("tvly-1");
		expect(p.llmRouter.updateApiKey).not.toHaveBeenCalled();
	});

	it("a secret that cannot be read leaves no key and does not throw", async () => {
		const p = plugin({}, true);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await new SecretStore(p as never).setKey("anthropic", "x");
		expect(p.plaintextApiKey).toBe("");
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
