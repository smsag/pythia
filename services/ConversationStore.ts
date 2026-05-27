import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";

const DEBOUNCE_MS = 300;

export class ConversationStore {
	private plugin: PythiaPlugin;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(plugin: PythiaPlugin) {
		this.plugin = plugin;
	}

	getAll(): Conversation[] {
		return this.plugin.conversations;
	}

	getById(id: string): Conversation | undefined {
		return this.plugin.conversations.find((c) => c.id === id);
	}

	async save(conversation: Conversation): Promise<void> {
		conversation.updatedAt = new Date().toISOString();
		const idx = this.plugin.conversations.findIndex((c) => c.id === conversation.id);
		if (idx >= 0) {
			this.plugin.conversations[idx] = conversation;
		} else {
			this.plugin.conversations.push(conversation);
		}
		this.schedulePersist();
	}

	async delete(id: string): Promise<void> {
		this.plugin.conversations = this.plugin.conversations.filter((c) => c.id !== id);
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
