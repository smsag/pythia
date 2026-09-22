import { describe, it, expect, vi, beforeEach } from "vitest";

// `EmbeddingHub` news up the provider itself (the model is a process-wide
// resource, so it is not injected per call), which is exactly the wiring these
// tests are about — so the factory module is mocked rather than the instance.
const built: string[] = [];
/** The worker-URL getter each constructed provider was handed, so a test can
 *  drive it the way the real factory's Worker path does. */
const spawnUrls: (() => Promise<string>)[] = [];
/** Set to hold `embed` open, so a test can observe work that is still running. */
const hold: { gate: Promise<void> | null; release: (() => void) | null } = { gate: null, release: null };
const holdEmbeds = (): void => { hold.gate = new Promise((r) => { hold.release = () => r(); }); };
vi.mock("../services/embedding/host/embeddingProviderFactory", () => ({
	createEmbeddingProvider: (modelId: string, _p?: unknown, resourceWorkerUrl?: () => Promise<string>) => {
		built.push(modelId);
		if (resourceWorkerUrl) spawnUrls.push(resourceWorkerUrl);
		return {
			dim: 4,
			async ready(): Promise<void> {},
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (hold.gate) await hold.gate;
				return texts.map(() => Float32Array.from([1, 0, 0, 0]));
			},
			isOffThread: () => true,
			backend: () => "worker (blob)",
			unload(): void {},
		};
	},
}));

import { EmbeddingHub, RELATED_RESULT_LIMIT, type EmbeddingHubHost, type VaultRagLike } from "../services/embedding/EmbeddingHub";
import { EMBEDDING_MODELS, MOBILE_EMBEDDING_MODEL_ID, effectiveEmbeddingModel } from "../models/embeddingModels";
import { relatedMinScore } from "../services/embedding/relatedConversations";
import { DEFAULT_SETTINGS } from "../models/settings";
import type { PythiaSettings } from "../models/settings";
import type { Conversation } from "../models/types";
import type { VaultIndexSnapshot } from "../services/VaultRagService";

const MULTILINGUAL = "xenova-paraphrase-multilingual-MiniLM-L12-v2";

/** `n` conversations with enough text to be chunked and embedded. */
const talky = (n: number): Conversation[] =>
	Array.from({ length: n }, (_, i) => ({
		id: `c${i}`,
		name: `Conversation ${i}`,
		messages: [{ id: `m${i}`, role: "user", content: `a note about topic ${i}` }],
	})) as unknown as Conversation[];

/** Records every call the hub makes, so a test can assert on the teardown order. */
function makeVaultRag(): VaultRagLike & { resets: number; snapshot: VaultIndexSnapshot } {
	const rag = {
		resets: 0,
		disposed: 0,
		reindexed: 0,
		builds: 0,
		snapshot: { state: "ready", count: 7, done: 7, total: 7 } as unknown as VaultIndexSnapshot,
		listeners: new Set<() => void>(),
		reset(): void { rag.resets++; },
		async reindex(): Promise<void> { rag.reindexed++; },
		buildNow(): void { rag.builds++; },
		async status(): Promise<VaultIndexSnapshot> { return rag.snapshot; },
		onChange(l: () => void): () => void { rag.listeners.add(l); return () => rag.listeners.delete(l); },
		getAutoContext: (id: string) => [`auto/${id}.md`],
		async getRelevantNotes(): Promise<string[]> { return []; },
		async applyChanges(): Promise<void> {},
		isBuilding: () => false,
		onBackground(): void {},
		dispose(): void { rag.disposed++; },
	};
	return rag;
}

interface Harness {
	hub: EmbeddingHub;
	rag: ReturnType<typeof makeVaultRag>;
	settings: PythiaSettings;
	conversations: Conversation[];
	notices: string[];
	logs: { message: string; data?: Record<string, unknown> }[];
	stores: { modelId: string; prefix?: string }[];
	workerUrlCalls: number;
	residencyDeps: Parameters<EmbeddingHubHost["installResidency"]>[0] | null;
	wiring: Parameters<EmbeddingHubHost["makeVaultRag"]>[0] | null;
	prewarms: number;
	/** What `exists()` reports — the warm's "has an index ever been built" guard. */
	indexExists: boolean;
}

function harness(over: { isMobile?: boolean; settings?: Partial<PythiaSettings> } = {}): Harness {
	const rag = makeVaultRag();
	const h: Harness = {
		hub: null as unknown as EmbeddingHub,
		rag,
		settings: { ...DEFAULT_SETTINGS, ...over.settings },
		conversations: [],
		notices: [],
		logs: [],
		stores: [],
		workerUrlCalls: 0,
		residencyDeps: null,
		wiring: null,
		prewarms: 0,
		indexExists: false,
	};
	h.hub = new EmbeddingHub({
		settings: () => h.settings,
		conversations: () => h.conversations,
		isMobile: over.isMobile ?? false,
		makeStore: (modelId, prefix) => {
			h.stores.push({ modelId, prefix });
			return {
				async read() { return null; },
				async write() {},
				async exists() { return h.indexExists; },
			};
		},
		workerUrl: async () => { h.workerUrlCalls++; return "app://resource/worker.mjs"; },
		makeVaultRag: (w) => { h.wiring = w; return rag; },
		installResidency: (deps) => {
			h.residencyDeps = deps;
			return {
				noteUse(): void {},
				prewarm(): void { h.prewarms++; },
			} as unknown as ReturnType<EmbeddingHubHost["installResidency"]>;
		},
		notice: (m) => h.notices.push(m),
		log: (message, data) => h.logs.push({ message, data }),
		firstRunMessage: "preparing the model",
	});
	return h;
}

beforeEach(() => { built.length = 0; spawnUrls.length = 0; hold.gate = null; hold.release = null; });

describe("which model this device embeds with (ADR-199/200)", () => {
	it("a desktop runs exactly the model the setting names", () => {
		const h = harness({ settings: { embeddingModelId: MULTILINGUAL } });
		expect(h.hub.activeModelId()).toBe(MULTILINGUAL);
	});

	it("a phone runs the substitute, and the setting is left alone", () => {
		const h = harness({ isMobile: true, settings: { embeddingModelId: MULTILINGUAL } });
		expect(h.hub.activeModelId()).toBe(effectiveEmbeddingModel(MULTILINGUAL, true));
		expect(EMBEDDING_MODELS[h.hub.activeModelId()].mobile).toBe(true);
		// Principle 6: the substitute is what this device uses, never what it stores —
		// the setting syncs, and the desktop keeps the choice.
		expect(h.settings.embeddingModelId).toBe(MULTILINGUAL);
	});

	it("the provider is built for the resolved model, not the stored one", () => {
		const h = harness({ isMobile: true, settings: { embeddingModelId: MULTILINGUAL } });
		h.hub.ensureProvider();
		expect(built).toEqual([effectiveEmbeddingModel(MULTILINGUAL, true)]);
	});
});

describe("one provider, rebuilt only when the model changes", () => {
	it("hands back the same provider while the model is unchanged", () => {
		const h = harness();
		expect(h.hub.ensureProvider()).toBe(h.hub.ensureProvider());
		expect(built).toHaveLength(1);
	});

	it("a model change unloads the old provider and drops BOTH index services", () => {
		const h = harness({ settings: { embeddingModelId: MOBILE_EMBEDDING_MODEL_ID } });
		const first = h.hub.ensureProvider();
		const unload = vi.spyOn(first, "unload");
		const resetsBefore = h.rag.resets;

		h.settings.embeddingModelId = MULTILINGUAL;
		const second = h.hub.ensureProvider();

		expect(second).not.toBe(first);
		expect(unload).toHaveBeenCalled();
		// Vault RAG is reset too — mixing two models' vectors in one index is the
		// failure this teardown exists to prevent.
		expect(h.rag.resets).toBe(resetsBefore + 1);
		expect(built).toEqual([MOBILE_EMBEDDING_MODEL_ID, MULTILINGUAL]);
	});

	it("writes the worker file once, however often a Worker is spawned (ADR-126)", async () => {
		const h = harness({ settings: { embeddingModelId: MOBILE_EMBEDDING_MODEL_ID } });
		h.hub.ensureProvider();
		h.settings.embeddingModelId = MULTILINGUAL;
		h.hub.ensureProvider();
		expect(spawnUrls).toHaveLength(2); // one getter per constructed provider

		// Writing the bundle to the plugin folder is the expensive part, and it is
		// the same file whatever the model — so the hub memoizes the promise across
		// providers, not just across calls within one.
		const urls = await Promise.all(spawnUrls.flatMap((g) => [g(), g()]));
		expect(new Set(urls).size).toBe(1);
		expect(h.workerUrlCalls).toBe(1);
	});

	it("invalidate() tears everything down, so the next use rebuilds", () => {
		const h = harness();
		const first = h.hub.ensureProvider();
		const unload = vi.spyOn(first, "unload");
		const resetsBefore = h.rag.resets;
		h.hub.invalidate();
		expect(unload).toHaveBeenCalled();
		expect(h.rag.resets).toBe(resetsBefore + 1);
		expect(h.hub.ensureProvider()).not.toBe(first);
	});

	it("dispose() stops the vault build and lets go of the model", () => {
		const h = harness();
		const provider = h.hub.ensureProvider();
		const unload = vi.spyOn(provider, "unload");
		h.hub.dispose();
		expect(h.rag.disposed).toBe(1);
		expect(unload).toHaveBeenCalled();
	});

	it("dispose() before anything was built does not construct a model to unload it", () => {
		const h = harness();
		h.hub.dispose();
		expect(built).toEqual([]);
	});
});

describe("the first-run notice", () => {
	it("is shown for work the user asked for", () => {
		const h = harness();
		h.hub.ensureProvider();
		expect(h.notices).toEqual(["preparing the model"]);
	});

	it("is silent for the background warm — nobody asked for it", async () => {
		const h = harness();
		h.conversations = [{ id: "a", messages: [] }, { id: "b", messages: [] }] as unknown as Conversation[];
		h.indexExists = true; // the warm's guard, so it gets as far as loading a model
		await h.hub.warm();
		expect(built).toHaveLength(1); // it really did build the provider …
		expect(h.notices).toEqual([]); // … and still said nothing
	});

	it("is not repeated while the provider is reused", () => {
		const h = harness();
		h.hub.ensureProvider();
		h.hub.ensureProvider();
		expect(h.notices).toHaveLength(1);
	});
});

describe("the background warm's guards (ADR-169)", () => {
	it("never runs on a phone", async () => {
		const h = harness({ isMobile: true });
		h.conversations = [{ id: "a" }, { id: "b" }] as Conversation[];
		await h.hub.warm();
		expect(built).toEqual([]);
		expect(h.stores).toEqual([]); // not even the "does an index exist" read
	});

	it("never runs below two conversations — there is no pair to rank", async () => {
		const h = harness();
		h.conversations = [{ id: "a" }] as Conversation[];
		await h.hub.warm();
		expect(built).toEqual([]);
	});

	it("asks whether an index exists before downloading a model nobody requested", async () => {
		const h = harness();
		h.conversations = [{ id: "a" }, { id: "b" }] as Conversation[];
		await h.hub.warm();
		// The fixture's store reports no index, so the warm stops there.
		expect(h.stores.map((s) => s.prefix)).toEqual([undefined]);
		expect(built).toEqual([]);
	});
});

describe("related conversations (ADR-109/169)", () => {
	it("scores against the MODEL's own measured floor, not a shared constant", async () => {
		const h = harness({ settings: { embeddingModelId: MULTILINGUAL, relatedSimilarity: "balanced" } });
		h.conversations = talky(2);
		await h.hub.getRelated("c0");
		const start = h.logs.find((l) => l.message === "related: query start");
		// The floors live on the model because the distributions differ by ~0.08
		// between them (ADR-169); one constant made "Balanced" mean two things.
		expect(start?.data?.minScore).toBe(relatedMinScore("balanced", MULTILINGUAL));
		expect(start?.data?.model).toBe(MULTILINGUAL);
	});

	it("caps the list at a screenful, however many conversations clear the floor", async () => {
		const h = harness();
		// The fake provider returns one vector for everything, so every pair scores
		// 1.0 — the case the cap exists for: above the floor is not a list length.
		h.conversations = talky(40);
		const results = await h.hub.getRelated("c0");
		expect(results).toHaveLength(RELATED_RESULT_LIMIT);
		expect(RELATED_RESULT_LIMIT).toBe(20);
		expect(results.some((r) => r.id === "c0")).toBe(false); // never the source itself
	});

	it("rethrows a query failure rather than reporting an empty result", async () => {
		const h = harness();
		h.conversations = [{ id: "a", messages: [] }] as unknown as Conversation[];
		const boom = new Error("model load failed");
		vi.spyOn(h.hub.ensureProvider(), "embed").mockRejectedValue(boom);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(h.hub.getRelated("a")).rejects.toThrow("model load failed");
		// Logged unconditionally, not behind debug mode: a silent failure here is
		// indistinguishable from "nothing was similar enough" (principle 2).
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("the settings status line (ADR-199)", () => {
	it("adds the model half and says when the device substituted one", async () => {
		const h = harness({ isMobile: true, settings: { embeddingModelId: MULTILINGUAL, vaultContextEnabled: true } });
		const status = await h.hub.vaultIndexStatus();
		expect(status.count).toBe(7);
		expect(status.modelId).toBe(effectiveEmbeddingModel(MULTILINGUAL, true));
		expect(status.modelSubstituted).toBe(true);
		expect(status.enabledByDefault).toBe(true);
	});

	it("reports no substitution when the device runs the chosen model", async () => {
		const h = harness({ settings: { embeddingModelId: MULTILINGUAL } });
		expect((await h.hub.vaultIndexStatus()).modelSubstituted).toBe(false);
	});

	it("never loads the model to answer", async () => {
		const h = harness();
		await h.hub.vaultIndexStatus();
		expect(built).toEqual([]);
	});
});

describe("the vault-RAG facades", () => {
	it("pass straight through, so a caller never reaches two sources of truth", async () => {
		const h = harness();
		expect(h.hub.getAutoContext("c1")).toEqual(["auto/c1.md"]);
		await h.hub.reindexVault();
		expect(h.rag.reindexed).toBe(1);
		h.hub.buildVaultIndexNow();
		expect(h.rag.builds).toBe(1);
		const off = h.hub.onVaultIndexChange(() => {});
		expect(typeof off).toBe("function");
	});

	it("gives the vault index a file of its own, keyed by the live active model", () => {
		const h = harness({ isMobile: true, settings: { embeddingModelId: MOBILE_EMBEDDING_MODEL_ID } });
		const w = h.wiring!;
		// Resolved when the service asks, never pinned at construction: the model can
		// change under the service's feet, and a store built for the old one would
		// keep writing into the old index.
		w.makeStore();
		expect(h.stores.at(-1)).toEqual({ modelId: MOBILE_EMBEDDING_MODEL_ID, prefix: "vault-embeddings" });

		h.settings.embeddingModelId = MULTILINGUAL;
		w.makeStore();
		const onPhone = effectiveEmbeddingModel(MULTILINGUAL, true);
		expect(h.stores.at(-1)).toEqual({ modelId: onPhone, prefix: "vault-embeddings" });
		expect(w.modelId()).toBe(onPhone);
		// The conversation index is a DIFFERENT file: same format, independent rows.
		h.hub.ensureProvider();
		expect(h.stores.some((s) => s.prefix === undefined)).toBe(false);
	});

	it("the residency counts the related sync as work in progress too (#362)", async () => {
		const h = harness();
		h.conversations = talky(3);
		h.indexExists = true;
		holdEmbeds();

		const warming = h.hub.warm();
		await Promise.resolve(); // let the sync open
		// A phone that released the model here would abandon a sync that is still
		// embedding through it. The vault build is NOT running, so this is true only
		// if the related index is counted as well — the wiring #362 fixed, which sat
		// in `main.ts` untested until the hub took ownership of both.
		expect(h.rag.isBuilding()).toBe(false);
		expect(h.residencyDeps?.building()).toBe(true);

		hold.release?.();
		await warming;
		expect(h.residencyDeps?.building()).toBe(false);
	});

	it("the residency sees the live provider and the live build state (ADR-202)", () => {
		const h = harness();
		expect(h.residencyDeps?.provider()).toBeNull();
		const provider = h.hub.ensureProvider();
		expect(h.residencyDeps?.provider()).toBe(provider);
		expect(h.residencyDeps?.building()).toBe(false);
		h.hub.prewarm();
		expect(h.prewarms).toBe(1);
	});
});
