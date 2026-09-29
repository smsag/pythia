import type { App } from "obsidian";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { resumeDeepLink } from "../utils";

/**
 * Schreibstube's search by meaning, reached from Pythia (ADR-223, ADR-251).
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

/** Related conversations asked for at most: a screenful. Past it the list grows
 *  with the vault, not with relevance (ADR-169). */
export const RELATED_RESULT_LIMIT = 20;

/** The name Pythia registers under, which Schreibstube holds to the plugin id. */
const SOURCE_ID = "pythia";

/** Conversations handed over at most, newest first: Schreibstube indexes no
 *  more of one source, and the cursor stays far below its 256 KB bound. */
export const MAX_SOURCE_ITEMS = 1000;

export interface SchreibstubeHit {
	kind: string;
	id: string;
	title: string;
	/** Relevance against the floor measured for its kind, 0 to 1. */
	score: number;
	similarity: number;
	source?: string;
	item?: string;
}

export type SchreibstubeStatus = "off" | "loading" | "partial" | "ready";
export type SchreibstubeConsent = "pending" | "allowed" | "denied";

interface QueryOptions {
	kinds?: string[];
	sources?: string[];
	limit?: number;
	exclude?: string[];
}

/** The part of Schreibstube's API v2 Pythia uses. */
export interface SchreibstubeApi {
	readonly version: 2;
	status(): SchreibstubeStatus;
	search(text: string, opts?: QueryOptions): Promise<SchreibstubeHit[]>;
	related(ref: { source: string; id: string }, opts?: Omit<QueryOptions, "exclude">): Promise<SchreibstubeHit[]>;
	registerSource(sourceId: string, source: Record<string, unknown>): {
		release(): void;
		consent(): SchreibstubeConsent;
	};
}

/** Schreibstube's API when it is installed, enabled and speaks version 2. */
export function readSchreibstubeApi(app: App): SchreibstubeApi | null {
	const registry = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	if (typeof registry?.getPlugin !== "function") return null;
	const plugin = registry.getPlugin("schreibstube") as { api?: unknown } | null | undefined;
	const api = plugin?.api as Partial<SchreibstubeApi> | null | undefined;
	if (!api || api.version !== 2) return null;
	const complete = ["status", "search", "related", "registerSource"].every(
		(name) => typeof (api as Record<string, unknown>)[name] === "function"
	);
	return complete ? (api as SchreibstubeApi) : null;
}

/** A conversation as Schreibstube indexes it: title and summary lead, then the
 *  message texts — the same text Pythia's own index embedded. `notes` are the
 *  notes attached as context: Schreibstube's Recommended panel counts each as
 *  a link between the note and the conversation. They are not embedded, so
 *  handing them over re-indexes nothing. */
export function toSourceItem(conv: Conversation): {
	id: string;
	title: string;
	updatedAt: number;
	summary: string;
	messages: string[];
	notes: string[];
} {
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	return {
		id: conv.id,
		title: typeof conv.name === "string" ? conv.name : "",
		updatedAt: updatedAtOf(conv),
		summary: typeof conv.summaryText === "string" ? conv.summaryText : "",
		messages: messages.map((m) => (typeof m?.content === "string" ? m.content : "")),
		notes: Array.isArray(conv.contextNotes)
			? conv.contextNotes.filter((path): path is string => typeof path === "string" && path.length > 0)
			: [],
	};
}

function updatedAtOf(conv: Conversation): number {
	const updated = Date.parse(conv.updatedAt ?? "");
	return Number.isFinite(updated) ? updated : 0;
}

/** The conversations Schreibstube is given, newest first. */
function handedOver(conversations: Conversation[]): Conversation[] {
	return [...conversations].sort((a, b) => updatedAtOf(b) - updatedAtOf(a)).slice(0, MAX_SOURCE_ITEMS);
}

/** A short fingerprint of what Schreibstube reads of a conversation. It is
 *  compared, never trusted, so a collision costs one missed re-embed at worst;
 *  the message count stands in for the texts, which change only with it or
 *  with `updatedAt`. */
function fingerprint(conv: Conversation): string {
	const item = toSourceItem(conv);
	const text = [item.updatedAt, item.title, item.messages.length, item.summary, item.notes.join("\n")].join("\u0000");
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

function readCursor(cursor: unknown): Map<string, string> {
	const seen = new Map<string, string>();
	if (typeof cursor !== "string") return seen;
	try {
		const parsed: unknown = JSON.parse(cursor);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return seen;
		for (const [id, print] of Object.entries(parsed)) if (typeof print === "string") seen.set(id, print);
	} catch {
		// A cursor Pythia cannot read is a first listing: everything is new.
	}
	return seen;
}

/**
 * What changed since `cursor`, Schreibstube's incremental listing. The cursor
 * is Pythia's own: each conversation's fingerprint, so a conversation synced
 * in from another device, or with a clock ahead, is reported all the same —
 * a timestamp would have hidden both.
 */
export function sourceChanges(
	conversations: Conversation[],
	cursor: unknown
): { changed: ReturnType<typeof toSourceItem>[]; removed: string[]; cursor: string } {
	const before = readCursor(cursor);
	const now: Record<string, string> = {};
	const changed: ReturnType<typeof toSourceItem>[] = [];
	for (const conv of handedOver(conversations)) {
		if (typeof conv.id !== "string" || conv.id.length === 0) continue;
		const print = fingerprint(conv);
		now[conv.id] = print;
		if (before.get(conv.id) !== print) changed.push(toSourceItem(conv));
	}
	const removed = [...before.keys()].filter((id) => !Object.hasOwn(now, id));
	return { changed, removed, cursor: JSON.stringify(now) };
}

export interface SchreibstubeLinkHost {
	app: App;
	conversations(): Conversation[];
	/** Subscribe to changes of the conversation list; returns the unsubscribe. */
	onConversationsChanged(cb: () => void): () => void;
	/** Show a conversation, when Schreibstube's Recommended panel is pressed on one. */
	openConversation(id: string): void;
	log(message: string, data?: unknown): void;
}

/**
 * The connection itself: hands the conversations over once per Schreibstube
 * API object, and asks it. Every question answers "nothing" rather than
 * throwing when Schreibstube is gone or fails, so a search box never breaks
 * because another plugin did.
 *
 * Registering is not answering: Schreibstube reads a source only once the
 * person has allowed it, and says so through `consent()`. Pythia registers
 * whenever Schreibstube is there, so the question is put to the person
 * before the first search rather than after.
 */
export class SchreibstubeLink {
	private registeredWith: SchreibstubeApi | null = null;
	private registration: ReturnType<SchreibstubeApi["registerSource"]> | null = null;

	constructor(private readonly host: SchreibstubeLinkHost) {}

	/** Schreibstube's API, registered with, when it is there at all. */
	private reach(): SchreibstubeApi | null {
		const api = readSchreibstubeApi(this.host.app);
		if (api) this.register(api);
		return api;
	}

	/** Schreibstube's API if search by meaning can answer here and now. */
	private api(): SchreibstubeApi | null {
		const api = this.reach();
		if (!api) return null;
		try {
			const status = api.status();
			return status === "partial" || status === "ready" ? api : null;
		} catch (e) {
			this.host.log("schreibstube: could not ask its status", e);
			return null;
		}
	}

	/** Whether search by meaning is available — the check the search view makes. */
	available(): boolean {
		return this.api() !== null;
	}

	/** What the person said about Pythia's conversations in Schreibstube; null
	 *  when Schreibstube is not there to ask. */
	consent(): SchreibstubeConsent | null {
		if (!this.reach()) return null;
		try {
			return this.registration?.consent() ?? null;
		} catch (e) {
			this.host.log("schreibstube: could not ask whether Pythia is allowed", e);
			return null;
		}
	}

	private register(api: SchreibstubeApi): void {
		if (this.registeredWith === api) return;
		this.release();
		const host = this.host;
		try {
			this.registration = api.registerSource(SOURCE_ID, {
				kind: "conversation",
				label: t("schreibstubeSourceLabel"),
				plural: t("schreibstubeSourcePlural"),
				icon: "pythia",
				list: () => handedOver(host.conversations()).map(toSourceItem),
				// Asked instead of list() once Schreibstube holds a cursor: the
				// conversations changed since, not every message of every one.
				changes: (cursor: string | null) => sourceChanges(host.conversations(), cursor),
				onChanged: (cb: () => void) => host.onConversationsChanged(cb),
				open: (id: string) => host.openConversation(id),
				link: (id: string) => resumeDeepLink(id, host.app.vault.getName()),
			});
		} catch (e) {
			host.log("schreibstube: could not register the conversations", e);
		}
		// A refusal is this API object's answer, not a hiccup: asked again on
		// every search it would only log again, until Schreibstube reloads.
		this.registeredWith = api;
	}

	private release(): void {
		try {
			this.registration?.release();
		} catch (e) {
			this.host.log("schreibstube: could not release the conversations", e);
		}
		this.registration = null;
		this.registeredWith = null;
	}

	/** Ids of the conversations that answer `text` by meaning, best first. */
	async searchConversations(text: string, limit: number): Promise<string[]> {
		const api = this.api();
		if (!api) return [];
		try {
			const hits = await api.search(text, { kinds: ["conversation"], sources: [SOURCE_ID], limit });
			return hits.flatMap((h) => (h.source === SOURCE_ID && h.item ? [h.item] : []));
		} catch (e) {
			this.host.log("schreibstube: search failed", e);
			return [];
		}
	}

	/** Paths of the notes that answer `text` by meaning, best first. */
	async searchNotes(text: string, limit: number, exclude: string[]): Promise<string[]> {
		const api = this.api();
		if (!api) return [];
		try {
			const hits = await api.search(text, { kinds: ["note"], limit, exclude });
			return hits.filter((h) => h.kind === "note").map((h) => h.id);
		} catch (e) {
			this.host.log("schreibstube: note search failed", e);
			return [];
		}
	}

	/** Conversations like `id`, most alike first. */
	async related(id: string, limit: number): Promise<{ id: string; score: number }[]> {
		const api = this.api();
		if (!api) return [];
		try {
			const hits = await api.related(
				{ source: SOURCE_ID, id },
				{ kinds: ["conversation"], sources: [SOURCE_ID], limit }
			);
			return hits.flatMap((h) => (h.source === SOURCE_ID && h.item ? [{ id: h.item, score: h.score }] : []));
		} catch (e) {
			this.host.log("schreibstube: related failed", e);
			return [];
		}
	}

	dispose(): void {
		this.release();
	}
}
