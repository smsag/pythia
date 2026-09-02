import type { Provider } from "../models/types";
import type PythiaPlugin from "../main";

/**
 * API-key management extracted from `PythiaPlugin` (ADR-103, engineering-review
 * #121): update a provider's secret-name setting, refresh the in-memory
 * plaintext key from Obsidian's SecretStorage, and push it into the router /
 * web-search service. The decrypted keys themselves stay on the plugin
 * (`plaintextApiKey` …), since PluginDataStore.loadPluginData also populates
 * them. Behaviour is identical to the inline plugin methods it replaced.
 */
export class SecretStore {
	constructor(private readonly plugin: PythiaPlugin) {}

	/** Update the Anthropic API key reference and refresh the in-memory key from SecretStorage. */
	async setApiKey(secretName: string): Promise<void> {
		this.plugin.settings.anthropicSecretName = secretName;
		await this.plugin.pluginDataStore.persist();
		this.plugin.plaintextApiKey = (await this.plugin.app.secretStorage.getSecret(secretName)) ?? "";
		this.plugin.llmRouter?.updateApiKey("anthropic", this.plugin.plaintextApiKey);
	}

	/** Update the OpenAI API key reference and refresh the in-memory key from SecretStorage. */
	async setOpenAIKey(secretName: string): Promise<void> {
		this.plugin.settings.openaiSecretName = secretName;
		await this.plugin.pluginDataStore.persist();
		this.plugin.plaintextOpenAIKey = (await this.plugin.app.secretStorage.getSecret(secretName)) ?? "";
		this.plugin.llmRouter?.updateApiKey("openai", this.plugin.plaintextOpenAIKey);
	}

	/** Update the Mistral API key reference and refresh the in-memory key from SecretStorage. */
	async setMistralKey(secretName: string): Promise<void> {
		this.plugin.settings.mistralSecretName = secretName;
		await this.plugin.pluginDataStore.persist();
		this.plugin.plaintextMistralKey = (await this.plugin.app.secretStorage.getSecret(secretName)) ?? "";
		this.plugin.llmRouter?.updateApiKey("mistral", this.plugin.plaintextMistralKey);
	}

	/** Update the Tavily web-search API key reference and refresh the in-memory key from SecretStorage. */
	async setSearchKey(secretName: string): Promise<void> {
		this.plugin.settings.searchSecretName = secretName;
		await this.plugin.pluginDataStore.persist();
		this.plugin.plaintextSearchKey = (await this.plugin.app.secretStorage.getSecret(secretName)) ?? "";
		this.plugin.webSearchService?.updateApiKey(this.plugin.plaintextSearchKey);
	}

	/** Update the Upvoty API token reference and refresh the in-memory token from SecretStorage. */
	async setUpvotyKey(secretName: string): Promise<void> {
		this.plugin.settings.upvotySecretName = secretName;
		await this.plugin.pluginDataStore.persist();
		this.plugin.plaintextUpvotyKey = (await this.plugin.app.secretStorage.getSecret(secretName)) ?? "";
		this.plugin.upvotyService?.updateApiKey(this.plugin.plaintextUpvotyKey);
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
