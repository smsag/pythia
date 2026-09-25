import { normalizeNoteWrites } from "./noteWrites";
import { PIN_KINDS, type Conversation, type Favorite, type MergeLink, type Message, type Pin, type Provider } from "../models/types";
import { OUTPUT_LANGUAGES } from "../models/types";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";
import { SELECTABLE_EMBEDDING_MODEL_IDS, SIMILARITY_PRESETS } from "../models/embeddingModels";
import { normalizeComparison } from "./comparison";

const PROVIDERS: readonly Provider[] = ["anthropic", "openai", "mistral"];
const RESUME_MODES = ["full", "summary", "hybrid"] as const;
const WRITE_MODES = ["update", "create", "none", "rewrite", "all"] as const;
const PROMPT_FRAMEWORKS = ["none", "CO-STAR", "RACE", "RISEN"] as const;
const EFFORTS = ["low", "medium", "high"] as const;

/** Keys whose saved value must be one of a fixed set; anything else falls back
 *  to the default rather than reaching a `switch` that throws on it. */
const ENUM_KEYS: Partial<Record<keyof PythiaSettings, readonly string[]>> = {
	defaultProvider: PROVIDERS,
	defaultResumeMode: RESUME_MODES,
	defaultPromptFramework: PROMPT_FRAMEWORKS,
	outputLanguage: OUTPUT_LANGUAGES,
	effort: EFFORTS,
	// Selectable ids only: a variant is chosen by the device, never stored (ADR-201).
	// A stored variant would make the desktop run it too, and match no dropdown option.
	embeddingModelId: SELECTABLE_EMBEDDING_MODEL_IDS,
	relatedSimilarity: SIMILARITY_PRESETS,
	vaultContextSimilarity: SIMILARITY_PRESETS,
};

/** Keys that may legitimately be absent (the "use the API default" state). */
const OPTIONAL_KEYS = new Set<keyof PythiaSettings>(["maxTokens", "temperature", "effort"]);

/** The conversation cap shipped up to 2.20.x. See the migration below. */
const LEGACY_DEFAULT_MAX_CONVERSATIONS = 200;

/**
 * Apply one-time settings migrations to a raw saved-settings object.
 * Mutates `saved` in place (same semantics as the original inline code).
 * Returns flags and any legacy ciphertext the caller must handle via Obsidian APIs.
 */
export function applySettingsMigrations(saved: Record<string, unknown>): {
	needsSave: boolean;
	legacyAnthropicCiphertext: string | null;
	legacyOpenAICiphertext: string | null;
} {
	let needsSave = false;
	let legacyAnthropicCiphertext: string | null = null;
	let legacyOpenAICiphertext: string | null = null;

	if (saved.apiKey) {
		delete saved.apiKey;
		needsSave = true;
	}

	if (saved.defaultModel && !saved.defaultAnthropicModel) {
		saved.defaultAnthropicModel = saved.defaultModel;
		delete saved.defaultModel;
		needsSave = true;
	}

	if (saved.encryptedApiKey) {
		legacyAnthropicCiphertext = saved.encryptedApiKey as string;
		delete saved.encryptedApiKey;
		needsSave = true;
	}

	if (saved.encryptedOpenAIKey) {
		legacyOpenAICiphertext = saved.encryptedOpenAIKey as string;
		delete saved.encryptedOpenAIKey;
		needsSave = true;
	}

	// The old 200 was never a measured number (ADR-174): at ~22 KB per
	// conversation it capped data.json around 4.5 MB, well below where anything
	// gets slow. A vault still sitting on it is one that never touched the field,
	// so it moves to the new default. Raising a cap can only ever keep more.
	if (saved.maxConversations === LEGACY_DEFAULT_MAX_CONVERSATIONS) {
		saved.maxConversations = DEFAULT_SETTINGS.maxConversations;
		needsSave = true;
	}

	if (saved.outputLanguage === "English") { saved.outputLanguage = "en"; needsSave = true; }
	if (saved.outputLanguage === "German")  { saved.outputLanguage = "de"; needsSave = true; }

	return { needsSave, legacyAnthropicCiphertext, legacyOpenAICiphertext };
}

/**
 * Merge saved settings with plugin defaults to produce a complete PythiaSettings.
 *
 * Every saved value is type-checked against its default before it is allowed to
 * override it. A plain `Object.assign` let a `null`, a string where a number was
 * expected, or an unknown enum value (from a hand edit, a sync conflict, or an
 * older build) land in `settings` — and the failure showed up far away, as
 * `vaultContextFolders.map is not a function` or an exhaustive-switch throw on
 * `defaultProvider`. Unknown keys are dropped for the same reason: they are not
 * settings, and carrying them forever only grows data.json.
 */
export function mergeSettings(saved: Record<string, unknown>): PythiaSettings {
	const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PythiaSettings)[]) {
		if (!(key in saved)) continue;
		const value = saved[key];
		if (value === undefined || value === null) {
			if (OPTIONAL_KEYS.has(key)) delete out[key];
			continue;
		}
		const allowed = ENUM_KEYS[key];
		if (allowed) {
			if (typeof value === "string" && allowed.includes(value)) out[key] = value;
			continue;
		}
		const fallback = DEFAULT_SETTINGS[key];
		if (Array.isArray(fallback)) {
			if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === "string");
			continue;
		}
		if (typeof fallback === "number") {
			if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
			continue;
		}
		if (typeof value === typeof fallback) out[key] = value;
	}
	// Optional keys have no default to type against.
	if (typeof saved.maxTokens === "number" && saved.maxTokens > 0) out.maxTokens = saved.maxTokens;
	if (typeof saved.temperature === "number" && Number.isFinite(saved.temperature)) out.temperature = saved.temperature;
	return out as unknown as PythiaSettings;
}

/**
 * Normalize a conversation's favorites for the highlight-favorites feature.
 * Legacy favorites were whole-message `{ messageId, name }` entries created by the
 * old star button; they have no `id` and no selected `text`. Ensure every favorite
 * has a stable `id` (needed for DOM tagging and deletion). Legacy entries keep
 * `text` undefined and remain valid message-level favorites — they list in the
 * navigator and jump to the message top, they simply do not paint a highlight.
 * Malformed entries (missing `messageId`) are dropped. Mutates `conv` in place.
 */
export function normalizeFavorites(
	conv: Conversation,
	makeId: () => string = () => crypto.randomUUID(),
): void {
	if (!Array.isArray(conv.favorites)) return;
	conv.favorites = conv.favorites.filter(
		(f): f is Favorite =>
			f !== null && typeof f === "object" && typeof (f as Favorite).messageId === "string"
	);
	for (const fav of conv.favorites) {
		if (typeof fav.id !== "string" || fav.id.length === 0) fav.id = makeId();
	}
}

/**
 * Sanitize a conversation's merge links at load time (ADR-130). Merge records are
 * only ever written by `cmdMergeConversation`, so there is no legacy shape to
 * migrate — this guards the read path against a truncated or hand-edited
 * data.json, for the same reason `sanitizeMessages` exists: the paint path reads
 * `merges` for every rendered message, so one malformed entry would otherwise
 * throw and take the whole message body down with it. Entries missing the three
 * fields the mark needs (`conversationId`, `messageId`, `text`) can never paint
 * or resolve a target, so they are dropped rather than repaired. Mutates in place.
 */
/**
 * Validate `conv.pins` at load (ADR-216, principle 1). A malformed entry is
 * dropped — unknown kind, empty source, no message to jump back to. The pin
 * LIMITS are deliberately not enforced here: another device or a newer version
 * may have written more, and a load must never delete what the user pinned.
 */
export function normalizePins(conv: Conversation, makeId: () => string = () => crypto.randomUUID()): void {
	if (!Array.isArray(conv.pins)) {
		if (conv.pins !== undefined) delete conv.pins;
		return;
	}
	conv.pins = conv.pins.filter(
		(p): p is Pin =>
			p !== null &&
			typeof p === "object" &&
			typeof (p as Pin).messageId === "string" &&
			(PIN_KINDS as readonly string[]).includes((p as Pin).kind) &&
			typeof (p as Pin).source === "string" &&
			(p as Pin).source.trim().length > 0
	);
	for (const pin of conv.pins) {
		if (typeof pin.id !== "string" || pin.id.length === 0) pin.id = makeId();
		if (typeof pin.createdAt !== "string") pin.createdAt = "";
		if (pin.occurrenceIndex !== undefined && (typeof pin.occurrenceIndex !== "number" || pin.occurrenceIndex < 0)) delete pin.occurrenceIndex;
	}
	if (conv.pins.length === 0) delete conv.pins;
}

export function normalizeMerges(
	conv: Conversation,
	makeId: () => string = () => crypto.randomUUID(),
): void {
	if (!Array.isArray(conv.merges)) {
		if (conv.merges !== undefined) delete conv.merges;
		return;
	}
	conv.merges = conv.merges.filter(
		(m): m is MergeLink =>
			m !== null &&
			typeof m === "object" &&
			typeof (m as MergeLink).conversationId === "string" &&
			typeof (m as MergeLink).messageId === "string" &&
			typeof (m as MergeLink).text === "string" &&
			(m as MergeLink).text.trim().length > 0
	);
	for (const merge of conv.merges) {
		if (typeof merge.id !== "string" || merge.id.length === 0) merge.id = makeId();
	}
	if (conv.merges.length === 0) delete conv.merges;
}

/**
 * Sanitize a conversation's message list at load time so downstream consumers
 * never meet a shape the type system promises but persistence never enforced.
 * `parseConversations` guarantees `messages` is an array — not that each element
 * is an object or that `content` is a string. An interrupted stream or a legacy
 * entry can leave a null element or a non-string `content`; anything that reads
 * message bodies for the whole corpus (conversation search's haystacks, the
 * related-conversations embedding chunks) would otherwise throw on the first bad
 * record and take the whole feature down. Fixing it here — once, on load — is the
 * durable root cause fix; the read-path guards remain as defense in depth.
 *
 * Non-object/null elements are dropped; a non-string `content` is coerced to ""
 * (preserving message count/position, which the provider send-path relies on).
 * Mutates `conv` in place.
 */
export function sanitizeMessages(conv: Conversation): void {
	if (!Array.isArray(conv.messages)) {
		conv.messages = [];
		return;
	}
	conv.messages = conv.messages.filter(
		(m): m is Message =>
			m !== null && typeof m === "object" &&
			// A message with no usable role cannot be sent to any provider, and a
			// missing id cannot be rendered, scrolled to, or favorited.
			((m as Message).role === "user" || (m as Message).role === "assistant") &&
			typeof (m as Message).id === "string" && (m as Message).id.length > 0
	);
	for (const m of conv.messages) {
		if (typeof m.content !== "string") m.content = m.content == null ? "" : String(m.content);
		// `truncated` is a flag that only ever reads `true`; anything else is noise
		// from a hand edit and would paint a recovery card under a finished answer.
		if (m.truncated !== undefined && m.truncated !== true) delete (m as { truncated?: unknown }).truncated;
		// A cost snapshot is `{ usd, asOf }` with a finite non-negative number;
		// anything else would render as `$NaN` on the label.
		if (m.cost !== undefined) {
			const c = m.cost as { usd?: unknown; asOf?: unknown } | null;
			const ok = !!c && typeof c === "object" && typeof c.usd === "number" && Number.isFinite(c.usd) && c.usd >= 0 && typeof c.asOf === "string";
			if (!ok) delete (m as { cost?: unknown }).cost;
		}
		// Every entry is a path the chip opens and a rename rewrites (ADR-218).
		if (m.noteWrites !== undefined) {
			const writes = normalizeNoteWrites(m.noteWrites);
			if (writes) m.noteWrites = writes;
			else delete m.noteWrites;
		}
	}
}

/**
 * Repair the scalar fields the rest of the app reads without a guard
 * (`contextNotes.length`, `provider` into an exhaustive switch, `name` into the
 * header). `parseConversations` only proves `id` and `messages`; a truncated or
 * hand-edited record can still carry `contextNotes: null` or `provider: "gemini"`,
 * and each of those used to throw on the first render or send. Mutates in place.
 */
export function sanitizeConversationFields(conv: Conversation): void {
	const c = conv as unknown as Record<string, unknown>;
	if (typeof c.name !== "string" || !c.name.trim()) c.name = "Conversation";
	if (typeof c.systemPrompt !== "string") c.systemPrompt = "";
	if (typeof c.createdAt !== "string") c.createdAt = "";
	if (typeof c.updatedAt !== "string") c.updatedAt = c.createdAt;
	c.contextNotes = Array.isArray(c.contextNotes)
		? c.contextNotes.filter((n): n is string => typeof n === "string" && n.length > 0)
		: [];
	if (!PROVIDERS.includes(c.provider as Provider)) c.provider = DEFAULT_SETTINGS.defaultProvider;
	if (typeof c.model !== "string" || !c.model) delete c.model;
	if (!(RESUME_MODES as readonly unknown[]).includes(c.resumeMode)) c.resumeMode = "full";
	if (c.writeMode !== undefined && !(WRITE_MODES as readonly unknown[]).includes(c.writeMode)) delete c.writeMode;
	if (c.outputLanguage !== undefined && !(OUTPUT_LANGUAGES as readonly unknown[]).includes(c.outputLanguage)) delete c.outputLanguage;
	if (c.favorites !== undefined && !Array.isArray(c.favorites)) delete c.favorites;
	// A term read back from disk decides whether the header offers to write into a
	// vault note, and which one (ADR-208) — so it is validated where it enters.
	if (c.glossaryTerm !== undefined && (typeof c.glossaryTerm !== "string" || !c.glossaryTerm.trim())) {
		delete c.glossaryTerm;
	}
	sanitizePendingTemplate(c);
}

/**
 * A one-shot template read back from disk (ADR-177). It reaches the send path
 * directly — its `systemPrompt` becomes the prompt and its `writeMode` decides
 * which tools the model is given — so it is validated where it enters, like
 * every other boundary (principle 1). Anything malformed is dropped: losing an
 * armed template costs one re-apply, and re-arming is the whole gesture.
 */
function sanitizePendingTemplate(c: Record<string, unknown>): void {
	const raw = c.pendingTemplate;
	if (raw === undefined) return;
	if (raw === null || typeof raw !== "object") { delete c.pendingTemplate; return; }
	const t = raw as Record<string, unknown>;
	if (typeof t.id !== "string" || !t.id || typeof t.systemPrompt !== "string") {
		delete c.pendingTemplate;
		return;
	}
	if (typeof t.name !== "string" || !t.name.trim()) t.name = t.id;
	if (!PROVIDERS.includes(t.provider as Provider)) delete t.provider;
	if (typeof t.model !== "string" || !t.model) delete t.model;
	if (typeof t.maxTokens !== "number" || !Number.isFinite(t.maxTokens) || t.maxTokens <= 0) delete t.maxTokens;
	if (typeof t.temperature !== "number" || !Number.isFinite(t.temperature)) delete t.temperature;
	if (!(EFFORTS as readonly unknown[]).includes(t.effort)) delete t.effort;
	if (!(WRITE_MODES as readonly unknown[]).includes(t.writeMode)) delete t.writeMode;
	if (typeof t.outputFolder !== "string") delete t.outputFolder;
	t.contextNotes = Array.isArray(t.contextNotes)
		? t.contextNotes.filter((n): n is string => typeof n === "string" && n.length > 0)
		: undefined;
	if (!(t.contextNotes as string[] | undefined)?.length) delete t.contextNotes;
}

/**
 * Validate raw conversation entries from data.json.
 * Returns valid Conversation objects and the count of dropped malformed entries.
 */
export function parseConversations(raw: unknown[]): {
	conversations: Conversation[];
	dropped: number;
} {
	const conversations = raw.filter(
		(c): c is Conversation =>
			c !== null &&
			typeof c === "object" &&
			typeof (c as Record<string, unknown>).id === "string" &&
			Array.isArray((c as Record<string, unknown>).messages)
	);
	for (const conv of conversations) {
		sanitizeConversationFields(conv);
		sanitizeMessages(conv);
		normalizeFavorites(conv);
		normalizeMerges(conv);
		normalizePins(conv);
		normalizeComparison(conv);
	}
	return { conversations, dropped: raw.length - conversations.length };
}

/** Outcome of reconciling the in-memory conversation list with the one on disk. */
export interface MergeOutcome {
	conversations: Conversation[];
	/** How many conversations were taken from memory because disk was stale or missing them. */
	keptFromMemory: number;
	/** Their ids — the conversations disk is BEHIND on, and so the only ones a
	 *  flush has to write. A tie is not among them (#356). */
	newerInMemory: string[];
}

/**
 * Reconcile the conversations held in memory with the ones just read from disk
 * (ADR-133), keeping the newer copy of each.
 *
 * The plugin re-reads data.json whenever its mtime changes, which on an iCloud or
 * Obsidian Sync vault happens constantly in the background. That read used to
 * REPLACE the in-memory list wholesale. Any conversation whose disk copy was
 * older than memory — a sync delivering another device's state, a cloud copy
 * materializing late, or simply a write that had not landed yet — silently rolled
 * back, and the rollback became permanent on the next save. The visible symptom is
 * a conversation that keeps its earlier turns and loses its newest one.
 *
 * Reconciling per conversation on `updatedAt` makes that impossible: a stale disk
 * copy can no longer overwrite fresher state, and a genuinely newer copy from
 * another device still wins.
 *
 * Ties go to memory, which may hold edits not yet stamped onto disk — but a tie
 * is not NEWER, so it is not counted and not reported for writing (#356). Edits
 * not yet on disk are already dirty in the store; counting every tie made each
 * reload mark every conversation dirty, rewrite the whole file, and trip the
 * watcher into the next reload — a loop that re-synced data.json every few
 * seconds.
 *
 * A conversation present in only one side is KEPT rather than treated as deleted.
 * Without tombstones, "deleted elsewhere" and "created here and not yet saved"
 * look identical, and resurrecting a deleted conversation is a far smaller harm
 * than destroying one the user is still writing in. Deletes on this device are
 * unaffected: `ConversationStore.delete` removes the conversation from memory and
 * persists immediately, so neither side still holds it.
 *
 * Ordering follows disk, with memory-only conversations appended. The rest of the
 * app treats the array as insertion-ordered (`conversations[length - 1]` is "most
 * recent"), so unsaved conversations belong at the end. On a first load memory is
 * empty and the result is exactly the disk list, unchanged.
 */
export function mergeConversations(
	memory: Conversation[],
	disk: Conversation[],
): MergeOutcome {
	const byId = new Map(memory.map((c) => [c.id, c]));
	const taken = new Set<string>();
	const conversations: Conversation[] = [];
	const newerInMemory: string[] = [];

	for (const diskConv of disk) {
		const memConv = byId.get(diskConv.id);
		if (!memConv) {
			conversations.push(diskConv);
			continue;
		}
		taken.add(diskConv.id);
		// ISO 8601 sorts chronologically, so a plain compare is enough. A missing
		// timestamp sorts oldest, which is the safe direction: it loses only to a
		// copy that actually carries one.
		const memStamp = memConv.updatedAt ?? "", diskStamp = diskConv.updatedAt ?? "";
		conversations.push(memStamp >= diskStamp ? memConv : diskConv);
		if (memStamp > diskStamp) newerInMemory.push(memConv.id);
	}

	const memoryOnly = memory.filter((c) => !taken.has(c.id));
	conversations.push(...memoryOnly);
	newerInMemory.push(...memoryOnly.map((c) => c.id));

	return { conversations, keptFromMemory: newerInMemory.length, newerInMemory };
}

/**
 * Check whether a disk load should be refused because iCloud evicted data.json.
 * Returns true (refuse) when loaded is empty but conversations already exist in memory.
 */
export function shouldRefuseLoad(loaded: Conversation[], existingCount: number): boolean {
	return loaded.length === 0 && existingCount > 0;
}

/** Sorts by updatedAt descending; tolerates a missing/invalid updatedAt (sorts it last)
 *  rather than throwing — a single malformed record must not break eviction entirely. */
function byUpdatedAtDesc(a: Conversation, b: Conversation): number {
	return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

/**
 * Evict the oldest unprotected conversations when `conversations.length > cap`.
 * Starred conversations (any favorites), every currently-active conversation
 * (one per open sidebar leaf, not just one), and every conversation another
 * conversation has merged with (ADR-130) are always kept.
 *
 * Merge targets are protected for the same reason favorites are: a merge link
 * paints only while its target exists, so evicting a target would silently
 * delete a link the user deliberately placed, with no warning and nothing left
 * on screen to explain the disappearance.
 *
 * Survivors are returned in the SAME relative order as the input — the rest of
 * the app (e.g. `onOpen`/`handleDeleteConversation` picking the most recent as
 * `conversations[length - 1]`) treats the array as insertion-ordered, so
 * re-sorting the survivors here would silently make "most recent" resolve to the
 * oldest after an eviction. `updatedAt` is used only to choose WHICH plain
 * conversations to keep, not to reorder the result.
 * When cap === 0 (unlimited) or length ≤ cap the input is returned unchanged.
 */
export function evictConversations(
	conversations: Conversation[],
	cap: number,
	activeIds: string[],
): Conversation[] {
	return partitionEvictions(conversations, cap, activeIds).kept;
}

/**
 * The same decision, with the losers named (ADR-172). The archive has to write
 * the conversations before they are dropped, and the confirmation dialog has to
 * count them — both read this rather than re-deriving which ones go, because a
 * second copy of the protection rules is a second answer to the same question.
 */
export function partitionEvictions(
	conversations: Conversation[],
	cap: number,
	activeIds: string[],
): { kept: Conversation[]; removed: Conversation[] } {
	if (cap <= 0 || conversations.length <= cap) return { kept: conversations, removed: [] };

	const activeIdSet = new Set(activeIds);
	const mergeTargetIds = new Set(
		conversations.flatMap((c) => (c.merges ?? []).map((m) => m.conversationId))
	);
	const isProtected = (c: Conversation) =>
		(c.favorites?.length ?? 0) > 0 || (c.pins?.length ?? 0) > 0 || activeIdSet.has(c.id) || mergeTargetIds.has(c.id);

	// Choose which plain (unprotected) conversations survive: the newest `slots`
	// by updatedAt. Selection is by date; the result order is not.
	const plainNewestFirst = conversations.filter((c) => !isProtected(c)).sort(byUpdatedAtDesc);
	const protectedCount = conversations.length - plainNewestFirst.length;
	const slots = Math.max(0, cap - protectedCount);
	const keptPlainIds = new Set(plainNewestFirst.slice(0, slots).map((c) => c.id));

	const survives = (c: Conversation): boolean => isProtected(c) || keptPlainIds.has(c.id);
	return {
		kept: conversations.filter(survives),
		removed: conversations.filter((c) => !survives(c)),
	};
}

/**
 * How many conversations `evictConversations` would delete at this cap (ADR-171).
 *
 * Lowering the cap is the only settings value that destroys content, so the
 * settings tab names the number and asks before applying it. The count comes
 * from the eviction itself rather than from a second copy of its protection
 * rules — otherwise the dialog would promise one number and the write perform
 * another the first time a rule changes.
 */
export function countEvictions(
	conversations: Conversation[],
	cap: number,
	activeIds: string[],
): number {
	return partitionEvictions(conversations, cap, activeIds).removed.length;
}
