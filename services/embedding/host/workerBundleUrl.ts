import { normalizePath, type Plugin } from "obsidian";
import { getEmbeddingBundle } from "./embeddingBundle";
import { withWorkerPrelude } from "./workerPrelude";

/**
 * Write the embedding worker bundle to the plugin folder (once per version) and
 * return a same-origin resource-path URL for it — the blob-free way to start a
 * Worker where `blob:` URLs are blocked (Obsidian mobile, capacitor:// desktop
 * builds; ADR-126). The bundle is the same one inlined in main.js
 * (`getEmbeddingBundle`), so the worker and the iframe never diverge — with the
 * Worker prelude in front of it, as for the blob Worker (#306).
 *
 * Memoize the returned promise at the call site: writing the file is idempotent
 * but pointless to repeat.
 */
export async function embeddingWorkerUrl(plugin: Plugin): Promise<string> {
	const adapter = plugin.app.vault.adapter;
	const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	// `-p1`: the file now carries the #306 prelude; a same-version file written
	// before it must not be reused.
	const path = normalizePath(`${dir}/embedding-worker-${plugin.manifest.version}-p1.mjs`);
	if (!(await adapter.exists(path))) {
		await adapter.write(path, withWorkerPrelude(getEmbeddingBundle()));
		// Best-effort: drop stale worker bundles from older plugin versions. A
		// failure here leaves a few dead files behind and nothing else, which is
		// why it is the rare catch that may stay silent.
		try {
			const listing = await adapter.list(dir);
			for (const f of listing.files) {
				if (/\/embedding-worker-.*\.mjs$/.test(f) && f !== path) await adapter.remove(f);
			}
		} catch { /* cleanup is best-effort; a stale bundle costs disk, not correctness */ }
	}
	return adapter.getResourcePath(path);
}
