import { TFile, TFolder } from "obsidian";

export function getFilesInFolder(folder: TFolder): TFile[] {
	const results: TFile[] = [];
	const walk = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === "md") {
				results.push(child);
			} else if (child instanceof TFolder) {
				walk(child);
			}
		}
	};
	walk(folder);
	return results;
}

export function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}
