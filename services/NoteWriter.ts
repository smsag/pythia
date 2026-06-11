import { App, TFile } from "obsidian";
import type { Conversation, Message } from "../models/types";
import type { PythiaSettings } from "../settings";
import { todayISO } from "../utils";

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

	async prependWithSeparator(content: string, filePath: string): Promise<TFile> {
		const normalized = filePath.replace(/\\/g, "/");
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		const current =
			existing instanceof TFile ? await this.app.vault.read(existing) : "";

		// Preserve YAML frontmatter at the top — Obsidian only recognises it there.
		// Insert the new content after the closing --- of the frontmatter block.
		const fmMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
		let updated: string;
		if (fmMatch) {
			const frontmatter = fmMatch[0];
			const body = current.slice(frontmatter.length);
			updated = `${frontmatter}${content}\n\n---\n\n${body}`;
		} else {
			updated = current ? `${content}\n\n---\n\n${current}` : content;
		}

		return this.writeNote(updated, filePath);
	}

	async saveSummaryNote(
		conversation: Conversation,
		summary: string,
		outputPath?: string
	): Promise<string> {
		const safeName = conversation.name.replace(/[\\/:*?"<>|]/g, "-");
		const filePath = `${this.settings.conversationsFolder}/${todayISO()}-${safeName}.md`;

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
created: ${todayISO()}
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

	async appendConversationSlice(messages: Message[], filePath: string, conversationId?: string): Promise<void> {
		const now = new Date();
		const dd = String(now.getDate()).padStart(2, "0");
		const mm = String(now.getMonth() + 1).padStart(2, "0");
		const yyyy = now.getFullYear();
		const hh = String(now.getHours()).padStart(2, "0");
		const min = String(now.getMinutes()).padStart(2, "0");
		const heading = `## ${dd}.${mm}.${yyyy}, ${hh}:${min}`;

		const lines: string[] = [heading, ""];
		for (const msg of messages) {
			const label = msg.role === "user" ? "**You:**" : "**Pythia:**";
			lines.push(`${label} ${msg.content}`, "");
		}
		const block = lines.join("\n").trimEnd();

		const normalized = filePath.replace(/\\/g, "/");
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		const current = existing instanceof TFile ? await this.app.vault.read(existing) : "";

		if (!current && conversationId) {
			const vaultName = encodeURIComponent(this.app.vault.getName());
			const resumeUri = `obsidian://pythia?vault=${vaultName}&cmd=resume&id=${conversationId}`;
			const frontmatter = `---\npythia: "${resumeUri}"\n---\n\n`;
			await this.writeNote(frontmatter + block, filePath);
		} else {
			await this.writeNote(current ? current + "\n\n" + block : block, filePath);
		}
	}

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
