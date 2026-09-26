import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { debugLog } from "./messageUtils";

const DEBOUNCE_MS = 300;

export class ConversationStore {
	private plugin: PythiaPlugin;
	/** The store OWNS the conversation list (ADR-103 / #122). `plugin.conversations`
	 *  is a read/write accessor delegating here, so there is one owner and no
	 *  bidirectional coupling. `getAll()` returns the live array (callers may push
	 *  onto it); `setAll()` replaces it (used by loadPluginData / persist eviction). */
	private _conversations: Conversation[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private dirtyIds = new Set<string>();
	/** Told when the list or a conversation in it changed — Schreibstube re-lists
	 *  on its next question rather than on every save (ADR-223). */
	private listeners = new Set<() => void>();

	constructor(plugin: PythiaPlugin) {
		this.plugin = plugin;
	}

	/** Subscribe to changes; returns the unsubscribe. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (e) {
				debugLog(this.plugin.settings, "conversation change listener failed:", e);
			}
		}
	}

	getAll(): Conversation[] {
		return this._conversations;
	}

	/** Replace the whole list — the only writer of the array reference. */
	setAll(conversations: Conversation[]): void {
		this._conversations = conversations;
		this.notify();
	}

	getById(id: string): Conversation | undefined {
		return this._conversations.find((c) => c.id === id);
	}

	/** Returns a snapshot of the current dirty IDs for race-safe clearing. */
	snapshotDirty(): Set<string> {
		return new Set(this.dirtyIds);
	}

	/** Clears only the IDs that were in the snapshot — IDs added after the
	 *  snapshot was taken survive for the next persist cycle. */
	clearDirtySnapshot(snapshot: Set<string>): void {
		for (const id of snapshot) this.dirtyIds.delete(id);
	}

	/** Marks a conversation as dirty without triggering a persist — used when a new
	 *  conversation is created externally and added to the array. */
	markDirty(id: string): void {
		this.dirtyIds.add(id);
		this.notify();
	}

	async save(conversation: Conversation): Promise<void> {
		const idx = this._conversations.findIndex((c) => c.id === conversation.id);
		if (idx < 0) {
			debugLog(this.plugin.settings, "save() skipped — conversation no longer exists:", conversation.id);
			return;
		}
		conversation.updatedAt = new Date().toISOString();
		this._conversations[idx] = conversation;
		this.dirtyIds.add(conversation.id);
		this.schedulePersist();
		this.notify();
	}

	/**
	 * Mark conversations changed by something that is not activity — a vault
	 * rename followed into their stored paths (ADR-218). Dirty and persisted
	 * soon, but `updatedAt` is left alone: bumping it would reorder the
	 * conversation list behind the user's back.
	 */
	markChanged(ids: string[]): void {
		if (ids.length === 0) return;
		for (const id of ids) this.dirtyIds.add(id);
		this.schedulePersist();
		this.notify();
	}

	async delete(id: string): Promise<void> {
		this._conversations = this._conversations.filter((c) => c.id !== id);
		this.dirtyIds.delete(id);
		this.cancelPersist();
		this.notify();
		await this.plugin.saveConversations();
	}

	async flush(): Promise<void> {
		this.cancelPersist();
		if (this.dirtyIds.size === 0) return;
		await this.plugin.saveConversations();
	}

	/** Cancel any pending debounced persist — exposed for reloadFromDisk(). */
	cancelPendingPersist(): void {
		this.cancelPersist();
	}

	private schedulePersist(): void {
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			if (this.dirtyIds.size === 0) return;
			void this.plugin.saveConversations();
		}, DEBOUNCE_MS);
	}

	private cancelPersist(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
