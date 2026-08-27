import { App, TFile, TFolder, setIcon } from "obsidian";
import { getFilesInFolder } from "../utils";
import { scoreRelevanceTokensWeighted, tokenize } from "../services/noteRelevance";
import { t } from "../i18n";

// One row in the picker. Folders can be *drilled into* (ArrowRight / swipe-left /
// the trailing ›) to browse their contents in place, while still supporting
// attach-the-whole-folder on Enter/tap for backward compatibility. Inside a folder
// the list gains a "back" row and an explicit "attach all" row (ADR-097).
type Entry =
	| { kind: "back"; folder: TFolder }
	| { kind: "attach-all"; folder: TFolder; count: number }
	| { kind: "folder"; folder: TFolder }
	| { kind: "file"; file: TFile };

const SWIPE_THRESHOLD = 40; // px of horizontal travel to count as a drill/back swipe

export class InlineSuggest {
	private app: App;
	private inputEl: HTMLTextAreaElement;
	private containerEl: HTMLElement;
	private onAttach: (paths: string[]) => void;

	private hashPos: number | null = null;
	private dropdown: HTMLElement | null = null;
	private activeIdx = 0;
	private items: Entry[] = [];
	private outsideHandler: ((e: MouseEvent) => void) | null = null;

	// Drill-down state (Option A): the stack of folders the user has descended into.
	// Empty = the global search view; last element = the folder currently shown.
	private folderStack: TFolder[] = [];
	private query = "";
	private context = "";
	private touchStartX = 0;
	private touchStartY = 0;

	constructor(
		app: App,
		inputEl: HTMLTextAreaElement,
		containerEl: HTMLElement,
		onAttach: (paths: string[]) => void
	) {
		this.app = app;
		this.inputEl = inputEl;
		this.containerEl = containerEl;
		this.onAttach = onAttach;
	}

	/** Returns true if the event was consumed; caller should not process it further. */
	handleKeydown(e: KeyboardEvent): boolean {
		if (!this.dropdown) return false;
		switch (e.key) {
			case "ArrowDown": e.preventDefault(); this.move(1); return true;
			case "ArrowUp":   e.preventDefault(); this.move(-1); return true;
			case "ArrowRight": {
				// Drill into the highlighted folder; otherwise let the caret move.
				const active = this.items[this.activeIdx];
				if (active && active.kind === "folder") { e.preventDefault(); this.drillInto(active.folder); return true; }
				return false;
			}
			case "ArrowLeft": {
				// Step back up one level; at the top level let the caret move.
				if (this.folderStack.length > 0) { e.preventDefault(); this.goBack(); return true; }
				return false;
			}
			case "Enter":  e.preventDefault(); this.activate(this.items[this.activeIdx]); return true;
			case "Escape": e.preventDefault(); this.dismiss(); return true;
		}
		return false;
	}

	handleInput(): void {
		const val = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? val.length;

		let triggerPos: number | null = null;
		for (let i = cursor - 1; i >= 0; i--) {
			if (val[i] === "#") {
				if (i === 0 || /\s/.test(val[i - 1])) { triggerPos = i; break; }
			}
			if (/\s/.test(val[i])) break;
		}

		if (triggerPos === null) { this.dismiss(); return; }

		this.hashPos = triggerPos;
		// Text typed before the trigger — used to rank suggestions by relevance to
		// what the user is actually writing, not just the "#" fragment itself.
		this.context = val.slice(0, triggerPos);
		this.query = val.slice(triggerPos + 1, cursor);
		this.rebuild(false);
	}

	dismiss(): void {
		this.hashPos = null;
		this.activeIdx = 0;
		this.folderStack = [];
		this.query = "";
		this.context = "";
		if (this.dropdown) { this.dropdown.remove(); this.dropdown = null; }
		if (this.outsideHandler) {
			document.removeEventListener("mousedown", this.outsideHandler);
			this.outsideHandler = null;
		}
	}

	/** Cheap, cache-only text to rank a note against the user's in-progress message — no disk reads. */
	private noteHaystack(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const headings = cache?.headings?.map((h) => h.heading).join(" ") ?? "";
		const title = typeof cache?.frontmatter?.title === "string" ? cache.frontmatter.title : "";
		return `${file.basename} ${title} ${headings}`;
	}

	/** Build the flat search view (no folder drilled into). */
	private buildGlobalEntries(): Entry[] {
		const q = this.query.toLowerCase();

		const matchingFolders = this.app.vault.getAllFolders()
			.filter((f) => f.path !== "/" && (q === "" || f.path.toLowerCase().includes(q)))
			.sort((a, b) => {
				const aName = a.name.toLowerCase().includes(q);
				const bName = b.name.toLowerCase().includes(q);
				return (aName === bName) ? 0 : aName ? -1 : 1;
			})
			.slice(0, 3);

		// Filename match still gates and dominates ranking (typing a known name must find
		// it); relevance to the message-so-far is the tiebreaker, so when the "#" fragment
		// doesn't narrow things down (or several notes match it equally) the topically
		// relevant ones surface first instead of arbitrary vault order.
		const contextTokens = tokenize(this.context);
		const candidates = this.app.vault.getFiles()
			.filter((f) => f.extension === "md" || f.extension === "pdf")
			.filter((f) => q === "" || f.path.toLowerCase().includes(q));
		const scores = scoreRelevanceTokensWeighted(contextTokens, candidates.map((f) => this.noteHaystack(f)));
		const matchingFiles = candidates
			.map((f, i) => ({
				file: f,
				score: (f.basename.toLowerCase().includes(q) ? 1000 : 0) + scores[i],
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 8 - matchingFolders.length)
			.map((x) => x.file);

		return [
			...matchingFolders.map((folder): Entry => ({ kind: "folder", folder })),
			...matchingFiles.map((file): Entry => ({ kind: "file", file })),
		];
	}

	/** Build the browse view for a drilled-into folder: back + attach-all + contents. */
	private buildFolderEntries(folder: TFolder): Entry[] {
		const q = this.query.toLowerCase();

		const subs = folder.children
			.filter((c): c is TFolder => c instanceof TFolder)
			.filter((f) => q === "" || f.name.toLowerCase().includes(q))
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, 10);

		const files = folder.children
			.filter((c): c is TFile => c instanceof TFile && (c.extension === "md" || c.extension === "pdf"))
			.filter((f) => q === "" || f.basename.toLowerCase().includes(q))
			.sort((a, b) => a.basename.localeCompare(b.basename))
			.slice(0, 20 - subs.length);

		const entries: Entry[] = [
			{ kind: "back", folder },
			{ kind: "attach-all", folder, count: getFilesInFolder(folder).length },
			...subs.map((sub): Entry => ({ kind: "folder", folder: sub })),
			...files.map((file): Entry => ({ kind: "file", file })),
		];
		return entries;
	}

	/** Recompute the item list for the current level and (re)render the dropdown. */
	private rebuild(focusContent: boolean): void {
		const folder = this.folderStack[this.folderStack.length - 1] ?? null;
		this.items = folder ? this.buildFolderEntries(folder) : this.buildGlobalEntries();

		// A drilled-in folder always carries back + attach-all rows, so it never
		// empties; only the global view can dismiss on no matches.
		if (this.items.length === 0) { this.dismiss(); return; }

		if (!this.dropdown) {
			this.dropdown = this.containerEl.createDiv({ cls: "pythia-inline-suggest" });
			this.outsideHandler = (e: MouseEvent) => {
				if (!this.dropdown?.contains(e.target as Node) && e.target !== this.inputEl) {
					this.dismiss();
				}
			};
			document.addEventListener("mousedown", this.outsideHandler);
			// Mobile: horizontal swipe drills in / back, mirroring ArrowRight / ArrowLeft.
			this.dropdown.addEventListener("touchstart", (e) => {
				this.touchStartX = e.touches[0].clientX;
				this.touchStartY = e.touches[0].clientY;
			}, { passive: true });
			this.dropdown.addEventListener("touchend", (e) => this.onTouchEnd(e));
		}

		if (focusContent) {
			// After drilling in, land on the first real entry (skip back / attach-all)
			// so the next Enter attaches or drills content, not "go back".
			const first = this.items.findIndex((e) => e.kind === "folder" || e.kind === "file");
			this.activeIdx = first === -1 ? 0 : first;
		} else {
			this.activeIdx = Math.max(0, Math.min(this.activeIdx, this.items.length - 1));
		}
		this.render();
	}

	private render(): void {
		if (!this.dropdown) return;
		this.dropdown.empty();
		let activeRow: HTMLElement | null = null;
		for (let i = 0; i < this.items.length; i++) {
			const entry = this.items[i];
			const row = this.dropdown.createDiv({
				cls: i === this.activeIdx
					? "pythia-suggest-item pythia-suggest-item--active"
					: "pythia-suggest-item",
			});
			if (i === this.activeIdx) activeRow = row;
			this.renderEntry(row, entry);
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.activeIdx = i;
				this.activate(entry);
			});
		}
		// The dropdown is a fixed-height scroll container (max-height + overflow-y),
		// so with more matches than fit, arrow-key navigation must scroll the active
		// row back into view — otherwise the selection moves out of sight. Adjust the
		// dropdown's own scrollTop directly (rather than scrollIntoView, which would
		// hunt for the wrong scroll ancestor and could nudge the whole panel).
		if (activeRow) {
			const box = this.dropdown;
			const top = activeRow.offsetTop;
			const bottom = top + activeRow.offsetHeight;
			if (top < box.scrollTop) box.scrollTop = top;
			else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
		}
	}

	/** Draw a single row's icon, label, and (for folders) the drill affordance. */
	private renderEntry(row: HTMLElement, entry: Entry): void {
		const iconEl = row.createSpan({ cls: "pythia-suggest-icon" });
		switch (entry.kind) {
			case "back": {
				row.addClass("pythia-suggest-nav");
				setIcon(iconEl, "chevron-left");
				row.setAttr("aria-label", t("inlineBackTooltip"));
				row.createSpan({ cls: "pythia-suggest-name", text: entry.folder.name });
				break;
			}
			case "attach-all": {
				row.addClass("pythia-suggest-nav");
				setIcon(iconEl, "copy-plus");
				row.createSpan({ cls: "pythia-suggest-name", text: t("inlineAttachAll", { count: entry.count }) });
				break;
			}
			case "folder": {
				setIcon(iconEl, "folder");
				row.createSpan({ cls: "pythia-suggest-name", text: entry.folder.name });
				// Trailing › — signals "drillable" and gives mouse-only users a target
				// (row body attaches the whole folder; the chevron opens it).
				const drill = row.createSpan({ cls: "pythia-suggest-drill", attr: { "aria-label": t("inlineDrillTooltip") } });
				setIcon(drill, "chevron-right");
				drill.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.drillInto(entry.folder);
				});
				break;
			}
			case "file": {
				setIcon(iconEl, "file");
				row.createSpan({ cls: "pythia-suggest-name", text: entry.file.basename });
				const folder = entry.file.parent?.path ?? "";
				if (folder && folder !== "/") {
					row.createSpan({ cls: "pythia-suggest-folder", text: folder });
				}
				break;
			}
		}
	}

	/** Enter / tap: choose the entry (files attach, folders attach-all, nav rows navigate). */
	private activate(entry?: Entry): void {
		if (!entry) { this.dismiss(); return; }
		switch (entry.kind) {
			case "back":       this.goBack(); break;
			case "attach-all": this.attach(getFilesInFolder(entry.folder).map((f) => f.path)); break;
			// Enter/tap on a folder keeps the pre-drill behaviour of attaching the whole
			// folder; drilling in is ArrowRight / swipe-left / the › chevron.
			case "folder":     this.attach(getFilesInFolder(entry.folder).map((f) => f.path)); break;
			case "file":       this.attach([entry.file.path]); break;
		}
	}

	private drillInto(folder: TFolder): void {
		this.folderStack.push(folder);
		this.clearFragment(); // typed text now filters *within* the folder
		this.query = "";
		this.rebuild(true);
	}

	private goBack(): void {
		if (this.folderStack.length === 0) { this.dismiss(); return; }
		this.folderStack.pop();
		this.clearFragment();
		this.query = "";
		this.rebuild(false);
	}

	/**
	 * Remove any text typed after the "#" so each drill level starts with an empty
	 * filter (the fragment that matched the folder name would match nothing inside
	 * it). Leaves the "#" itself in place so continued typing re-triggers normally.
	 */
	private clearFragment(): void {
		if (this.hashPos === null) return;
		const val = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? val.length;
		const keepFrom = this.hashPos + 1;
		if (cursor > keepFrom) {
			this.inputEl.value = val.slice(0, keepFrom) + val.slice(cursor);
			this.inputEl.setSelectionRange(keepFrom, keepFrom);
		}
	}

	private onTouchEnd(e: TouchEvent): void {
		const touch = e.changedTouches[0];
		if (!touch) return;
		const dx = touch.clientX - this.touchStartX;
		const dy = touch.clientY - this.touchStartY;
		if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return; // not a horizontal swipe
		e.preventDefault();
		if (dx < 0) {
			// Swipe left = drill into the highlighted folder (content pushes in from the right).
			const active = this.items[this.activeIdx];
			if (active && active.kind === "folder") this.drillInto(active.folder);
		} else if (this.folderStack.length > 0) {
			// Swipe right = back up a level.
			this.goBack();
		}
	}

	private attach(paths: string[]): void {
		if (this.hashPos === null || paths.length === 0) { this.dismiss(); return; }

		const val = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? val.length;
		this.inputEl.value = val.slice(0, this.hashPos) + val.slice(cursor);
		this.inputEl.setSelectionRange(this.hashPos, this.hashPos);

		this.onAttach(paths);
		this.dismiss();
	}

	private move(delta: number): void {
		if (!this.dropdown || this.items.length === 0) return;
		this.activeIdx = (this.activeIdx + delta + this.items.length) % this.items.length;
		this.render();
	}
}
