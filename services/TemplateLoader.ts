import { App, TFile, parseYaml } from "obsidian";
import type { PythiaTemplate, Provider } from "../models/types";
import type { PythiaSettings } from "../settings";

export class TemplateLoader {
	private app: App;
	private settings: PythiaSettings;

	constructor(app: App, settings: PythiaSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
	}

	async loadTemplates(): Promise<PythiaTemplate[]> {
		const folder = this.settings.templatesFolder;
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder));

		const templates: PythiaTemplate[] = [];
		for (const file of files) {
			const tpl = await this.loadTemplate(file);
			if (tpl) templates.push(tpl);
		}
		return templates;
	}

	async loadTemplate(file: TFile): Promise<PythiaTemplate | null> {
		try {
			const content = await this.app.vault.read(file);
			const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
			if (!match) return null;

			const fm = parseYaml(match[1]) as Record<string, unknown>;
			if (!fm.pythia_template) return null;

			const rawProvider = fm.provider;
			const validProvider: Provider | undefined =
				rawProvider === "anthropic" || rawProvider === "openai"
					? rawProvider
					: undefined;

			// Validate resumeMode against allowed values
			const rawResumeMode = fm.resume_mode;
			const validResumeMode: "full" | "summary" | undefined =
				rawResumeMode === "full" || rawResumeMode === "summary"
					? rawResumeMode
					: undefined;

			// Validate outputFolder — must be a string with no traversal segments
			const rawOutputFolder = fm.output_folder;
			const validOutputFolder: string | undefined =
				typeof rawOutputFolder === "string" &&
				!rawOutputFolder.replace(/\\/g, "/").split("/").some((s) => s === "..")
					? rawOutputFolder
					: undefined;

			// Validate contextNotes — must be an array of non-traversal strings
			const rawContextNotes = fm.context_notes;
			const validContextNotes: string[] = Array.isArray(rawContextNotes)
				? rawContextNotes.filter(
						(n): n is string =>
							typeof n === "string" &&
							!n.replace(/\\/g, "/").split("/").some((s) => s === "..")
				  )
				: [];

			return {
				id: file.path,
				name: (fm.name as string) ?? file.basename,
				provider: validProvider,
				model: fm.model as string | undefined,
				maxTokens: fm.max_tokens as number | undefined,
				contextNotes: validContextNotes,
				resumeMode: validResumeMode,
				outputFolder: validOutputFolder,
				systemPrompt: match[2].trim(),
			};
		} catch {
			return null;
		}
	}
}
