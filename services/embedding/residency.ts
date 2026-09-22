// When the embedding model stays in memory on a phone (ADR-202).
//
// After a build the loaded model holds ~400 MB of Obsidian's web process whether
// anything is being embedded or not. iOS ends backgrounded apps largest-first to
// reclaim memory, so an idle model is what gets Obsidian thrown out when the user
// opens the camera — and a thrown-out app cold-starts on return, which looks
// exactly like the "hard reload" this work began with. On a phone the model is
// therefore released when Obsidian goes to the background and after
// IDLE_RELEASE_MS without use, and loaded again ahead of need: when Obsidian
// comes back, and when the user focuses the chat input. Reloading from the cache
// took 0.7 s on the reporter's iPhone, so typing a question hides it.
//
// The desktop is untouched: nothing is released there.
//
// This module also owns the ONE `visibilitychange` reaction Pythia has: the
// visible clock (timeouts), the build guard (background deaths) and the release.

import type { EmbeddingBackend, EmbeddingProvider } from "./EmbeddingProvider";
import { visibleClock, type VisibleClock } from "./host/visibleClock";

/** Idle time after which a phone releases the model. Long enough that a
 *  conversation's consecutive sends keep it, short enough that a model nobody is
 *  using does not sit in memory while the user reads. */
export const IDLE_RELEASE_MS = 3 * 60_000;
/** How often the idle rule is checked. */
export const IDLE_CHECK_MS = 30_000;

/**
 * The provider with its use recorded: whether the model is loaded, whether an
 * embed is in flight, and when it was last used. Everything else passes through.
 */
export class ResidentProvider implements EmbeddingProvider {
	readonly dim: number;
	private inFlight = 0;
	private isLoaded = false;

	constructor(private readonly inner: EmbeddingProvider, private readonly onUse: () => void) {
		this.dim = inner.dim;
	}

	/** Loaded and not since released. Only a loaded model is worth releasing — and
	 *  only a SUCCESSFUL load: releasing a failed one would reset the provider's
	 *  memoized rejection and retry an out-of-memory load behind the user's back. */
	get loaded(): boolean {
		return this.isLoaded;
	}

	get busy(): boolean {
		return this.inFlight > 0;
	}

	async ready(): Promise<void> {
		await this.inner.ready();
		this.isLoaded = true;
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		this.inFlight++;
		this.onUse();
		try {
			const out = await this.inner.embed(texts);
			this.isLoaded = true;
			return out;
		} finally {
			this.inFlight--;
			this.onUse();
		}
	}

	unload(): void {
		this.inner.unload();
		this.isLoaded = false;
	}

	isOffThread(): boolean {
		return this.inner.isOffThread?.() ?? false;
	}

	backend(): EmbeddingBackend | null {
		return this.inner.backend?.() ?? null;
	}

	backendFailures(): string[] {
		return this.inner.backendFailures?.() ?? [];
	}
}

export interface ResidencyDeps {
	/** The current provider, if one exists — never constructs one. */
	provider(): ResidentProvider | null;
	/** A vault build is running; the model is never released under it. */
	building(): boolean;
	/** Release only on a phone. */
	mobile: boolean;
	/** Forward a visibility change to the build guard. */
	onBackground(hidden: boolean): void;
	log(message: string, data?: unknown): void;
	now?: () => number;
	clock?: VisibleClock;
}

export class EmbeddingResidency {
	private lastUse: number;
	/** Released by THIS rule, so it is ours to load again. A model never loaded is
	 *  not preloaded — that would be a download the user did not ask for. */
	private released = false;
	private readonly now: () => number;
	private readonly clock: VisibleClock;

	constructor(private readonly deps: ResidencyDeps) {
		this.now = deps.now ?? Date.now;
		this.clock = deps.clock ?? visibleClock;
		this.lastUse = this.now();
	}

	noteUse(): void {
		this.lastUse = this.now();
		this.released = false;
	}

	onVisibility(hidden: boolean): void {
		this.clock.note(hidden);
		this.deps.onBackground(hidden);
		if (!this.deps.mobile) return;
		if (hidden) this.release("background");
		else this.prewarm();
	}

	/** The periodic idle check. Never fires in the background (the app is frozen
	 *  there anyway, and the background rule has already run). */
	tick(hidden: boolean): void {
		if (!this.deps.mobile || hidden) return;
		if (this.now() - this.lastUse >= IDLE_RELEASE_MS) this.release("idle");
	}

	/** Load the model again ahead of need — only if this rule released it. */
	prewarm(): void {
		if (!this.released) return;
		const p = this.deps.provider();
		if (!p) return;
		this.released = false;
		this.lastUse = this.now();
		this.deps.log("embedding: preloading after release");
		p.ready().catch((e: unknown) => {
			// Not silent (principle 2): the next real use will retry and report.
			console.warn("[Pythia] embedding: preload failed", e);
		});
	}

	private release(reason: "background" | "idle"): void {
		const p = this.deps.provider();
		if (!p || !p.loaded || p.busy || this.deps.building()) return;
		p.unload();
		this.released = true;
		this.deps.log("embedding: model released", { reason });
	}
}

/** Wire the residency into a plugin: one `visibilitychange` handler, one interval. */
export function installEmbeddingResidency(
	plugin: {
		registerDomEvent(el: Document, type: "visibilitychange", cb: () => void): void;
		registerInterval(id: number): number;
	},
	deps: ResidencyDeps,
): EmbeddingResidency {
	const residency = new EmbeddingResidency(deps);
	// The handler is installed everywhere: the visible clock and the build guard
	// need it on a desktop too (only the RELEASE is mobile-only).
	plugin.registerDomEvent(document, "visibilitychange", () => residency.onVisibility(document.hidden));
	// The timer is not: `tick` returns at once off a phone, so a desktop was
	// waking twice a minute to decide it had nothing to do.
	if (deps.mobile) plugin.registerInterval(window.setInterval(() => residency.tick(document.hidden), IDLE_CHECK_MS));
	return residency;
}
