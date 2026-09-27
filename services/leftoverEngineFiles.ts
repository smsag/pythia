import { describeErrorForLog } from "./redact";

/**
 * The files Pythia's own embedding engine wrote into the plugin folder, which
 * nothing reads since ADR-224 moved search by meaning to Schreibstube (ADR-237).
 *
 * `vault-embeddings-<family>.bin` and `related-embeddings-<family>.bin` are the two
 * indexes, each with a `.journal.bin` beside it; `embedding-worker-<version>-<hash>.mjs`
 * is the Worker bundle. A large vault's index runs to tens of megabytes, and a
 * synced vault carries them to every device. Matched by name, directly inside the
 * plugin folder only: anything in a subfolder or with another name is not ours
 * to remove.
 */
const LEFTOVER = [/^(?:vault|related)-embeddings-[^/]+\.bin$/, /^embedding-worker-[^/]+\.m?js$/];

/** Whether `path` is a file the removed engine left directly inside `dir`. */
export function isLeftoverEngineFile(path: string, dir: string): boolean {
	const prefix = dir.replace(/\/+$/, "") + "/";
	if (!path.startsWith(prefix)) return false;
	const name = path.slice(prefix.length);
	return LEFTOVER.some((re) => re.test(name));
}

export interface LeftoverAdapter {
	exists(path: string): Promise<boolean>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
}

/**
 * Remove the removed engine's files from the plugin folder; returns what went.
 *
 * Deliberately not the model download: transformers.js kept it in the browser's
 * Cache Storage, which Pythia shares with every plugin on the same origin, and
 * Schreibstube reads the same model from it.
 */
export async function removeLeftoverEngineFiles(
	adapter: LeftoverAdapter,
	dir: string,
	log: (message: string) => void
): Promise<string[]> {
	if (!(await adapter.exists(dir))) return [];
	const { files } = await adapter.list(dir);
	const removed: string[] = [];
	for (const path of files.filter((f) => isLeftoverEngineFile(f, dir))) {
		try {
			await adapter.remove(path);
			removed.push(path);
		} catch (e) {
			// Left for the next start; a file another device is syncing in can refuse.
			log(`could not remove the old index file ${path}: ${describeErrorForLog(e)}`);
		}
	}
	if (removed.length > 0) log(`removed ${removed.length} file(s) of the former embedding engine`);
	return removed;
}
