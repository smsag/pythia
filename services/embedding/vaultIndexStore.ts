import { normalizePath, type Plugin } from "obsidian";
import type { IndexStore } from "./ConversationIndexService";
import type { EmbeddingModelId } from "../../models/embeddingModels";

/**
 * Persists the conversation vector index as a binary file in the plugin directory,
 * keyed by model id (`related-embeddings-<modelId>.bin`) so switching models uses a
 * separate index rather than mixing incompatible vectors — the same scheme
 * obsidian-similarity uses.
 */
export class VaultIndexStore implements IndexStore {
	private readonly dir: string;
	private readonly path: string;

	constructor(private readonly plugin: Plugin, modelId: EmbeddingModelId) {
		this.dir = normalizePath(
			plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
		);
		this.path = normalizePath(`${this.dir}/related-embeddings-${modelId}.bin`);
	}

	async read(): Promise<ArrayBuffer | null> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(this.path))) return null;
		return adapter.readBinary(this.path);
	}

	async write(buf: ArrayBuffer): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
		await adapter.writeBinary(this.path, buf);
	}
}
