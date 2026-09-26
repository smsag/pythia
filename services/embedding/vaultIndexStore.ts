import { normalizePath, type Plugin } from "obsidian";
import type { IndexStore } from "./ConversationIndexService";
import { vectorFamily, type EmbeddingModelId } from "../../models/embeddingModels";

/**
 * Persists a vector index as a binary file in the plugin directory, keyed by
 * `<prefix>-<modelId>.bin` so switching models uses a separate index rather than
 * mixing incompatible vectors — the same scheme obsidian-similarity uses. The
 * `prefix` also separates independent indexes that share the format: the
 * conversation "related" index (default `related-embeddings`) and the vault-RAG
 * note index (`vault-embeddings`, ADR-116).
 *
 * The name carries the model's VECTOR FAMILY, not the variant (ADR-200): a phone
 * on the Latin-script variant produces the full model's vectors, so it reads —
 * and keeps fresh — the index the desktop built, instead of building its own.
 */
export class VaultIndexStore implements IndexStore {
	private readonly dir: string;
	private readonly path: string;

	constructor(
		private readonly plugin: Plugin,
		private readonly modelId: EmbeddingModelId,
		private readonly prefix = "related-embeddings",
		/** `.bin` for the index, `.journal.bin` for its journal (ADR-221). */
		suffix = ".bin",
	) {
		this.dir = normalizePath(
			plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
		);
		this.path = normalizePath(`${this.dir}/${prefix}-${vectorFamily(modelId)}${suffix}`);
	}

	/** The journal beside this index: the rows changed since it was written (ADR-221). */
	journal(): IndexStore {
		return new VaultIndexStore(this.plugin, this.modelId, this.prefix, ".journal.bin");
	}

	/** Whether an index has been built, WITHOUT reading it.
	 *
	 *  `read()` returns the whole binary — several megabytes on a large vault
	 *  (one Int8 vector per chunk) — and the background warm only needs to know
	 *  whether the file is there. Reading and discarding it at every launch was
	 *  the cost this method exists to avoid. */
	async exists(): Promise<boolean> {
		return this.plugin.app.vault.adapter.exists(this.path);
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
