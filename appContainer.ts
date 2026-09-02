import type PythiaPlugin from "./main";
import { AnthropicService } from "./services/AnthropicService";
import { OpenAIProvider } from "./services/OpenAIProvider";
import { MistralService } from "./services/MistralService";
import { LLMRouter } from "./services/LLMRouter";
import { TemplateLoader } from "./services/TemplateLoader";
import { NoteWriter } from "./services/NoteWriter";
import { WebSearchService } from "./services/WebSearchService";
import { ToolHandler } from "./services/ToolHandler";
import { PromptOptimizerService } from "./services/PromptOptimizerService";
import { SecretStore } from "./services/SecretStore";
import { PluginDataStore } from "./services/PluginDataStore";
import { ConversationService } from "./services/ConversationService";
import { ViewManager } from "./services/ViewManager";

/**
 * Composition root (ADR-103 / #122) — the single place the plugin's services are
 * constructed and wired, mirroring obsidian-similarity's `appContainer.ts`. The
 * plugin exposes each as a getter delegating here, so `plugin.llmRouter` etc.
 * keep working with no call-site changes.
 *
 * `create()` is an async factory because `loadPluginData()` must run before the
 * provider services are constructed (they read the freshly-decrypted API keys),
 * so a plain constructor can't express the ordering. `ConversationStore` is NOT
 * built here: it owns the conversation list and must exist on the plugin before
 * `loadPluginData()` writes to it, so the plugin constructs it first.
 */
export class AppContainer {
	private constructor(
		readonly pluginDataStore: PluginDataStore,
		readonly llmRouter: LLMRouter,
		readonly templateLoader: TemplateLoader,
		readonly noteWriter: NoteWriter,
		readonly webSearchService: WebSearchService,
		readonly toolHandler: ToolHandler,
		readonly promptOptimizerService: PromptOptimizerService,
		readonly secretStore: SecretStore,
		readonly conversationService: ConversationService,
		readonly viewManager: ViewManager,
	) {}

	static async create(plugin: PythiaPlugin): Promise<AppContainer> {
		// Load first: settings/conversations/keys must be populated before the
		// provider services read them. (loadPluginData writes conversations through
		// plugin.conversations → the already-constructed ConversationStore.)
		const pluginDataStore = new PluginDataStore(plugin);
		await pluginDataStore.loadPluginData();

		const anthropicSvc = new AnthropicService(plugin.app, plugin.settings, plugin.plaintextApiKey);
		const openaiSvc = new OpenAIProvider(plugin.app, plugin.settings, plugin.plaintextOpenAIKey);
		const mistralSvc = new MistralService(plugin.app, plugin.settings, plugin.plaintextMistralKey);
		const llmRouter = new LLMRouter(anthropicSvc, openaiSvc, mistralSvc);
		const templateLoader = new TemplateLoader(plugin.app, plugin.settings);
		const noteWriter = new NoteWriter(plugin.app, plugin.settings);
		const webSearchService = new WebSearchService(plugin.settings, plugin.plaintextSearchKey);
		const toolHandler = new ToolHandler(noteWriter, webSearchService);
		const promptOptimizerService = new PromptOptimizerService(plugin.app, plugin, plugin.settings, llmRouter);
		const secretStore = new SecretStore(plugin);
		const conversationService = new ConversationService(plugin);
		const viewManager = new ViewManager(plugin);

		return new AppContainer(
			pluginDataStore,
			llmRouter,
			templateLoader,
			noteWriter,
			webSearchService,
			toolHandler,
			promptOptimizerService,
			secretStore,
			conversationService,
			viewManager,
		);
	}
}
