import { SecretComponent, Setting } from "obsidian";
import { section, type SettingsContext } from "./context";
import { t } from "../../i18n";

/**
 * Connections — the first section (ADR-209): can Pythia reach anything at all.
 *
 * The four keys used to be four separate headings, each with a key row and a
 * model row under it, which made "which provider does Pythia use?" a question
 * answered three screens later by a one-row "Defaults" section. Keys are a
 * vault-level fact no conversation can override, so they are the section that
 * cannot hold anything else; the model each provider uses is a *default* and
 * lives in "New conversations".
 *
 * Each row says whether a key is actually selected. A settings row whose entire
 * visible state is "some secret name" cannot answer "why does nothing work?" —
 * and that is the question this section exists for.
 */
export function renderConnectionsSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("connectionsSection"), t("connectionsIntro"));

	keyRow(containerEl, ctx, t("anthropicKeyName"), t("apiKeyDesc"),
		() => ctx.plugin.settings.anthropicSecretName,
		(name) => ctx.plugin.setApiKey(name),
		() => ctx.plugin.hasApiKeyFor("anthropic"));

	keyRow(containerEl, ctx, t("openaiKeyName"), t("apiKeyDesc"),
		() => ctx.plugin.settings.openaiSecretName,
		(name) => ctx.plugin.setOpenAIKey(name),
		() => ctx.plugin.hasApiKeyFor("openai"));

	keyRow(containerEl, ctx, t("mistralKeyName"), t("apiKeyDesc"),
		() => ctx.plugin.settings.mistralSecretName,
		(name) => ctx.plugin.setMistralKey(name),
		() => ctx.plugin.hasApiKeyFor("mistral"));

	keyRow(containerEl, ctx, t("searchKeyName"), t("searchKeyDesc"),
		() => ctx.plugin.settings.searchSecretName,
		(name) => ctx.plugin.setSearchKey(name),
		() => ctx.plugin.plaintextSearchKey !== "",
		t("connectionSearchMissing"));
}

/**
 * One key row: the secret picker, and under it whether a key is in hand.
 *
 * The status is repainted after a change rather than re-read on render only: the
 * secret is fetched from Obsidian's storage inside the setter, so the answer
 * before and after a pick differ, and a stale "No key yet" under a key the user
 * just chose is the one thing this line must not say.
 */
function keyRow(
	containerEl: HTMLElement,
	ctx: SettingsContext,
	name: string,
	desc: string,
	read: () => string,
	write: (secretName: string) => Promise<void>,
	present: () => boolean,
	missingText: string = t("connectionKeyMissing"),
): void {
	const row = new Setting(containerEl).setName(name);
	const paint = (): void => {
		row.setDesc(`${desc} ${present() ? t("connectionKeySet") : missingText}`);
	};
	paint();
	row.addComponent((el) =>
		new SecretComponent(ctx.plugin.app, el)
			.setValue(read())
			.onChange(async (secretName) => {
				await write(secretName);
				paint();
			})
	);
}
