import type { Conversation, Favorite } from "../models/types";
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
	for (const conv of conversations) normalizeFavorites(conv);
	return { conversations, dropped: raw.length - conversations.length };
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
 * Starred conversations (any favorites) and every currently-active conversation
 * (one per open sidebar leaf, not just one) are always kept.
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
	const isProtected = (c: Conversation) =>
		(c.favorites?.length ?? 0) > 0 || activeIdSet.has(c.id);

	// Choose which plain (unprotected) conversations survive: the newest `slots`
	// by updatedAt. Selection is by date; the result order is not.
	const plainNewestFirst = conversations.filter((c) => !isProtected(c)).sort(byUpdatedAtDesc);
	const protectedCount = conversations.length - plainNewestFirst.length;
	const slots = Math.max(0, cap - protectedCount);
	const keptPlainIds = new Set(plainNewestFirst.slice(0, slots).map((c) => c.id));

	return conversations.filter((c) => isProtected(c) || keptPlainIds.has(c.id));
}
