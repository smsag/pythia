import type { FootnoteWebSource } from "./noteFootnotes";

/**
 * The Ablage: Pythia's own clipboard, ONE item, inserted into a note when the
 * user chooses — at that moment, where the cursor is (ADR-246).
 *
 * One slot by the user's decision: a new item replaces the last, and inserting
 * empties it. It lives in data.json, not the system clipboard, which the next
 * copy overwrites and which iOS guards.
 *
 * The slot carries `updatedAt` even when empty, so a sync can tell an emptied
 * Ablage from a stale copy that still holds the item: the newer write wins,
 * and an insert on one device is not undone by a file from another.
 */
export interface AblageItem {
	text: string;
	/** The fetched results the text's web citations name, so they become
	 *  footnotes at insert time, numbered around the target note's own. */
	sources?: FootnoteWebSource[];
	conversationId?: string;
	/** Put there by the model's stage_text, not by the user: the menu says so,
	 *  so model text is never mistaken for the user's own (principle 9). */
	byModel?: boolean;
	createdAt: string;        // ISO 8601; also what an insert checks it still holds
}

export interface AblageSlot {
	item?: AblageItem;
	updatedAt: string;        // ISO 8601
}

/** A pin's limit (ADR-216): past it the item is refused, never truncated. */
export const ABLAGE_MAX_CHARS = 20_000;

export type AblagePut = "ok" | "empty" | "too-long";

export function checkAblageText(text: string): AblagePut {
	if (!text.trim()) return "empty";
	return text.length > ABLAGE_MAX_CHARS ? "too-long" : "ok";
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

function normalizeSources(value: unknown): FootnoteWebSource[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((s): s is FootnoteWebSource =>
		!!s && typeof s === "object"
		&& typeof (s as FootnoteWebSource).n === "number"
		&& typeof (s as FootnoteWebSource).url === "string"
		&& /^https?:\/\//i.test((s as FootnoteWebSource).url)
		&& ((s as FootnoteWebSource).title === undefined || typeof (s as FootnoteWebSource).title === "string"))
		.map((s) => ({ n: s.n, url: s.url, ...(s.title !== undefined ? { title: s.title } : {}) }));
	return out.length > 0 ? out : undefined;
}

/** The slot as read from data.json: anything malformed is no slot at all. */
export function normalizeAblage(value: unknown): AblageSlot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	if (!isIso(v.updatedAt)) return undefined;
	const raw = v.item as Record<string, unknown> | undefined;
	if (raw === undefined) return { updatedAt: v.updatedAt };
	if (!raw || typeof raw !== "object" || typeof raw.text !== "string" || !isIso(raw.createdAt)
		|| checkAblageText(raw.text) !== "ok") {
		return { updatedAt: v.updatedAt };
	}
	const sources = normalizeSources(raw.sources);
	return {
		updatedAt: v.updatedAt,
		item: {
			text: raw.text,
			createdAt: raw.createdAt,
			...(sources ? { sources } : {}),
			...(typeof raw.conversationId === "string" ? { conversationId: raw.conversationId } : {}),
			...(raw.byModel === true ? { byModel: true } : {}),
		},
	};
}

/** The newer write wins; a tie keeps what is in memory (ADR-133: a tie is not newer). */
export function mergeAblage(memory: AblageSlot | undefined, disk: AblageSlot | undefined): AblageSlot | undefined {
	if (!disk) return memory;
	if (!memory) return disk;
	return Date.parse(disk.updatedAt) > Date.parse(memory.updatedAt) ? disk : memory;
}

/** One line for a menu: the first non-empty line, cut with an ellipsis. */
export function ablagePreview(text: string, max = 40): string {
	const line = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export interface AblageHost {
	slot(): AblageSlot | undefined;
	setSlot(slot: AblageSlot): void;
	persist(): Promise<void>;
}

/** The slot's two verbs. The model may `put`; only the user's gesture `take`s. */
export class Ablage {
	constructor(private readonly host: AblageHost, private readonly now: () => Date = () => new Date()) {}

	get item(): AblageItem | undefined { return this.host.slot()?.item; }

	async put(text: string, extra: Omit<AblageItem, "text" | "createdAt"> = {}): Promise<AblagePut> {
		const check = checkAblageText(text);
		if (check !== "ok") return check;
		const at = this.now().toISOString();
		this.host.setSlot({ updatedAt: at, item: { text, createdAt: at, ...extra } });
		await this.host.persist();
		return "ok";
	}

	/**
	 * Empty the slot and return what it held — only if it still holds the item
	 * the user chose (`createdAt`). A menu opened before another put, or before
	 * an insert elsewhere, must not insert something the user never saw.
	 */
	async take(createdAt: string): Promise<AblageItem | null> {
		const item = this.item;
		if (!item || item.createdAt !== createdAt) return null;
		this.host.setSlot({ updatedAt: this.now().toISOString() });
		await this.host.persist();
		return item;
	}
}
