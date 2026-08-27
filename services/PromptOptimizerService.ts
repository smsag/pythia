import { App, Notice, parseYaml } from "obsidian";
import type PythiaPlugin from "../main";
import type { PythiaSettings } from "../settings";
import type { LLMRouter } from "./LLMRouter";
import type { Provider } from "../models/types";
import { PromptInputModal } from "../suggest/PromptInputModal";
import { OUTPUT_ONLY_INSTRUCTION, cleanOptimizedOutput } from "./promptOptimizerText";
import { t } from "../i18n";

const FRAMEWORK_INSTRUCTIONS: Record<string, string> = {
	"CO-STAR":
		"Restructure the improved prompt using the CO-STAR framework. " +
		"CO-STAR stands for: Context (background and situation the AI needs to know), " +
		"Objective (the specific task or goal), " +
		"Style (writing style or tone to adopt), " +
		"Tone (emotional register — formal, casual, empathetic, etc.), " +
		"Audience (who the output is for), " +
		"Response (the exact format and structure of the output). " +
		"Address all six dimensions explicitly in the rewritten prompt.",
	"RACE":
		"Restructure the improved prompt using the RACE framework. " +
		"RACE stands for: Role (the persona or expert role the AI should adopt), " +
		"Action (the specific task it must perform), " +
		"Context (relevant background, constraints, or subject matter), " +
		"Expectation (the desired output format, length, and quality criteria). " +
		"Address all four dimensions explicitly in the rewritten prompt.",
	"RISEN":
		"Restructure the improved prompt using the RISEN framework. " +
		"RISEN stands for: Role (the expert identity the AI should take on), " +
		"Instructions (clear, step-by-step directions for what to do), " +
		"Steps (the ordered sequence of actions or reasoning to follow), " +
		"End goal (the final deliverable and what success looks like), " +
		"Narrowing (constraints, scope limits, or things to avoid). " +
		"Address all five dimensions explicitly in the rewritten prompt.",
};

export class PromptOptimizerService {
	private app: App;
	private plugin: PythiaPlugin;
	private settings: PythiaSettings;
	private llmRouter: LLMRouter;

	constructor(app: App, plugin: PythiaPlugin, settings: PythiaSettings, llmRouter: LLMRouter) {
		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
		this.llmRouter = llmRouter;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
	}

	private async loadTemplateFile(filePath: string): Promise<{ body: string; provider?: Provider; model?: string } | null> {
		const file = this.app.vault.getFileByPath(filePath);
		if (!file) return null;
		const content = await this.app.vault.read(file);
		const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
		if (fmMatch) {
			try {
				const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
				const rawProvider = fm.provider;
				const provider: Provider | undefined =
					rawProvider === "anthropic" || rawProvider === "openai" || rawProvider === "mistral" ? rawProvider : undefined;
				return { body: fmMatch[2].trim(), provider, model: fm.model as string | undefined };
			} catch {
				return { body: fmMatch[2].trim() };
			}
		}
		return { body: content.trim() };
	}

	/**
	 * Optimize `rawText` and return the result string.
	 * Used by the inline optimizer in the sidebar (no UI side-effects).
	 */
	async optimizeText(
		rawText: string,
		framework: string,
		provider: Provider,
		model: string,
	): Promise<string> {
		if (!this.settings.promptOptimizerTemplateId) {
			throw new Error("no-template");
		}
		const template = await this.loadTemplateFile(this.settings.promptOptimizerTemplateId);
		if (!template) {
			throw new Error("template-not-found");
		}

		let userMessage = template.body.includes("{{prompt}}")
			? template.body.replace(/\{\{prompt\}\}/g, rawText)
			: rawText;

		if (framework !== "none") {
			const instruction = FRAMEWORK_INSTRUCTIONS[framework];
			if (instruction) userMessage += "\n\n" + instruction;
		}
		userMessage += "\n\n" + OUTPUT_ONLY_INSTRUCTION;

		return cleanOptimizedOutput(await this.llmRouter.optimizePrompt("", userMessage, provider, model));
	}

	async run(): Promise<void> {
		// Step 1 — load the optimizer template
		if (!this.settings.promptOptimizerTemplateId) {
			new Notice(t("promptOptimizerNotConfigured"));
			return;
		}

		const template = await this.loadTemplateFile(this.settings.promptOptimizerTemplateId);
		if (!template) {
			new Notice(t("promptOptimizerTemplateNotFound"));
			return;
		}

		// Step 2 — collect user message
		// The template body is the user message template.
		// It can contain either Templater syntax or a {{prompt}} placeholder.
		let userMessage: string | null = null;

		const templaterPlugin = (this.app as App & { plugins?: { plugins?: Record<string, unknown> } })
			.plugins?.plugins?.["templater-obsidian"];

		if (templaterPlugin) {
			try {
				userMessage = await this.runWithTemplater(this.settings.promptOptimizerTemplateId);
			} catch (err) {
				console.warn("Pythia: Templater rendering failed, falling back to modal.", err);
			}
		}

		if (userMessage === null) {
			// Fallback: collect raw prompt, substitute into template body
			const raw = await this.showInputModal();
			if (raw === null) return;
			const body = template.body;
			userMessage = body.includes("{{prompt}}")
				? body.replace(/\{\{prompt\}\}/g, raw)
				: raw;
		}

		if (!userMessage) return;
		userMessage += "\n\n" + OUTPUT_ONLY_INSTRUCTION;

		// Step 3 — call LLM
		// The template body (already rendered above) is the full user message.
		// No separate system prompt — instructions are embedded in the body.
		new Notice(t("promptOptimizerOptimizing"));
		let optimizedPrompt: string;
		try {
			const provider = template.provider ?? this.settings.defaultProvider;
			const model = template.model ?? (
				provider === "openai"
					? this.settings.defaultOpenAIModel
					: provider === "mistral"
						? this.settings.defaultMistralModel
						: this.settings.defaultAnthropicModel
			);
			optimizedPrompt = cleanOptimizedOutput(await this.llmRouter.optimizePrompt(
				"",
				userMessage,
				provider,
				model
			));
		} catch (err) {
			new Notice(t("promptOptimizerFailed", { error: String(err) }));
			return;
		}

		if (!optimizedPrompt) return;

		// Step 4 — open new conversation and pre-fill input
		const conv = await this.plugin.createConversation({ name: t("promptOptimizerConvName") });
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
