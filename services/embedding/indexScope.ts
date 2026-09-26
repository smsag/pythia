// Pure folder-scope + note-cap selection for the vault index (ADR-119/120).
// Kept separate from the Obsidian-bound VaultRagService so the decision logic is
// unit-testable without a vault.

export interface IndexScopeOptions {
	/** Normalized include folders (no trailing slash). Empty = the whole vault. */
	include: string[];
	/** Normalized skip folders (Pythia's own conversations/scratch). */
	skip: string[];
	/** Max notes to index. 0 = unlimited. Protects large vaults from an
	 *  over-large index / build (ADR-120). */
	cap: number;
}

export interface IndexScopeResult {
	/** Selected paths, capped to `cap`. */
	paths: string[];
	/** In-scope count BEFORE the cap (for the "indexing N of M" warning). */
	total: number;
	/** Whether the cap trimmed the selection. */
	capped: boolean;
}

/** True when `path` is inside an include folder (or none is configured) and
 *  outside every skip folder. Folders are matched as path prefixes, so
 *  "Insights" matches "Insights/x.md" but not "Insights-old/y.md". */
export function isPathInScope(path: string, include: string[], skip: string[]): boolean {
	const under = (p: string, f: string) => p === f || p.startsWith(f + "/");
	return (include.length === 0 || include.some((f) => under(path, f))) && !skip.some((f) => under(path, f));
}

/** Select which vault paths to index: those inside an include folder (or all,
 *  when none is configured) and outside every skip folder, trimmed to `cap`. */
export function selectIndexPaths(allPaths: string[], opts: IndexScopeOptions): IndexScopeResult {
	const scoped = allPaths.filter((p) => isPathInScope(p, opts.include, opts.skip));
	const capped = opts.cap > 0 && scoped.length > opts.cap;
	return {
		paths: capped ? scoped.slice(0, opts.cap) : scoped,
		total: scoped.length,
		capped,
	};
}

/**
 * What this index is an index OF (ADR-184): the folders, the skip folders, the
 * note cap and the model. Persisted with the rows, so a session that starts
 * with different settings can tell the file no longer matches them.
 *
 * Narrowing `vaultContextFolders` is the case that matters: until the index is
 * rebuilt it still holds notes that are now out of scope, and retrieval would
 * keep inlining them into prompts. That is a privacy decision the user made
 * and the index has to honour.
 */
export function scopeSignature(
	s: { vaultContextFolders: string[]; conversationsFolder: string; scratchFolder: string; vaultContextMaxIndexedNotes: number },
	/** The model's vector FAMILY, not the variant (ADR-200): the desktop's index
	 *  must read as complete on a phone running the vector-identical variant. */
	family: string,
): string {
	const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
	const folders = [...s.vaultContextFolders].map(norm).filter(Boolean).sort();
	const skip = [s.conversationsFolder, s.scratchFolder].map(norm).filter(Boolean).sort();
	return JSON.stringify([folders, skip, s.vaultContextMaxIndexedNotes, family]);
}
