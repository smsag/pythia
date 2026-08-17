import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { debugLog } from "./messageUtils";

const DEBOUNCE_MS = 300;

export class ConversationStore {
	private plugin: PythiaPlugin;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private dirtyIds = new Set<string>();

	constructor(plugin: PythiaPlugin) {
		this.plugin = plugin;
	}

	getAll(): Conversation[] {
		return this.plugin.conversations;
	}

	getById(id: string): Conversation | undefined {
		return this.plugin.conversations.find((c) => c.id === id);
	}

	/** Returns true if any conversation has been modified since the last persist. */
	hasDirty(): boolean {
		return this.dirtyIds.size > 0;
	}

	/** Clears the dirty set — called by persistData after a successful write. */
	clearDirty(): void {
		this.dirtyIds.clear();
	}

	/** Marks a conversation as dirty without triggering a persist — used when a new
	 *  conversation is created externally and added to the array. */
	markDirty(id: string): void {
		this.dirtyIds.add(id);
	}

	async save(conversation: Conversation): Promise<void> {
		const idx = this.plugin.conversations.findIndex((c) => c.id === conversation.id);
		if (idx < 0) {
			// The conversation was deleted (e.g. by the user, while a stream or
			// backfill for it was still in flight) — do not resurrect it.
			debugLog(this.plugin.settings, "save() skipped — conversation no longer exists:", conversation.id);
			return;
		}
		conversation.updatedAt = new Date().toISOString();
		this.plugin.conversations[idx] = conversation;
		this.dirtyIds.add(conversation.id);
		this.schedulePersist();
	}

	async delete(id: string): Promise<void> {
		this.plugin.conversations = this.plugin.conversations.filter((c) => c.id !== id);
		this.dirtyIds.delete(id);
		this.cancelPersist();
		await this.plugin.saveConversations();
	}

	async flush(): Promise<void> {
		this.cancelPersist();
		await this.plugin.saveConversations();
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
