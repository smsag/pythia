import { App, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { PythiaSettings } from "../settings";
import type { LLMRouter } from "./LLMRouter";
import { TemplateLoader } from "./TemplateLoader";
import { PromptInputModal } from "../suggest/PromptInputModal";
import { t } from "../i18n";

export class PromptOptimizerService {
	private app: App;
	private plugin: PythiaPlugin;
	private settings: PythiaSettings;
	private llmRouter: LLMRouter;
	private templateLoader: TemplateLoader;

	constructor(app: App, plugin: PythiaPlugin, settings: PythiaSettings, llmRouter: LLMRouter) {
		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
		this.llmRouter = llmRouter;
		this.templateLoader = new TemplateLoader(app, settings);
	}

	async run(): Promise<void> {
		// Step 1 — load the optimizer template
		if (!this.settings.promptOptimizerTemplateId) {
			new Notice(t("promptOptimizerNotConfigured"));
			return;
		}

		const templates = await this.templateLoader.loadTemplates();
		const template = templates.find((tpl) => tpl.id === this.settings.promptOptimizerTemplateId);
		if (!template) {
			new Notice(t("promptOptimizerTemplateNotFound"));
			return;
		}

		// Step 2 — collect user message
		// The template body (template.systemPrompt) is the user message template.
		// It can contain either Templater syntax or a {{prompt}} placeholder.
		let userMessage: string | null = null;

		const templaterPlugin = (this.app as App & { plugins?: { plugins?: Record<string, unknown> } })
			.plugins?.plugins?.["templater-obsidian"];

		if (templaterPlugin) {
			try {
				userMessage = await this.runWithTemplater(template.id);
			} catch (err) {
				console.warn("Pythia: Templater rendering failed, falling back to modal.", err);
			}
		}

		if (userMessage === null) {
			// Fallback: collect raw prompt, substitute into template body
			const raw = await this.showInputModal();
			if (raw === null) return;
			const body = template.systemPrompt;
			userMessage = body.includes("{{prompt}}")
				? body.replace(/\{\{prompt\}\}/g, raw)
				: raw;
		}

		if (!userMessage) return;

		// Step 3 — call LLM
		// The template body (already rendered above) is the full user message.
		// No separate system prompt — instructions are embedded in the body.
		new Notice(t("promptOptimizerOptimizing"));
		let optimizedPrompt: string;
		try {
			const provider = template.provider ?? this.settings.defaultProvider;
			optimizedPrompt = await this.llmRouter.optimizePrompt(
				"",
				userMessage,
				provider,
				template.model
			);
		} catch (err) {
			new Notice(t("promptOptimizerFailed", { error: String(err) }));
			return;
		}

		if (!optimizedPrompt) return;

		// Step 4 — open new conversation and pre-fill input
		const conv = await this.plugin.createConversation(t("promptOptimizerConvName"));
		const view = await this.plugin.activateView();
		await view.setActiveConversation(conv);
		view.prefillInput(optimizedPrompt);
	}

	private async runWithTemplater(templateId: string): Promise<string | null> {
		const tplFile = this.app.vault.getFileByPath(templateId);
		if (!tplFile) return null;

		const templaterPlugin = (this.app as App & {
			plugins?: {
				plugins?: {
					"templater-obsidian"?: {
						templater?: {
							create_running_config: (
								file: unknown,
								activeFile: unknown,
								runMode: number
							) => unknown;
							read_and_parse_template: (config: unknown) => Promise<string>;
						};
					};
				};
			};
		}).plugins?.plugins?.["templater-obsidian"];

		const templater = templaterPlugin?.templater;
		if (!templater) return null;

		const activeFile = this.app.workspace.getActiveFile();
		// RunMode.CreateNewFromTemplate = 1
		const config = templater.create_running_config(tplFile, activeFile, 1);
		const rendered = await templater.read_and_parse_template(config);
		return rendered.trim() || null;
	}

	private showInputModal(): Promise<string | null> {
		return new Promise((resolve) => {
			new PromptInputModal(this.app, resolve).open();
		});
	}
}
