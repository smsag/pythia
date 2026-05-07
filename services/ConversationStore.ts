import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";

export class ConversationStore {
	private plugin: PythiaPlugin;

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
		const idx = this.plugin.conversations.findIndex(
			(c) => c.id === conversation.id
		);
		if (idx >= 0) {
			this.plugin.conversations[idx] = conversation;
		} else {
			this.plugin.conversations.push(conversation);
		}
		await this.plugin.saveConversations();
	}

	async delete(id: string): Promise<void> {
		this.plugin.conversations = this.plugin.conversations.filter(
			(c) => c.id !== id
		);
		await this.plugin.saveConversations();
	}
}
