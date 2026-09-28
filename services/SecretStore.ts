import type { Provider } from "../models/types";
import type PythiaPlugin from "../main";
import type { PythiaSettings } from "../models/settings";
import { describeErrorForLog } from "./redact";

/** The four connections: the three model providers and web search. */
export type KeyKind = Provider | "search";

type PlaintextField = "plaintextApiKey" | "plaintextOpenAIKey" | "plaintextMistralKey" | "plaintextSearchKey";

/** Where each connection keeps its secret NAME (settings) and its key (memory). */
const KEY_SLOTS: Record<KeyKind, { setting: keyof PythiaSettings & `${string}SecretName`; plaintext: PlaintextField }> = {
	anthropic: { setting: "anthropicSecretName", plaintext: "plaintextApiKey" },
	openai: { setting: "openaiSecretName", plaintext: "plaintextOpenAIKey" },
	mistral: { setting: "mistralSecretName", plaintext: "plaintextMistralKey" },
	search: { setting: "searchSecretName", plaintext: "plaintextSearchKey" },
};

/**
 * API-key management extracted from `PythiaPlugin` (ADR-103, engineering-review
 * #121): update a provider's secret-name setting, refresh the in-memory
 * plaintext key from Obsidian's SecretStorage, and push it into the router /
 * web-search service. The keys themselves stay on the plugin (`plaintextApiKey`
 * …), since PluginDataStore.loadPluginData also populates them.
 */
export class SecretStore {
	constructor(private readonly plugin: PythiaPlugin) {}

	/**
	 * Point one connection at a secret name and refresh its in-memory key.
	 * ONE method for the four keys: the four hand-written copies this replaced
	 * differed only in which fields they named, which is the drift principle 4
	 * is about.
	 */
	async setKey(kind: KeyKind, secretName: string): Promise<void> {
		const p = this.plugin;
		const slot = KEY_SLOTS[kind];
		p.settings[slot.setting] = secretName;
		await p.pluginDataStore.persist();
		let key = "";
		try {
			key = (await p.app.secretStorage.getSecret(secretName)) ?? "";
		} catch (e) {
			// Said, not swallowed: the row below the picker then reads "no key".
			console.warn(`[Pythia] secret "${secretName}" could not be read:`, describeErrorForLog(e));
		}
		p[slot.plaintext] = key;
		if (kind === "search") p.webSearchService?.updateApiKey(key);
		else p.llmRouter?.updateApiKey(kind, key);
	}

	/** Exhaustive switch (not a two-way ternary) so a fourth provider fails to
	 *  compile here instead of silently checking the wrong provider's key. */
	hasApiKeyFor(provider: Provider): boolean {
		switch (provider) {
			case "anthropic":
				return !!this.plugin.plaintextApiKey;
			case "openai":
				return !!this.plugin.plaintextOpenAIKey;
			case "mistral":
				return !!this.plugin.plaintextMistralKey;
			default: {
				const exhaustiveCheck: never = provider;
				throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
			}
		}
	}
}
