import { TFile, type EventRef, type TAbstractFile, type Vault } from "obsidian";

/**
 * What Pythia keeps in step with the vault, lifted out of `main.ts`
 * (engineering-review #366): the glossary cache and the note paths stored in
 * conversations and settings.
 *
 * It used to feed Pythia's own vault index as well, batched and debounced, with
 * the note being written held back (ADR-121, ADR-220). The index went with the
 * model to Schreibstube (ADR-224), and what is left needs no batching: a
 * glossary edit takes effect at once, and a rename is followed at once, so a
 * tap on a chip never opens the old path.
 */

export interface VaultWatcherHost {
	app: { vault: Vault };
	/** Obsidian's own registration, so every listener dies with the plugin. */
	registerEvent(ref: EventRef): void;
}

export interface VaultWatcherDeps {
	/** A glossary note changed or vanished: drop the cached entries so editing one
	 *  by hand takes effect without a reload, and a deleted term stops marking
	 *  itself now rather than at the next edit (ADR-136). */
	invalidateGlossary(path: string): void;
	/** A note or folder moved: stored paths follow it (ADR-218). */
	followRename(oldPath: string, newPath: string): void;
}

/** Only a note can be a glossary note, so nothing else is worth asking about. */
const isNote = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === "md";

/** Register the vault listeners. One call from `onload`; each is registered for teardown. */
export function registerVaultWatcher(host: VaultWatcherHost, deps: VaultWatcherDeps): void {
	const vault = host.app.vault;
	const onEdit = (f: TAbstractFile): void => {
		if (isNote(f)) deps.invalidateGlossary(f.path);
	};
	host.registerEvent(vault.on("modify", onEdit));
	host.registerEvent(vault.on("create", onEdit));
	host.registerEvent(vault.on("delete", (f) => {
		if (f instanceof TFile) deps.invalidateGlossary(f.path);
	}));
	host.registerEvent(vault.on("rename", (f, oldPath) => {
		deps.followRename(oldPath, f.path);
		deps.invalidateGlossary(oldPath);
		onEdit(f);
	}));
}
