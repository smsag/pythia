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
		if (!folder || !folder.trim()) return [];
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder));

		const templates = await Promise.all(files.map((file) => this.loadTemplate(file)));
		return templates.filter((tpl): tpl is PythiaTemplate => tpl !== null);
	}

	async loadTemplate(file: TFile): Promise<PythiaTemplate | null> {
		try {
			const content = await this.app.vault.read(file);
			const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
			if (!match) return null;

			const fm = parseYaml(match[1]) as Record<string, unknown>;
			if (fm.type !== "Pythia Prompt Template") return null;

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

			const rawWriteMode = fm.write_mode;
			const validWriteMode: "update" | "create" | "none" | "rewrite" | "all" | undefined =
				rawWriteMode === "update" || rawWriteMode === "create" || rawWriteMode === "none" || rawWriteMode === "rewrite" || rawWriteMode === "all"
					? rawWriteMode
					: undefined;

			// Validate temperature — must be a finite number in [0, 1].
			const rawTemperature = fm.temperature;
			const validTemperature: number | undefined =
				typeof rawTemperature === "number" && Number.isFinite(rawTemperature) && rawTemperature >= 0 && rawTemperature <= 1
					? rawTemperature
					: undefined;

			return {
				id: file.path,
				name: (fm.name as string) ?? file.basename,
				provider: validProvider,
				model: fm.model as string | undefined,
				maxTokens: fm.max_tokens as number | undefined,
				temperature: validTemperature,
				contextNotes: validContextNotes,
				resumeMode: validResumeMode,
				outputFolder: validOutputFolder,
				writeMode: validWriteMode,
				autoPrompt: fm.auto_prompt as string | undefined,
				systemPrompt: match[2].trim(),
			};
		} catch (err) {
			console.warn("[Pythia] failed to parse template:", file.path, err);
			return null;
		}
	}
}
