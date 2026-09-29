import { Notice, debounce, normalizePath } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { loadedPythiaViews } from "./ViewManager";
import { debugLog } from "./messageUtils";
import { describeErrorForLog } from "./redact";
import { archiveFolderOf } from "./conversationArchive";
import { formatBytes, storageLevel } from "./storageSize";
import { mergeRenameLogs, normalizeRenameLog, type RenameLogEntry } from "./renameFollower";
import { Ablage, mergeAblage, normalizeAblage, type AblageSlot } from "./ablage";
import {
	mergeSettings,
	parseConversations,
	shouldRefuseLoad,
	mergeConversations,
	partitionEvictions,
	countEvictions,
} from "./persistence";

/**
 * data.json I/O extracted from `PythiaPlugin` (ADR-103, engineering-review
 * #121): load (validated through mergeSettings, with the iCloud-eviction guard), persist (with
 * conversation eviction + own-write stamping), the cross-device watcher, and
 * the disk-reload refresh. Behaviour is identical to the inline plugin methods
 * it replaced; `settings`/`conversations`/`plaintext*` still live on the plugin
 * (the ConversationStore ownership inversion is a later step).
 */
/** Typed settings fire per keystroke; every save rewrites the whole data.json. */
const SETTINGS_SAVE_DEBOUNCE_MS = 400;

export class PluginDataStore {
	/** Set by watchDataJson() so persist() can stamp the own-write time. */
	private saveDataRecordTime: (() => void) | null = null;
	/** Set by the watcher: record the mtime our own completed write produced, so
	 *  the next poll cannot mistake it for another device's (#356). */
	private ownWriteLanded: (() => Promise<void>) | null = null;
	/** The one coalesced save for text/number settings fields — the settings tab
	 *  and its sub-panels all go through it, so no surface writes per keystroke. */
	private readonly settingsSaveSoon = debounce(() => void this.saveSettings(), SETTINGS_SAVE_DEBOUNCE_MS, true);

	/** The renames followed recently, kept in data.json so a stale copy from
	 *  another device can be put right after a sync (ADR-218 addendum). */
	renameLog: RenameLogEntry[] = [];

	/** The Ablage's one slot (ADR-246), kept in data.json beside the rename log. */
	private ablageSlot: AblageSlot | undefined;
	readonly ablage = new Ablage({
		slot: () => this.ablageSlot,
		setSlot: (slot) => { this.ablageSlot = slot; },
		persist: () => this.persist(),
	});

	constructor(private readonly plugin: PythiaPlugin) {}

	async loadPluginData(): Promise<void> {
		const p = this.plugin;
		const data = (await p.loadData()) ?? {};
		const saved = (data.settings ?? {}) as Record<string, unknown>;

		p.settings = mergeSettings(saved);
		// Union, not replace: a sync must not drop the renames this device logged.
		this.renameLog = mergeRenameLogs(this.renameLog, normalizeRenameLog(data.renameLog));
		// The newer write wins, so an insert here is not undone by a stale sync.
		this.ablageSlot = mergeAblage(this.ablageSlot, normalizeAblage(data.ablage));

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
		const existing = Array.isArray(p.conversations) ? p.conversations : [];
		if (shouldRefuseLoad(loaded, existing.length)) {
			new Notice(
				"[Pythia] Loaded 0 conversations from disk while having conversations in memory. " +
				"Keeping existing state. Check iCloud sync.",
				8000
			);
			return;
		}

		// Reconcile rather than replace (ADR-133). A disk copy older than memory —
		// a sync delivering another device's state, or a write that has not landed
		// yet — must never roll back a conversation the user is still writing in.
		const merged = mergeConversations(existing, loaded);
		p.conversations = merged.conversations;
		if (merged.keptFromMemory > 0) {
			// Disk is behind for THESE — not for every conversation (#356). Marking all
			// of them rewrote the whole file on every reload, which the watcher then
			// read as the next external change. markDirty does not itself write, so
			// startup stays read-only and the reload path decides when to persist.
			for (const id of merged.newerInMemory) p.conversationStore?.markDirty(id);
			debugLog(p.settings, "loadPluginData kept newer in-memory conversations", {
				kept: merged.keptFromMemory,
				onDisk: loaded.length,
			});
		}

		// getSecret() is async in Obsidian's current typings (truly async on iOS
		// WebKit, #18). The four reads are independent, so they run concurrently
		// instead of serially on the startup path.
		const secret = async (name: string): Promise<string> => {
			try {
				return (await p.app.secretStorage.getSecret(name)) ?? "";
			} catch (e) {
				console.warn(`[Pythia] secret "${name}" could not be read:`, describeErrorForLog(e));
				return "";
			}
		};
		[p.plaintextApiKey, p.plaintextOpenAIKey, p.plaintextMistralKey, p.plaintextSearchKey] =
			await Promise.all([
				secret(p.settings.anthropicSecretName),
				secret(p.settings.openaiSecretName),
				secret(p.settings.mistralSecretName),
				secret(p.settings.searchSecretName),
			]);

		void this.warnIfStoreIsLarge();
	}

	async saveSettings(): Promise<void> {
		const p = this.plugin;
		await this.persist();
		p.llmRouter?.updateSettings(p.settings);
		p.templateLoader?.updateSettings(p.settings);
		p.noteWriter?.updateSettings(p.settings);
		p.webSearchService?.updateSettings(p.settings);
		p.promptOptimizerService?.updateSettings(p.settings);
	}

	/** Save settings a beat after the last call (typed fields). */
	saveSettingsSoon(): void {
		this.settingsSaveSoon();
	}

	/** Run a pending debounced settings save now (closing the settings tab). */
	flushSettingsSave(): void {
		this.settingsSaveSoon.run();
	}

	async saveConversations(): Promise<void> {
		await this.persist({ evict: true });
	}

	/**
	 * Conversations open in a Pythia leaf right now. They are protected from
	 * eviction even without a starred message — evicting the conversation being
	 * written in would silently lose its newest turns (#17). Pythia's view can be
	 * opened in more than one leaf, so every leaf's conversation counts.
	 */
	private activeConversationIds(): string[] {
		const open = loadedPythiaViews(this.plugin.app.workspace)
			.map((view) => view.activeConversationId)
			.filter((id): id is string => id !== null);
		return [...open, ...this.createdThisSession];
	}

	/** Conversations created in this session. `createConversation` saves BEFORE a
	 *  view opens it, so without this a list full of protected conversations would
	 *  archive the new one on the very write that created it, and every later save
	 *  of it would be skipped as "no longer exists". */
	private readonly createdThisSession = new Set<string>();

	/** Called by `createConversation` before its first write. */
	protectNewConversation(id: string): void {
		this.createdThisSession.add(id);
	}

	/** How many conversations lowering the cap to `cap` would delete. The settings
	 *  tab names this number and asks before storing such a value (ADR-171). */
	pendingEvictionCount(cap: number): number {
		return countEvictions(this.plugin.conversations, cap, this.activeConversationIds());
	}

	/** The large-store Notice has been shown this session (ADR-174). */
	private warnedLargeStore = false;

	/** One eviction at a time: `persist` can be re-entered while the archive is
	 *  writing, and a second pass would archive the same conversation twice. */
	private evicting = false;

	/**
	 * Apply the conversation cap, archiving what it removes (ADR-172).
	 *
	 * The order is the whole point: **a conversation is dropped only once its
	 * note exists.** A failed write keeps it in `data.json` — the list stays over
	 * the cap until the vault can be written, which is the right way round for a
	 * limit whose only job is to save space. Either outcome says so out loud; the
	 * silent version of this is what deleted a user's conversations (ADR-171).
	 */
	private async applyCap(): Promise<Conversation[]> {
		const p = this.plugin;
		const { kept, removed } = partitionEvictions(
			p.conversations,
			p.settings.maxConversations,
			this.activeConversationIds(),
		);
		if (removed.length === 0) return kept;
		if (this.evicting) return p.conversations;
		this.evicting = true;
		try {
			if (!p.settings.archiveBeforeEviction) {
				new Notice(t("evictedNotice", { count: String(removed.length) }), 8000);
				return kept;
			}
			const folder = archiveFolderOf(p.settings);
			const failed: Conversation[] = [];
			for (const conv of removed) {
				try {
					await p.noteWriter.archiveConversationNote(conv, folder);
				} catch (e) {
					console.warn(`[Pythia] could not archive "${conv.name}":`, describeErrorForLog(e));
					failed.push(conv);
				}
			}
			const archived = removed.length - failed.length;
			if (archived > 0) {
				new Notice(t("archivedNotice", { count: String(archived), folder }), 8000);
			}
			if (failed.length > 0) {
				// Kept, not deleted. The next persist tries again.
				new Notice(t("archiveFailedNotice", { count: String(failed.length) }), 10000);
			}
			// Filter the LIVE list, not `kept`: the archive writes above awaited, and a
			// conversation created, deleted or reloaded meanwhile must not be undone
			// by a list computed before them.
			const failedIds = new Set(failed.map((c) => c.id));
			const droppedIds = new Set(removed.filter((c) => !failedIds.has(c.id)).map((c) => c.id));
			return p.conversations.filter((c) => !droppedIds.has(c.id));
		} finally {
			this.evicting = false;
		}
	}

	/**
	 * Write settings + conversations to data.json.
	 *
	 * `evict` defaults to OFF: applying the conversation cap deletes conversations
	 * permanently, so it belongs to a conversation write (`saveConversations`),
	 * never to a settings or secret write (ADR-171). It used to run on every
	 * persist, which made each keystroke in the cap field a deletion — typing
	 * "0" over "200" passes through 20 and 2, and the debounced save behind it
	 * evicted everything without a favorite down to that transient number.
	 */
	async persist({ evict = false }: { evict?: boolean } = {}): Promise<void> {
		const p = this.plugin;
		try {
			// Evict oldest non-starred conversations beyond the cap (#3), archiving
			// each to a vault note first when the setting asks for it (ADR-172).
			if (evict) p.conversations = await this.applyCap();

			const snapshot = p.conversationStore?.snapshotDirty();
			this.saveDataRecordTime?.();   // stamp own-write time before the watcher can fire
			await p.saveData({
				settings: p.settings,
				conversations: p.conversations,
				renameLog: this.renameLog,
				...(this.ablageSlot ? { ablage: this.ablageSlot } : {}),
			});
			// Stamp again on completion: saveData can take seconds on mobile, and the
			// watcher's own-write window is measured from the stamp. Without this a
			// slow write lands outside its own window and is re-read as external.
			this.saveDataRecordTime?.();
			// And absorb the mtime it produced: a time window alone loses to a poll
			// that lands after it, which is how our own flush re-triggered the
			// watcher every cycle (#356).
			await this.ownWriteLanded?.();
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
		p.promptOptimizerService?.updateSettings(p.settings);
		// A copy written before a rename was known may have won the merge with the
		// old paths; the log puts it right (ADR-218 addendum).
		p.renameFollower?.replay();
		// Anything memory won during the merge is newer than disk; write it back now
		// rather than leaving the file stale until the next edit (ADR-133).
		await p.conversationStore?.flush();
		// Every LOADED view must be re-pointed: when disk won the merge, the view
		// still holds the replaced object, and its next save would write that
		// stale copy back over the newer one. Deferred leaves are skipped, not
		// failed on — they read `p.conversations` when they load (#342).
		for (const view of loadedPythiaViews(p.app.workspace)) {
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

	/** The plugin's own data.json. The config directory is user-configurable, so
	 *  this is derived from the manifest, never a hardcoded ".obsidian". */
	private dataJsonPath(): string {
		const p = this.plugin;
		const pluginDir = p.manifest.dir ?? `${p.app.vault.configDir}/plugins/${p.manifest.id}`;
		return normalizePath(`${pluginDir}/data.json`);
	}

	/** Size of data.json in bytes, or null when it cannot be read (ADR-174). The
	 *  settings tab shows it: it is the number that decides when this design
	 *  starts to hurt, and nothing else in the app exposes it. */
	async dataFileBytes(): Promise<number | null> {
		try {
			const stat = await this.plugin.app.vault.adapter.stat(this.dataJsonPath());
			return stat?.size ?? null;
		} catch (e) {
			console.warn("[Pythia] could not stat data.json:", describeErrorForLog(e));
			return null;
		}
	}

	/**
	 * Say once per load when data.json has grown past the point where every
	 * message pays for the whole file (ADR-174). Only at `high`: the settings
	 * readout carries `warn`, and a Notice the user cannot act on twice is noise.
	 */
	private async warnIfStoreIsLarge(): Promise<void> {
		// Once per session: loadPluginData also runs on every background sync
		// reload, and a 12 s Notice every few seconds is how warnings get ignored.
		if (this.warnedLargeStore) return;
		const bytes = await this.dataFileBytes();
		if (bytes === null || storageLevel(bytes) !== "high") return;
		this.warnedLargeStore = true;
		new Notice(
			t("storageHighNotice", {
				size: formatBytes(bytes),
				count: String(this.plugin.conversations.length),
			}),
			12000,
		);
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
		// The plugin folder, not a hardcoded ".obsidian": the config directory is
		// user-configurable, and a watcher pointed at the wrong path never fires —
		// silently, since a missing stat is the "nothing to do" case below.
		const DATA_JSON_PATH = this.dataJsonPath();
		// Seeded from the clock and corrected on the first poll below. Using the
		// file's own mtime as the baseline matters: data.json is routinely older
		// than the moment the plugin loads, and seeding from the clock would let a
		// genuinely newer external write go unnoticed until the next one.
		let lastKnownMtime = 0;
		let lastOwnWrite   = Date.now();
		let seeded         = false;
		// A reload can take longer than one poll interval (large data.json on a
		// slow device), and two overlapping reloads would race each other's merge.
		let reloading      = false;

		// Record whenever WE write so we can ignore our own saves.
		this.saveDataRecordTime = () => { lastOwnWrite = Date.now(); };
		// The file our own write left behind is not news. Absorbing its mtime here
		// is what ends the reload → flush → "external change" → reload loop (#356).
		const absorbOwnMtime = async (): Promise<void> => {
			try {
				const s = await p.app.vault.adapter.stat(DATA_JSON_PATH);
				if (s) lastKnownMtime = Math.max(lastKnownMtime, s.mtime);
			} catch (e) {
				// The next poll re-reads the file; worst case is one redundant reload.
				console.warn("[Pythia] data.json watcher: could not stat after own write:", describeErrorForLog(e));
			}
		};
		this.ownWriteLanded = absorbOwnMtime;

		const handle = window.setInterval(async () => {
			try {
				const stat = await p.app.vault.adapter.stat(DATA_JSON_PATH);
				if (!stat) return;
				if (!seeded) { seeded = true; lastKnownMtime = stat.mtime; return; }
				// External write: mtime is newer than what we last saw AND
				// we didn't write it ourselves within the last 3 seconds.
				if (reloading) return;
				if (stat.mtime > lastKnownMtime && Date.now() - lastOwnWrite > 3000) {
					lastKnownMtime = stat.mtime;
					reloading = true;
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
					try {
						await this.reloadFromDisk({ notify: false });
						// Its flush (if any) wrote the file; that write is ours too.
						await absorbOwnMtime();
					} finally {
						reloading = false;
					}
				} else {
					// Keep mtime in sync even if we wrote it ourselves.
					lastKnownMtime = Math.max(lastKnownMtime, stat.mtime);
				}
			} catch (e) {
				// A failed poll is not silent: a reload that threw mid-merge is exactly
				// the kind of error that otherwise shows up only as "my conversation
				// rolled back".
				console.warn("[Pythia] data.json watcher:", describeErrorForLog(e));
			}
		}, 5000);

		p.register(() => window.clearInterval(handle));
	}
}
