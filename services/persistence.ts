import type { Conversation, Favorite, MergeLink, Message } from "../models/types";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";

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

	if (saved.outputLanguage === "English") { saved.outputLanguage = "en"; needsSave = true; }
	if (saved.outputLanguage === "German")  { saved.outputLanguage = "de"; needsSave = true; }

	return { needsSave, legacyAnthropicCiphertext, legacyOpenAICiphertext };
}

/** Merge saved settings with plugin defaults to produce a complete PythiaSettings. */
export function mergeSettings(saved: Record<string, unknown>): PythiaSettings {
	return Object.assign({}, DEFAULT_SETTINGS, saved) as PythiaSettings;
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
		(m): m is Message => m !== null && typeof m === "object"
	);
	for (const m of conv.messages) {
		if (typeof m.content !== "string") m.content = m.content == null ? "" : String(m.content);
	}
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
		sanitizeMessages(conv);
		normalizeFavorites(conv);
		normalizeMerges(conv);
	}
	return { conversations, dropped: raw.length - conversations.length };
}

/** Outcome of reconciling the in-memory conversation list with the one on disk. */
export interface MergeOutcome {
	conversations: Conversation[];
	/** How many conversations were taken from memory because disk was stale or missing them. */
	keptFromMemory: number;
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
 * Ties go to memory, which may hold edits not yet stamped onto disk.
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
		const memWins = (memConv.updatedAt ?? "") >= (diskConv.updatedAt ?? "");
		conversations.push(memWins ? memConv : diskConv);
	}

	const memoryOnly = memory.filter((c) => !taken.has(c.id));
	conversations.push(...memoryOnly);

	const keptFromMemory =
		conversations.filter((c) => byId.get(c.id) === c).length;
	return { conversations, keptFromMemory };
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
	if (cap <= 0 || conversations.length <= cap) return conversations;

	const activeIdSet = new Set(activeIds);
	const mergeTargetIds = new Set(
		conversations.flatMap((c) => (c.merges ?? []).map((m) => m.conversationId))
	);
	const isProtected = (c: Conversation) =>
		(c.favorites?.length ?? 0) > 0 || activeIdSet.has(c.id) || mergeTargetIds.has(c.id);

	// Choose which plain (unprotected) conversations survive: the newest `slots`
	// by updatedAt. Selection is by date; the result order is not.
	const plainNewestFirst = conversations.filter((c) => !isProtected(c)).sort(byUpdatedAtDesc);
	const protectedCount = conversations.length - plainNewestFirst.length;
	const slots = Math.max(0, cap - protectedCount);
	const keptPlainIds = new Set(plainNewestFirst.slice(0, slots).map((c) => c.id));

	return conversations.filter((c) => isProtected(c) || keptPlainIds.has(c.id));
}
