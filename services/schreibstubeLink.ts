import type { App } from "obsidian";
import type { Conversation } from "../models/types";

/**
 * Schreibstube's search by meaning, reached from Pythia (ADR-223).
 *
 * Schreibstube owns the one language model on the device and indexes the
 * vault; Pythia hands it the conversations, which live in Pythia's own data
 * file and are invisible to a vault index. Whether Schreibstube is there is
 * asked every time, never cached: it can be switched on, off or updated while
 * Pythia runs, and each load brings a new API object.
 *
 * The plugin registry (`app.plugins`) is undocumented, which is why this is
 * the one module that reads it, and why every step is feature-detected: an
 * Obsidian without it, a Schreibstube without an API, or one with another
 * version all read as "not available", never as an error.
 */

export interface SchreibstubeHit {
	kind: "note" | "image" | "conversation";
	id: string;
	title: string;
	score: number;
}

/** The part of Schreibstube's API v1 Pythia uses. */
export interface SchreibstubeApi {
	readonly version: 1;
	ready(): boolean;
	search(text: string, opts: { kinds: SchreibstubeHit["kind"][]; limit: number; exclude?: string[] }): Promise<SchreibstubeHit[]>;
	related(ref: { source: string; id: string }, opts: { kinds: SchreibstubeHit["kind"][]; limit: number }): Promise<SchreibstubeHit[]>;
	registerSource(pluginId: string, source: { list(): unknown[]; onChanged(cb: () => void): () => void }): () => void;
}

/** Schreibstube's API when it is installed, enabled and speaks version 1. */
export function readSchreibstubeApi(app: App): SchreibstubeApi | null {
	const registry = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	if (typeof registry?.getPlugin !== "function") return null;
	const plugin = registry.getPlugin("schreibstube") as { api?: unknown } | null | undefined;
	const api = plugin?.api as Partial<SchreibstubeApi> | null | undefined;
	if (!api || api.version !== 1) return null;
	const complete = ["ready", "search", "related", "registerSource"].every(
		(name) => typeof (api as Record<string, unknown>)[name] === "function"
	);
	return complete ? (api as SchreibstubeApi) : null;
}

/** A conversation as Schreibstube indexes it: title and summary lead, then the
 *  message texts — the same text Pythia's own index embedded, so its vectors
 *  carry over. */
export function toSourceItem(conv: Conversation): {
	id: string;
	title: string;
	updatedAt: number;
	summary: string;
	messages: string[];
} {
	const updated = Date.parse(conv.updatedAt ?? "");
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	return {
		id: conv.id,
		title: typeof conv.name === "string" ? conv.name : "",
		updatedAt: Number.isFinite(updated) ? updated : 0,
		summary: typeof conv.summaryText === "string" ? conv.summaryText : "",
		messages: messages.map((m) => (typeof m?.content === "string" ? m.content : "")),
	};
}

export interface SchreibstubeLinkHost {
	app: App;
	conversations(): Conversation[];
	/** Subscribe to changes of the conversation list; returns the unsubscribe. */
	onConversationsChanged(cb: () => void): () => void;
	log(message: string, data?: unknown): void;
}

/**
 * The connection itself: hands the conversations over once per Schreibstube
 * API object, and asks it. Every question answers "nothing" rather than
 * throwing when Schreibstube is gone or fails, so a search box never breaks
 * because another plugin did.
 */
export class SchreibstubeLink {
	private registeredWith: SchreibstubeApi | null = null;
	private release: (() => void) | null = null;

	constructor(private readonly host: SchreibstubeLinkHost) {}

	/** Schreibstube's API if search by meaning can answer here and now. */
	private api(): SchreibstubeApi | null {
		const api = readSchreibstubeApi(this.host.app);
		if (!api) return null;
		try {
			if (!api.ready()) return null;
		} catch {
			return null;
		}
		this.register(api);
		return api;
	}

	/** Whether search by meaning is available — the check the search view makes. */
	available(): boolean {
		return this.api() !== null;
	}

	private register(api: SchreibstubeApi): void {
		if (this.registeredWith === api) return;
		this.release?.();
		this.release = null;
		try {
			this.release = api.registerSource("pythia", {
				list: () => this.host.conversations().map(toSourceItem),
				onChanged: (cb) => this.host.onConversationsChanged(cb),
			});
			this.registeredWith = api;
		} catch (e) {
			this.host.log("schreibstube: could not register the conversations", e);
		}
	}

	/** Ids of the conversations that answer `text` by meaning, best first. */
	async searchConversations(text: string, limit: number): Promise<string[]> {
		const api = this.api();
		if (!api) return [];
		try {
			const hits = await api.search(text, { kinds: ["conversation"], limit });
			return hits.filter((h) => h.kind === "conversation").map((h) => h.id);
		} catch (e) {
			this.host.log("schreibstube: search failed", e);
			return [];
		}
	}

	/** Conversations like `id`, most alike first. */
	async related(id: string, limit: number): Promise<{ id: string; score: number }[]> {
		const api = this.api();
		if (!api) return [];
		try {
			const hits = await api.related({ source: "pythia", id }, { kinds: ["conversation"], limit });
			return hits.filter((h) => h.kind === "conversation").map((h) => ({ id: h.id, score: h.score }));
		} catch (e) {
			this.host.log("schreibstube: related failed", e);
			return [];
		}
	}

	dispose(): void {
		this.release?.();
		this.release = null;
		this.registeredWith = null;
	}
}
