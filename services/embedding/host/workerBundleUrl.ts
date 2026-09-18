import { normalizePath, type Plugin } from "obsidian";
import { workerSource } from "./embeddingBundle";
import { conversationContentHash } from "../embeddingIndex";

/**
 * Write the embedding worker bundle to the plugin folder (once per version) and
 * return a same-origin resource-path URL for it — the blob-free way to start a
 * Worker where `blob:` URLs are blocked (Obsidian mobile, capacitor:// desktop
 * builds; ADR-126). The bundle is the same one inlined in main.js
 * (`getEmbeddingBundle`), so the worker and the iframe never diverge.
 *
 * Memoize the returned promise at the call site: writing the file is idempotent
 * but pointless to repeat.
 */
export async function embeddingWorkerUrl(plugin: Plugin): Promise<string> {
	const adapter = plugin.app.vault.adapter;
	const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	const source = workerSource();
	// Fingerprint the CONTENT, not just the version: the file is only written when
	// it is absent, so a same-version rebuild (every dev iteration, and any hotfix
	// that ships under an unchanged version) would otherwise keep serving stale
	// worker code — including a build from before the ADR-179 prefix existed.
	// `conversationContentHash` is a generic FNV-1a over strings despite its name;
	// a second hash implementation here would be a second source of truth.
	const fingerprint = conversationContentHash([source]);
	const path = normalizePath(`${dir}/embedding-worker-${plugin.manifest.version}-${fingerprint}.mjs`);
	if (!(await adapter.exists(path))) {
		await adapter.write(path, source);
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
