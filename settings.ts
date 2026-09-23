import { App, PluginSettingTab } from "obsidian";
import type PythiaPlugin from "./main";
import { renderEmbeddingSettings } from "./ui/embeddingSettings";
import type { SettingsContext } from "./ui/settings/context";
import { renderConnectionsSection } from "./ui/settings/connections";
import { renderNewConversationsSection } from "./ui/settings/conversationDefaults";
import { renderAnsweringSection } from "./ui/settings/answering";
import { renderOptimizerSection } from "./ui/settings/optimizer";
import { renderNotesSection } from "./ui/settings/notes";
import { renderStorageSection } from "./ui/settings/storage";
import { renderTroubleshootingSection } from "./ui/settings/troubleshooting";

// PythiaSettings interface and DEFAULT_SETTINGS live in models/settings.ts so
// that service modules can import them without pulling in the Obsidian UI layer.
export { PythiaSettings, DEFAULT_SETTINGS } from "./models/settings";

/**
 * The settings tab is a shell (ADR-206): it owns the section order, the numeric
 * fields' flush on close, and nothing else. Each section is a module under
 * `ui/settings/`, rendered in the order below.
 *
 * **The order is the information architecture.** It goes from what Pythia needs
 * to work at all, through what a new conversation inherits, to what applies to
 * every answer, to the machinery nobody touches twice — and it puts the two
 * sections that differ in *scope* next to each other, because that difference is
 * the thing the old tab never said out loud: "New conversations" holds the values
 * a single conversation can override, "While answering" holds the ones it cannot.
 *
 * Adding a setting means deciding which section's one-sentence remit covers it. If
 * none does, that is the finding — the old tab's answer was "Behaviour" or
 * "Features", which is how ten unrelated rows ended up under one heading and how
 * two rows ended up rendered inside the embedding block by accident.
 *
 * `section()` is the only way a heading is made: the tab used to mix raw
 * `createEl("h3")` with Obsidian's own `setHeading()`, which do not look alike,
 * so the same idea had two visual tiers. `tests/settingsIA.test.ts` fails on a
 * heading built any other way.
 */
export class PythiaSettingTab extends PluginSettingTab {
	private plugin: PythiaPlugin;
	/** Commit functions of the numeric fields on screen (ADR-171). They fire on
	 *  blur, which closing the tab never gives them — `hide()` runs them instead. */
	private numberCommits: (() => void)[] = [];

	constructor(app: App, plugin: PythiaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Commit the number field the user is still standing in, then flush what was
		// typed in the last few hundred ms and repaint the header's defaults (ADR-165).
		for (const commit of this.numberCommits) commit();
		this.plugin.onSettingsTabClosed();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.numberCommits = [];

		// The vault-index status row is created by the embedding section; the two
		// skip-folder pickers that also move the index scope live in later sections
		// (#367), so the refresh reaches them through the context rather than
		// through an argument only that one section could receive.
		let refreshIndexStatus: () => void = () => {};
		const ctx: SettingsContext = {
			plugin: this.plugin,
			// Typed fields save a beat after the last keystroke (every save rewrites
			// the whole data.json); toggles and dropdowns still save at once.
			saveSoon: () => this.plugin.saveSettingsSoon(),
			registerCommit: (commit) => this.numberCommits.push(commit),
			refreshIndexStatus: () => refreshIndexStatus(),
		};

		renderConnectionsSection(containerEl, ctx);
		renderNewConversationsSection(containerEl, ctx);
		renderAnsweringSection(containerEl, ctx);
		renderOptimizerSection(containerEl, ctx);
		// On-device semantic search and vault context: two sections of its own, and
		// the block whose per-section intro the rest of the tab now follows.
		refreshIndexStatus = renderEmbeddingSettings(containerEl, this.plugin, ctx.registerCommit);
		renderNotesSection(containerEl, ctx);
		renderStorageSection(containerEl, ctx);
		renderTroubleshootingSection(containerEl, ctx);
	}
}
