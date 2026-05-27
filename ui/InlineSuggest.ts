import { App, TFile, TFolder, setIcon } from "obsidian";
import { getFilesInFolder } from "../utils";

export class InlineSuggest {
	private app: App;
	private inputEl: HTMLTextAreaElement;
	private containerEl: HTMLElement;
	private onAttach: (paths: string[]) => void;

	private hashPos: number | null = null;
	private dropdown: HTMLElement | null = null;
	private activeIdx = 0;
	private items: (TFile | TFolder)[] = [];
	private outsideHandler: ((e: MouseEvent) => void) | null = null;

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
		if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); return true; }
		if (e.key === "ArrowUp")   { e.preventDefault(); this.move(-1); return true; }
		if (e.key === "Enter")     { e.preventDefault(); this.commit(); return true; }
		if (e.key === "Escape")    { e.preventDefault(); this.dismiss(); return true; }
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
		this.show(val.slice(triggerPos + 1, cursor));
	}

	dismiss(): void {
		this.hashPos = null;
		this.activeIdx = 0;
		if (this.dropdown) { this.dropdown.remove(); this.dropdown = null; }
		if (this.outsideHandler) {
			document.removeEventListener("mousedown", this.outsideHandler);
			this.outsideHandler = null;
		}
	}

	private show(query: string): void {
		const q = query.toLowerCase();

		const matchingFolders = this.app.vault.getAllFolders()
			.filter((f) => f.path !== "/" && (q === "" || f.path.toLowerCase().includes(q)))
			.sort((a, b) => {
				const aName = a.name.toLowerCase().includes(q);
				const bName = b.name.toLowerCase().includes(q);
				return (aName === bName) ? 0 : aName ? -1 : 1;
			})
			.slice(0, 3);

		const matchingFiles = this.app.vault.getMarkdownFiles()
			.filter((f) => q === "" || f.path.toLowerCase().includes(q))
			.sort((a, b) => {
				const aName = a.basename.toLowerCase().includes(q);
				const bName = b.basename.toLowerCase().includes(q);
				return (aName === bName) ? 0 : aName ? -1 : 1;
			})
			.slice(0, 8 - matchingFolders.length);

		this.items = [...matchingFolders, ...matchingFiles];

		if (this.items.length === 0) { this.dismiss(); return; }

		if (!this.dropdown) {
			this.dropdown = this.containerEl.createDiv({ cls: "pythia-inline-suggest" });
			this.outsideHandler = (e: MouseEvent) => {
				if (!this.dropdown?.contains(e.target as Node) && e.target !== this.inputEl) {
					this.dismiss();
				}
			};
			document.addEventListener("mousedown", this.outsideHandler);
		}

		this.activeIdx = Math.min(this.activeIdx, Math.max(0, this.items.length - 1));
		this.render();
	}

	private render(): void {
		if (!this.dropdown) return;
		this.dropdown.empty();
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			const isFolder = item instanceof TFolder;
			const row = this.dropdown.createDiv({
				cls: i === this.activeIdx
					? "pythia-suggest-item pythia-suggest-item--active"
					: "pythia-suggest-item",
			});
			const iconEl = row.createSpan({ cls: "pythia-suggest-icon" });
			setIcon(iconEl, isFolder ? "folder" : "file");
			row.createSpan({ cls: "pythia-suggest-name", text: isFolder ? item.name : (item as TFile).basename });
			const folder = isFolder ? item.path : ((item as TFile).parent?.path ?? "");
			if (folder && folder !== "/") {
				row.createSpan({ cls: "pythia-suggest-folder", text: folder });
			}
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.activeIdx = i;
				this.commit();
			});
		}
	}

	private move(delta: number): void {
		if (!this.dropdown || this.items.length === 0) return;
		this.activeIdx = (this.activeIdx + delta + this.items.length) % this.items.length;
		this.render();
	}

	private commit(): void {
		const item = this.items[this.activeIdx];
		if (!item || this.hashPos === null) { this.dismiss(); return; }

		const val = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? val.length;
		this.inputEl.value = val.slice(0, this.hashPos) + val.slice(cursor);
		this.inputEl.setSelectionRange(this.hashPos, this.hashPos);

		const paths = item instanceof TFolder
			? getFilesInFolder(item).map((f) => f.path)
			: [item.path];
		this.onAttach(paths);
		this.dismiss();
	}
}
