import type { TFile } from "obsidian";
import type { Conversation } from "../../models/types";
import type { PythiaSettings } from "../../models/settings";
import type { EmbeddingProvider, EmbeddingBackend } from "./EmbeddingProvider";
import type { ModelLoadProgress } from "./host/iframeEmbeddingProvider";
import type { IndexStore } from "./ConversationIndexService";
import { ConversationIndexService } from "./ConversationIndexService";
import { createEmbeddingProvider } from "./host/embeddingProviderFactory";
import { warmIndex } from "./warmIndex";
import { relatedMinScore, type RelatedResult } from "./relatedConversations";
import { hashPolicyFor } from "./rowProvenance";
import { ResidentProvider, type EmbeddingResidency, type ResidencyDeps } from "./residency";
import { effectiveEmbeddingModel, type EmbeddingModelId } from "../../models/embeddingModels";
import type { VaultIndexSnapshot } from "../VaultRagService";
import type { VaultIndexStatus } from "./indexStatus";

/**
 * Everything on-device embedding, in one place (engineering-review #366).
 *
 * "Related conversations" (ADR-109) and vault-wide semantic RAG (ADR-116) share
 * ONE lazily-built provider — the model is heavy, so it loads once and both index
 * services reuse it — and they share a model identity, a teardown and a warm. That
 * made the block a coherent unit inside `main.ts`, and also the largest thing in
 * it; ADR-097's line budget forced the question of where it belongs, and the
 * answer is here, where the rules can be tested.
 *
 * `main.ts` is excluded from coverage by design, so while this lived there nothing
 * could fail when the cache-and-invalidate rule broke. The rules that now have
 * tests behind them:
 *
 *  • **One model per device, resolved once.** `activeModelId()` is the ONLY reader
 *    of `settings.embeddingModelId` outside the settings control (ADR-199/200);
 *    the provider, both index stores, the floors and the scope signature all read
 *    it, and the substitute is never written back into the setting (principle 6).
 *  • **A model change tears the world down.** The provider is unloaded and BOTH
 *    index services are dropped, so the next use rebuilds against the new model
 *    rather than mixing vector spaces.
 *  • **The floor comes from the model, the cap from the screen** (ADR-169).
 *
 * The Obsidian-shaped dependencies — the `.bin` files, the worker's resource-path
 * URL, `Notice`, the vault-RAG service and the residency's listeners — are
 * injected as an `EmbeddingHubHost`, the same structural-seam shape
 * `installEmbeddingResidency` and `ui/vaultIndexStatusSetting.ts` already use. The
 * hub itself imports no Obsidian runtime.
 */

/** Related conversations shown at once. A cap, not a filter: the floor decides
 *  relevance, this decides how much of it fits on a screen (ADR-169). */
export const RELATED_RESULT_LIMIT = 20;

/** An index file that can also be asked whether it is there WITHOUT being read —
 *  the background warm only needs the yes/no, and the file is megabytes. */
export interface EmbeddingIndexStore extends IndexStore {
	exists(): Promise<boolean>;
}

/** What vault-wide RAG owes the rest of the app. `VaultRagService` satisfies it
 *  structurally, so a test can stand in a plain object. */
export interface VaultRagLike {
	reset(): void;
	reindex(): Promise<void>;
	buildNow(): void;
	status(): Promise<VaultIndexSnapshot>;
	onChange(listener: () => void): () => void;
	getAutoContext(conversationId: string): string[];
	getRelevantNotes(conversation: Conversation, query: string, exclude?: string[]): Promise<string[]>;
	applyChanges(changed: TFile[], deleted: string[]): Promise<void>;
	isBuilding(): boolean;
	/** Once per session: a complete index catches up with the vault (ADR-221). */
	catchUp(): void;
	onBackground(hidden: boolean): void;
	dispose(): void;
}

/** What the hub hands `makeVaultRag` — the shared provider and the model identity,
 *  as getters, because both change under the service's feet on a model switch. */
export interface VaultRagWiring {
	getProvider(): EmbeddingProvider;
	makeStore(): IndexStore;
	modelId(): EmbeddingModelId;
}

export interface EmbeddingHubHost {
	settings(): PythiaSettings;
	conversations(): Conversation[];
	/** Phones release the model and never run the background warm. */
	isMobile: boolean;
	/** The per-model index file; `prefix` selects conversation vs. vault index. */
	makeStore(modelId: EmbeddingModelId, prefix?: string): EmbeddingIndexStore;
	/** Same-origin URL for the embedding worker bundle (ADR-126). Called at most
	 *  once — the hub memoizes it, because writing the file is the expensive part. */
	workerUrl(): Promise<string>;
	makeVaultRag(wiring: VaultRagWiring): VaultRagLike;
	/** Installs the phone's release-on-hide / preload-on-return handlers (ADR-202). */
	installResidency(deps: ResidencyDeps): EmbeddingResidency;
	notice(message: string): void;
	log(message: string, data?: Record<string, unknown>): void;
	/** Shown once when the model is about to be downloaded/loaded for a request
	 *  the user actually made. The background warm passes `silent`. */
	firstRunMessage: string;
}

export class EmbeddingHub {
	private provider: ResidentProvider | null = null;
	private modelId: EmbeddingModelId | null = null;
	private relatedService: ConversationIndexService | null = null;
	/** Memoized resource-path URL for the embedding worker script (written once per
	 *  plugin version). Lets the Worker start where `blob:` Workers are blocked (ADR-126). */
	private workerUrlPromise: Promise<string> | null = null;
	private residency: EmbeddingResidency | null = null;
	/** Vault-wide semantic RAG (ADR-116/118/119) — index lifecycle + retrieval. */
	readonly vaultRag: VaultRagLike;

	constructor(private readonly host: EmbeddingHubHost) {
		this.vaultRag = host.makeVaultRag({
			getProvider: () => this.ensureProvider(),
			makeStore: () => host.makeStore(this.activeModelId(), "vault-embeddings"),
			modelId: () => this.activeModelId(),
		});
		this.residency = host.installResidency({
			provider: () => this.provider,
			// The related-index sync counts as "running" too (#362): it embeds
			// through the same provider, and releasing the model under it would
			// abandon a build halfway. The hub owns both, so it can say so.
			building: () => this.vaultRag.isBuilding() || (this.relatedService?.isSyncing() ?? false),
			mobile: host.isMobile,
			onBackground: (hidden) => this.vaultRag.onBackground(hidden),
			log: (m, d) => host.log(m, d as Record<string, unknown>),
		});
	}

	/** The model this device embeds with (ADR-199/200) — the ONLY reader of
	 *  `settings.embeddingModelId` outside the settings control. */
	activeModelId(): EmbeddingModelId {
		const settings = this.host.settings();
		return effectiveEmbeddingModel(settings.embeddingModelId, this.host.isMobile);
	}

	/** Vault paths auto-retrieved for `conversationId` on its most recent turn. */
	getAutoContext(conversationId: string): string[] {
		return this.vaultRag.getAutoContext(conversationId);
	}

	/** Conversations semantically related to `sourceId`, most-similar first (ADR-109).
	 *
	 *  In-app diagnostic (enable "Debug mode" in settings): traces the embedding
	 *  path so a "shows nothing" report can be triaged from the developer console
	 *  without a rebuild. Three outcomes are distinguishable in the log:
	 *   • a "query failed" warning (always logged) → the model/iframe never produced
	 *     vectors — inspect the attached error (offline, download failed, timeout);
	 *   • "returned 0" with no error → the index built and ranking ran, but nothing
	 *     cleared the minScore floor (raise the floor or the vault is too sparse);
	 *   • "returned N" with per-id scores → the path works end to end. */
	async getRelated(sourceId: string, signal?: AbortSignal): Promise<RelatedResult[]> {
		const startedAt = Date.now();
		const settings = this.host.settings();
		const conversations = this.host.conversations();
		const minScore = relatedMinScore(settings.relatedSimilarity, this.activeModelId());
		this.host.log("related: query start", {
			sourceId,
			model: this.activeModelId(),
			conversations: conversations.length,
			similarity: settings.relatedSimilarity,
			minScore,
		});
		try {
			const results = await this.ensureRelatedService().getRelated(sourceId, conversations, {
				minScore,
				// A screenful, not everything above the floor: the number of pairs
				// clearing a fixed cosine grows linearly with the vault, so without a
				// cap the list length is a function of vault size rather than of
				// relevance (ADR-169).
				limit: RELATED_RESULT_LIMIT,
				signal,
			});
			this.host.log(`related: query ok (${Date.now() - startedAt}ms)`, {
				returned: results.length,
				top: results.slice(0, 5).map((r) => ({ id: r.id, score: Math.round(r.score * 1000) / 1000 })),
			});
			return results;
		} catch (e) {
			// Genuine failure — surface it unconditionally (not gated on debugMode) so a
			// model-load/inference error is always in the console behind the UI Notice.
			console.warn("[Pythia] related: query failed", e);
			throw e;
		}
	}

	/** Build (or reuse) the shared embedding provider for the current model. On a
	 *  model change, the old provider AND both index services are torn down so the
	 *  next use rebuilds against the new model. The onProgress callback traces the
	 *  model download/load (debug mode only) — the single hardest part to diagnose
	 *  blind, since it happens inside the hidden iframe. */
	ensureProvider(opts: { silent?: boolean } = {}): EmbeddingProvider {
		const modelId = this.activeModelId();
		if (this.provider && this.modelId === modelId) return this.provider;
		this.provider?.unload();
		this.relatedService = null;
		this.vaultRag.reset();
		// Silent for the background warm (`warm`): that path runs without the user
		// asking for anything, so a "preparing the model" Notice on every launch
		// would be noise about work they did not request.
		if (!opts.silent) this.host.notice(this.host.firstRunMessage);
		this.host.log("embedding: initializing model", { modelId, priorModel: this.modelId });
		// Worker (off the UI thread) with a blob→resource-path→iframe fallback chain
		// (ADR-119/126). The resource-path URL lets the Worker start where blob: is blocked.
		this.provider = new ResidentProvider(createEmbeddingProvider(
			modelId,
			(p: ModelLoadProgress) =>
				this.host.log("embedding: model load", {
					file: p.file,
					percent: Math.round(p.progress),
					loaded: p.loaded,
					total: p.total,
				}),
			() => (this.workerUrlPromise ??= this.host.workerUrl()),
			// Which backend actually started (ADR-182). The chain was silent on the
			// happy path, so a desktop-wide fallback to the UI-thread iframe looked
			// exactly like a working Worker until someone read the source.
			(backend: EmbeddingBackend, failures: string[]) =>
				this.host.log("embedding: backend resolved", { backend, modelId, failures }),
		), () => this.residency?.noteUse());
		this.modelId = modelId;
		return this.provider;
	}

	private ensureRelatedService(opts: { silent?: boolean } = {}): ConversationIndexService {
		const provider = this.ensureProvider(opts);
		if (!this.relatedService) {
			this.relatedService = new ConversationIndexService(
				provider,
				this.host.makeStore(this.modelId!),
				{ hashPolicy: hashPolicyFor(this.modelId!) },
			);
		}
		return this.relatedService;
	}

	/** Warm the related index in the background so the first "related" click is a
	 *  ranking pass rather than a cold build (ADR-169). Guards, deps and the
	 *  reasoning live in `services/embedding/warmIndex.ts`. */
	warm(): Promise<void> {
		return warmIndex({
			isMobile: this.host.isMobile,
			conversationCount: this.host.conversations().length,
			hasIndex: () => this.host.makeStore(this.activeModelId()).exists(),
			sync: () => this.ensureRelatedService({ silent: true }).sync(this.host.conversations()),
			log: (message, data) => this.host.log(message, data),
		});
	}

	/** Once per session on a desktop, after launch (ADR-221): a complete vault index
	 *  catches up with what changed while Pythia was not running. Only where an
	 *  index exists — starting one nobody asked for is not a catch-up — and with
	 *  the provider made silently, so a launch shows no "preparing the model". */
	async catchUpVaultIndex(): Promise<void> {
		if (this.host.isMobile) return;
		if (!(await this.host.makeStore(this.activeModelId(), "vault-embeddings").exists())) return;
		this.ensureProvider({ silent: true });
		this.vaultRag.catchUp();
	}

	/** Full reindex of vault context (ADR-119) — clear + rebuild in the background.
	 *  Exposed for the settings "Rebuild index" button and the command. */
	reindexVault(): Promise<void> {
		return this.vaultRag.reindex();
	}

	/** "Build now" in settings: finish or update the index, keeping its rows (ADR-199). */
	buildVaultIndexNow(): void {
		this.vaultRag.buildNow();
	}

	/** The chat input got focus: load a model the phone released, before the send needs it (ADR-202). */
	prewarm(): void { this.residency?.prewarm(); }

	onVaultIndexChange(listener: () => void): () => void { return this.vaultRag.onChange(listener); }

	/** Where the vault index stands, for the settings tab (ADR-199). Never loads the model. */
	async vaultIndexStatus(): Promise<VaultIndexStatus> {
		const settings = this.host.settings();
		const modelId = this.activeModelId();
		const substituted = modelId !== settings.embeddingModelId;
		return {
			...(await this.vaultRag.status()),
			modelId,
			modelSubstituted: substituted,
			enabledByDefault: settings.vaultContextEnabled,
			onPhone: this.host.isMobile,
		};
	}

	/** Drop the embedding provider + index services so the next use rebuilds with
	 *  the current model. Called by the settings tab on a model change. */
	invalidate(): void {
		this.provider?.unload();
		this.provider = null;
		this.modelId = null;
		this.relatedService = null;
		this.vaultRag.reset();
	}

	/** Plugin unload: stop the vault build and let go of the model. */
	dispose(): void {
		this.vaultRag.dispose();
		this.provider?.unload();
	}
}
