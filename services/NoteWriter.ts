import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";

export class NoteWriter {
	private app: App;
	private settings: PythiaSettings;

	constructor(app: App, settings: PythiaSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
	}

	/** Write content to a vault path, creating folders and overwriting if it exists. */
	async writeNote(content: string, filePath: string): Promise<TFile> {
		// Reject path traversal attempts (e.g. "../../.obsidian/plugins/…")
		const normalized = filePath.replace(/\\/g, "/");
		if (normalized.split("/").some((seg) => seg === "..")) {
			throw new Error(`Invalid file path: "${filePath}" contains path traversal segments.`);
		}

		const dir = normalized.includes("/")
			? normalized.substring(0, normalized.lastIndexOf("/"))
			: "";
		if (dir) await this.ensureFolder(dir);

		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return existing;
		}
		return this.app.vault.create(normalized, content);
	}

	/** Save a conversation summary note. Returns the vault path. */
	async saveSummaryNote(
		conversation: Conversation,
		summary: string,
		outputPath?: string
	): Promise<string> {
		const date = new Date().toISOString().slice(0, 10);
		const safeName = conversation.name.replace(/[\\/:*?"<>|]/g, "-");
		const filePath = `${this.settings.conversationsFolder}/${date}-${safeName}.md`;

		const contextList =
			conversation.contextNotes.length > 0
				? conversation.contextNotes.map((n) => `  - ${n}`).join("\n")
				: "  []";

		const outputSection = outputPath
			? `\n## Output\n[[${outputPath}]]`
			: "";

		const noteContent = `---
type: pythia-conversation
template: ${conversation.templateId ?? "none"}
created: ${date}
context_notes:
${contextList}
tags: [pythia]
---

## Summary
${summary}${outputSection}
`;

		const file = await this.writeNote(noteContent, filePath);
		return file.path;
	}

	/** Prepend a timestamped entry to the inbox note, creating it if needed. */
	async prependToInbox(text: string, inboxPath: string): Promise<void> {
		const now = new Date();
		const dd = String(now.getDate()).padStart(2, "0");
		const mm = String(now.getMonth() + 1).padStart(2, "0");
		const yy = String(now.getFullYear()).slice(2);
		const hh = String(now.getHours()).padStart(2, "0");
		const min = String(now.getMinutes()).padStart(2, "0");
		const timestamp = `${dd}.${mm}.${yy}, ${hh}:${min}`;

		const entry = `${timestamp}\n${text}\n\n---\n`;

		const normalized = inboxPath.replace(/\\/g, "/");
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		const currentContent =
			existing instanceof TFile
				? await this.app.vault.read(existing)
				: "";

		await this.writeNote(entry + currentContent, inboxPath);
	}

	/** Ensure all folders in a path exist, creating them recursively. */
	private async ensureFolder(folderPath: string): Promise<void> {
		const parts = folderPath.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const exists = this.app.vault.getAbstractFileByPath(current);
			if (!exists) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
