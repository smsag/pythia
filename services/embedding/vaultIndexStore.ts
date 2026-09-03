import { normalizePath, type Plugin } from "obsidian";
import type { IndexStore } from "./ConversationIndexService";
import type { EmbeddingModelId } from "../../models/embeddingModels";

/**
 * Persists a vector index as a binary file in the plugin directory, keyed by
 * `<prefix>-<modelId>.bin` so switching models uses a separate index rather than
 * mixing incompatible vectors — the same scheme obsidian-similarity uses. The
 * `prefix` also separates independent indexes that share the format: the
 * conversation "related" index (default `related-embeddings`) and the vault-RAG
 * note index (`vault-embeddings`, ADR-116).
 */
export class VaultIndexStore implements IndexStore {
	private readonly dir: string;
	private readonly path: string;

	constructor(private readonly plugin: Plugin, modelId: EmbeddingModelId, prefix = "related-embeddings") {
		this.dir = normalizePath(
			plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
		);
		this.path = normalizePath(`${this.dir}/${prefix}-${modelId}.bin`);
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
