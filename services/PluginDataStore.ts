import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { t } from "../i18n";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "../sidebar";
import {
	applySettingsMigrations,
	mergeSettings,
	parseConversations,
	shouldRefuseLoad,
	evictConversations,
} from "./persistence";

/**
 * data.json I/O extracted from `PythiaPlugin` (ADR-103, engineering-review
 * #121): load (with settings migrations + iCloud-eviction guard), persist (with
 * conversation eviction + own-write stamping), the cross-device watcher, and
 * the disk-reload refresh. Behaviour is identical to the inline plugin methods
 * it replaced; `settings`/`conversations`/`plaintext*` still live on the plugin
 * (the ConversationStore ownership inversion is a later step).
 */
export class PluginDataStore {
	/** Set by watchDataJson() so persist() can stamp the own-write time. */
	private saveDataRecordTime: (() => void) | null = null;

	constructor(private readonly plugin: PythiaPlugin) {}

	async loadPluginData(): Promise<void> {
		const p = this.plugin;
		const data = (await p.loadData()) ?? {};
		const saved = (data.settings ?? {}) as Record<string, unknown>;

		const { needsSave, legacyAnthropicCiphertext, legacyOpenAICiphertext } =
			applySettingsMigrations(saved);

		if (legacyAnthropicCiphertext) {
			const plaintext = legacyDecrypt(legacyAnthropicCiphertext);
			if (plaintext) {
				p.app.secretStorage.setSecret(DEFAULT_SETTINGS.anthropicSecretName, plaintext);
			} else {
				new Notice(t("migrateAnthropicFailed"), 8000);
			}
		}
		if (legacyOpenAICiphertext) {
			const plaintext = legacyDecrypt(legacyOpenAICiphertext);
			if (plaintext) {
				p.app.secretStorage.setSecret(DEFAULT_SETTINGS.openaiSecretName, plaintext);
			} else {
				new Notice(t("migrateOpenAIFailed"), 8000);
			}
		}

		p.settings = mergeSettings(saved);

		const rawConversations = (data.conversations ?? []) as unknown[];
		const { conversations: loaded, dropped } = parseConversations(rawConversations);
		if (dropped > 0) {
			console.warn(`[Pythia] Dropped ${dropped} malformed conversation(s) from data.json`);
		}

		// iCloud eviction guard — checked BEFORE overwriting p.conversations.
		// If the file came back empty while we have conversations in memory,
		// refuse the load and keep the existing state.
		// (Cause: iCloud evicts data.json to cloud-only; loadData() returns {}.)
		//
		// Deliberately here, NOT in persist(), so that user-initiated "delete all
		// conversations" works normally: conversations decrement one by one through
		// normal deletes; persist() is never blocked and always saves whatever is in
		// p.conversations.
		const existingCount = Array.isArray(p.conversations) ? p.conversations.length : 0;
		if (shouldRefuseLoad(loaded, existingCount)) {
			new Notice(
				"[Pythia] Loaded 0 conversations from disk while having conversations in memory. " +
				"Keeping existing state. Check iCloud sync.",
				8000
			);
			return;
		}

		p.conversations = loaded;

		// getSecret() is async in Obsidian's current typings (truly async on iOS WebKit). (#18)
		p.plaintextApiKey =
			(await p.app.secretStorage.getSecret(p.settings.anthropicSecretName)) ?? "";
		p.plaintextOpenAIKey =
			(await p.app.secretStorage.getSecret(p.settings.openaiSecretName)) ?? "";
		p.plaintextMistralKey =
			(await p.app.secretStorage.getSecret(p.settings.mistralSecretName)) ?? "";
		p.plaintextSearchKey =
			(await p.app.secretStorage.getSecret(p.settings.searchSecretName)) ?? "";
		p.plaintextUpvotyKey =
			(await p.app.secretStorage.getSecret(p.settings.upvotySecretName)) ?? "";

		if (needsSave) {
			await p.saveData({ settings: p.settings, conversations: p.conversations });
		}
	}

	async saveSettings(): Promise<void> {
		const p = this.plugin;
		await this.persist();
		p.llmRouter?.updateSettings(p.settings);
		p.templateLoader?.updateSettings(p.settings);
		p.noteWriter?.updateSettings(p.settings);
		p.webSearchService?.updateSettings(p.settings);
		p.upvotyService?.updateSettings(p.settings);
		p.promptOptimizerService?.updateSettings(p.settings);
	}

	async saveConversations(): Promise<void> {
		await this.persist();
	}

	async persist(): Promise<void> {
		const p = this.plugin;
		try {
			// Evict oldest non-starred conversations beyond the cap (#3).
			// Always protect every currently-open conversation, even if it has no
			// starred messages — evicting an active conversation would silently
			// lose new turns (#17). Pythia's view can be opened in more than one
			// leaf, so every leaf's active conversation is protected, not just one.
			const activeIds = p.app.workspace
				.getLeavesOfType(PYTHIA_VIEW_TYPE)
				.map((leaf) => (leaf.view as PythiaSidebarView).activeConversationId)
				.filter((id): id is string => id !== null);
			p.conversations = evictConversations(
				p.conversations,
				p.settings.maxConversations,
				activeIds,
			);

			const snapshot = p.conversationStore?.snapshotDirty();
			this.saveDataRecordTime?.();   // stamp own-write time before the watcher can fire
			await p.saveData({
				settings: p.settings,
				conversations: p.conversations,
			});
			if (snapshot) p.conversationStore?.clearDirtySnapshot(snapshot);
		} catch (err) {
			new Notice(
				`[Pythia] Failed to save data: ${err instanceof Error ? err.message : String(err)}`,
				8000
			);
		}
	}

	/**
	 * Reload settings + conversations from data.json and refresh open views.
	 *
	 * `notify` controls the "reload complete" toast. It defaults to true for the
	 * user-initiated manual reload (the command hub), but the automatic,
	 * watchDataJson-triggered reload passes false — see the call site there for
	 * why (an iCloud/Obsidian-Sync vault fires this constantly and would otherwise
	 * spam a notification on every background sync).
	 */
	async reloadFromDisk({ notify = true }: { notify?: boolean } = {}): Promise<void> {
		const p = this.plugin;
		p.conversationStore?.cancelPendingPersist();
		await this.loadPluginData();
		p.llmRouter?.updateSettings(p.settings);
		p.llmRouter?.updateApiKey("anthropic", p.plaintextApiKey);
		p.llmRouter?.updateApiKey("openai", p.plaintextOpenAIKey);
		p.llmRouter?.updateApiKey("mistral", p.plaintextMistralKey);
		p.templateLoader?.updateSettings(p.settings);
		p.noteWriter?.updateSettings(p.settings);
		p.webSearchService?.updateSettings(p.settings);
		p.webSearchService?.updateApiKey(p.plaintextSearchKey);
		p.upvotyService?.updateSettings(p.settings);
		p.upvotyService?.updateApiKey(p.plaintextUpvotyKey);
		p.promptOptimizerService?.updateSettings(p.settings);
		const leaves = p.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as PythiaSidebarView;
			const still = p.conversations.find(c => c.id === view.activeConversationId);
			const next  = still ?? p.conversations[0] ?? null;
			if (next) {
				await view.setActiveConversation(next, false);
			} else {
				view.renderEmptyState();
			}
		}
		if (notify) new Notice(t("reloadComplete"));
	}

	/**
	 * Poll data.json for external modifications every 5 seconds.
	 * vault.on("modify") does not fire for .obsidian/ system files, so
	 * polling adapter.stat() is the reliable cross-platform approach.
	 *
	 * When another device (via iCloud / Obsidian Sync) writes a newer
	 * data.json while this instance is running, we reload from disk and
	 * refresh the sidebar so conversations stay in sync.
	 */
	watchDataJson(): void {
		const p = this.plugin;
		const DATA_JSON_PATH = `.obsidian/plugins/${p.manifest.id}/data.json`;
		let lastKnownMtime = Date.now();
		let lastOwnWrite   = Date.now();

		// Record whenever WE write so we can ignore our own saves.
		this.saveDataRecordTime = () => { lastOwnWrite = Date.now(); };

		const handle = window.setInterval(async () => {
			try {
				const stat = await p.app.vault.adapter.stat(DATA_JSON_PATH);
				if (!stat) return;
				// External write: mtime is newer than what we last saw AND
				// we didn't write it ourselves within the last 3 seconds.
				if (stat.mtime > lastKnownMtime && Date.now() - lastOwnWrite > 3000) {
					lastKnownMtime = stat.mtime;
					// Silent reload (notify: false). WORKAROUND for iCloud / Obsidian
					// Sync vaults: those services rewrite data.json in the background
					// very frequently (delivering another device's changes, or just
					// touching the file), and each rewrite bumps mtime and trips this
					// watcher. If reloadFromDisk showed its "reload complete" toast every
					// time, the user would be spammed with notifications on a loop for a
					// sync they never asked about. So the automatic, watcher-driven reload
					// stays quiet; only the user-initiated manual reload (command hub)
					// surfaces the confirmation toast. The reload itself still happens —
					// conversations stay fresh — it just doesn't announce itself.
					await this.reloadFromDisk({ notify: false });
				} else {
					// Keep mtime in sync even if we wrote it ourselves.
					lastKnownMtime = Math.max(lastKnownMtime, stat.mtime);
				}
			} catch { /* adapter unavailable on some platforms */ }
		}, 5000);

		p.register(() => window.clearInterval(handle));
	}
}

/**
 * One-time migration helper: decrypts a value that was previously stored by
 * the old SecureStorage implementation (Electron safeStorage or plain: prefix).
 * Used only during the migration path in loadPluginData() — not for any
 * ongoing encryption/decryption.
 */
function legacyDecrypt(stored: string): string {
	if (!stored) return "";

	if (stored.startsWith("enc:")) {
		try {
			// Buffer is a Node.js/Electron API — unavailable on iOS/Android.
			// Guard before calling to avoid ReferenceError on mobile.
			if (typeof Buffer === "undefined") return "";
			const electron = (window as any).require?.("electron"); // any: Electron API not in TS types
			const ss = electron?.safeStorage;
			if (ss?.isEncryptionAvailable()) {
				const buf = Buffer.from(stored.slice(4), "base64");
				return ss.decryptString(buf) as string;
			}
		} catch {
			// safeStorage unavailable or decryption failed
		}
		return "";
	}

	if (stored.startsWith("plain:")) return stored.slice(6);

	// Legacy: raw plaintext with no prefix
	return stored;
}
