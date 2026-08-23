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

		const fmRx = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

		const newFmMatch = content.match(fmRx);
		const curFmMatch = current.match(fmRx);

		let updated: string;

		if (newFmMatch && curFmMatch) {
			// Both have frontmatter — merge new fields into existing, then prepend body
			const mergedFields = this.mergeFrontmatterFields(curFmMatch[1], newFmMatch[1]);
			updated = `---\n${mergedFields}---\n${newFmMatch[2].trimStart()}\n\n---\n\n${curFmMatch[2]}`;
		} else if (newFmMatch && !curFmMatch) {
			// New content has frontmatter, doc does not — place it at the top
			updated = `---\n${newFmMatch[1]}\n---\n${newFmMatch[2].trimStart()}\n\n---\n\n${current}`;
		} else if (!newFmMatch && curFmMatch) {
			// Doc has frontmatter, new content does not — insert body after existing frontmatter
			updated = `---\n${curFmMatch[1]}\n---\n${content}\n\n---\n\n${curFmMatch[2]}`;
		} else {
			// Neither has frontmatter
			updated = current ? `${content}\n\n---\n\n${current}` : content;
		}

		return this.writeNote(updated, filePath);
	}

	/** Splits frontmatter text into per-key blocks, keyed by the top-level field
	 *  name — each block includes the `key:` line plus any indented continuation
	 *  lines that belong to it (YAML list items, block scalars, nested maps). */
	private splitFrontmatterFields(text: string): Map<string, string[]> {
		const blocks = new Map<string, string[]>();
		let currentKey: string | null = null;
		for (const line of text.split("\n")) {
			const key = line.match(/^([^#\s][^:]*?):/)?.[1]?.trim();
			if (key) {
				currentKey = key;
				blocks.set(key, [line]);
			} else if (currentKey) {
				blocks.get(currentKey)!.push(line);
			}
		}
		return blocks;
	}

	private mergeFrontmatterFields(existing: string, incoming: string): string {
		const existingBlocks = this.splitFrontmatterFields(existing);
		const incomingBlocks = this.splitFrontmatterFields(incoming);

		// Add full blocks (key line + any continuation lines) from incoming
		// whose key is absent from existing — a multi-line value (list, block
		// scalar) must carry its continuation lines along, not just the `key:` line.
		const toAdd: string[] = [];
		for (const [key, lines] of incomingBlocks) {
			if (!existingBlocks.has(key)) toAdd.push(...lines);
		}

		const base = existing.endsWith("\n") ? existing : existing + "\n";
		return toAdd.length > 0 ? base + toAdd.join("\n") + "\n" : base;
	}

	/** Deep link that reopens Pythia with the given conversation active when clicked. */
	private resumeUri(conversationId: string): string {
		const vaultName = encodeURIComponent(this.app.vault.getName());
		return `obsidian://pythia?vault=${vaultName}&cmd=resume&id=${encodeURIComponent(conversationId)}`;
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
type: "LLM Note"
template: ${conversation.templateId ?? "none"}
created: ${todayISO()}
source: "${this.resumeUri(conversation.id)}"
context:
${contextList}
---

## Summary
${summary}${outputSection}
`;

		const file = await this.writeNote(noteContent, filePath);
		return file.path;
	}

	async saveFavoritesSummaryNote(
		conversation: Conversation,
		summary: string
	): Promise<string> {
		const safeName = conversation.name.replace(/[\\/:*?"<>|]/g, "-");
		const filePath = `${this.settings.conversationsFolder}/${todayISO()}-${safeName}-favorites.md`;

		const noteContent = `---
type: "LLM Note"
created: ${todayISO()}
source: "${this.resumeUri(conversation.id)}"
---

## Favorites summary
${summary}
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
			const frontmatter = `---\nsource: "${this.resumeUri(conversationId)}"\n---\n\n`;
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
