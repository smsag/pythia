import type {
	Conversation,
	Message,
	Comparison,
	ComparisonCandidate,
	Favorite,
	MergeLink,
	Provider,
} from "../models/types";
import { abbreviateModel } from "../models/knownModels";

/**
 * Model comparison on the last exchange (ADR-160) — the pure half.
 *
 * The rule that makes this simple: **while a comparison is pending, the
 * conversation ends with the user turn.** The answer the conversation already
 * had moves out of `messages` and becomes candidate 0; every alternative is
 * another candidate; nothing is an assistant message until the user keeps one.
 * History therefore never holds two answers to one prompt, the provider send
 * path (which slices off the trailing user message) works unchanged for every
 * candidate run, and "cancel" is just putting candidate 0 back.
 *
 * Keeping a candidate appends it as the assistant turn and turns each other
 * candidate into a fork spec: the same prompt, that answer, branched from the
 * kept message so the navigator lists it under Forks. The vault I/O for the
 * fork lives in ConversationService; this module only decides what it holds.
 */

const iso = (): string => new Date().toISOString();

/** The candidate that represents an existing assistant message. */
export function candidateFromMessage(msg: Message, provider: Provider, fallbackModel: string): ComparisonCandidate {
	return {
		id: msg.id,
		provider,
		model: msg.model ?? fallbackModel,
		content: msg.content,
		timestamp: msg.timestamp,
		...(msg.tokenUsage ? { tokenUsage: msg.tokenUsage } : {}),
		...(msg.sources ? { sources: msg.sources } : {}),
		...(msg.templateId ? { templateId: msg.templateId } : {}),
	};
}

/** The assistant message a candidate becomes when it is kept or forked. */
export function candidateToMessage(c: ComparisonCandidate): Message {
	return {
		id: c.id,
		role: "assistant",
		content: c.content,
		timestamp: c.timestamp,
		model: c.model,
		...(c.tokenUsage ? { tokenUsage: c.tokenUsage } : {}),
		...(c.sources ? { sources: c.sources } : {}),
		...(c.templateId ? { templateId: c.templateId } : {}),
	};
}

/**
 * Open a comparison on the conversation's last exchange. Requires the last two
 * messages to be that user turn and that assistant answer; returns null and
 * changes nothing otherwise. The answer leaves `messages` and becomes
 * candidate 0. Mutates `conv`.
 */
export function startComparison(
	conv: Conversation,
	userMessageId: string,
	assistantMessageId: string,
	makeId: () => string = () => crypto.randomUUID(),
): Comparison | null {
	if (conv.comparison) return null;
	const n = conv.messages.length;
	if (n < 2) return null;
	const user = conv.messages[n - 2];
	const answer = conv.messages[n - 1];
	if (user.id !== userMessageId || user.role !== "user") return null;
	if (answer.id !== assistantMessageId || answer.role !== "assistant") return null;
	conv.messages = conv.messages.slice(0, n - 1);
	const comparison: Comparison = {
		id: makeId(),
		userMessageId,
		candidates: [candidateFromMessage(answer, conv.provider, conv.model)],
		createdAt: iso(),
	};
	conv.comparison = comparison;
	return comparison;
}

/** The prompt a pending comparison answers, or undefined if it is gone. */
export function comparisonPrompt(conv: Conversation): Message | undefined {
	const id = conv.comparison?.userMessageId;
	return id ? conv.messages.find((m) => m.id === id && m.role === "user") : undefined;
}

/** Add a finished candidate. Mutates `conv`; no-op without a comparison. */
export function addCandidate(conv: Conversation, candidate: ComparisonCandidate): void {
	conv.comparison?.candidates.push(candidate);
}

/** Drop a candidate (a run that failed or was aborted). Candidate 0 is never
 *  removed this way — it is the conversation's own answer. */
export function removeCandidate(conv: Conversation, candidateId: string): void {
	const cmp = conv.comparison;
	if (!cmp) return;
	const idx = cmp.candidates.findIndex((c) => c.id === candidateId);
	if (idx > 0) cmp.candidates.splice(idx, 1);
}

/** What a fork made from a non-kept candidate holds. */
export interface ForkSpec {
	name: string;
	provider: Provider;
	model: string;
	messages: Message[];
	forkedFromMessageId: string;
	favorites?: Favorite[];
	merges?: MergeLink[];
}

/** `<conversation> · <Model>` — the fork is the same conversation seen through
 *  another model, and the model is the only thing that distinguishes it. */
export function forkNameFor(conversationName: string, model: string): string {
	return `${conversationName} · ${abbreviateModel(model)}`;
}

/**
 * Keep one candidate as the assistant turn; every other candidate becomes a
 * fork spec. Favorites and merge links that point at a candidate's message id
 * travel with it — to the conversation if it is kept, to its fork otherwise —
 * so a highlight made on the original answer survives choosing a different
 * one. Mutates `conv` (appends the kept message, clears the comparison,
 * moves favorites/merges); returns null if nothing matches.
 */
export function keepCandidate(
	conv: Conversation,
	candidateId: string,
): { kept: Message; forks: ForkSpec[] } | null {
	const cmp = conv.comparison;
	const prompt = comparisonPrompt(conv);
	if (!cmp || !prompt) return null;
	const chosen = cmp.candidates.find((c) => c.id === candidateId);
	if (!chosen) return null;

	const kept = candidateToMessage(chosen);
	const forks: ForkSpec[] = [];
	for (const c of cmp.candidates) {
		if (c.id === chosen.id) continue;
		const favorites = (conv.favorites ?? []).filter((f) => f.messageId === c.id);
		const merges = (conv.merges ?? []).filter((m) => m.messageId === c.id);
		forks.push({
			name: forkNameFor(conv.name, c.model),
			provider: c.provider,
			model: c.model,
			// The prompt keeps its id so a favorite on it stays findable in both places.
			messages: [{ ...prompt }, candidateToMessage(c)],
			forkedFromMessageId: kept.id,
			...(favorites.length ? { favorites } : {}),
			...(merges.length ? { merges } : {}),
		});
	}
	const movedIds = new Set(cmp.candidates.filter((c) => c.id !== chosen.id).map((c) => c.id));
	if (conv.favorites) {
		conv.favorites = conv.favorites.filter((f) => !movedIds.has(f.messageId));
		if (conv.favorites.length === 0) delete conv.favorites;
	}
	if (conv.merges) {
		conv.merges = conv.merges.filter((m) => !movedIds.has(m.messageId));
		if (conv.merges.length === 0) delete conv.merges;
	}
	conv.messages.push(kept);
	delete conv.comparison;
	return { kept, forks };
}

/** Put the original answer back and drop the comparison. Returns false if
 *  there was none. Mutates `conv`. */
export function cancelComparison(conv: Conversation): boolean {
	const cmp = conv.comparison;
	if (!cmp) return false;
	const original = cmp.candidates[0];
	if (original) conv.messages.push(candidateToMessage(original));
	delete conv.comparison;
	return true;
}

/**
 * Load-time guard (same role as `normalizeMerges`). A comparison whose prompt
 * is gone, or that has no candidate with content, cannot be resumed and is
 * dropped — restoring candidate 0 when it exists, so the answer is not lost.
 * A candidate left empty by a run the app closed on is dropped. Mutates.
 */
export function normalizeComparison(conv: Conversation): void {
	const raw = conv.comparison as unknown;
	if (raw === undefined) return;
	const cmp = raw as Partial<Comparison> | null;
	const ok =
		cmp !== null && typeof cmp === "object" &&
		typeof cmp.userMessageId === "string" &&
		Array.isArray(cmp.candidates);
	if (!ok) { delete conv.comparison; return; }
	cmp.candidates = cmp.candidates!.filter(
		(c): c is ComparisonCandidate =>
			c !== null && typeof c === "object" &&
			typeof c.id === "string" && typeof c.model === "string" &&
			typeof c.content === "string" && c.content.length > 0
	);
	if (typeof cmp.id !== "string") cmp.id = crypto.randomUUID();
	if (typeof cmp.createdAt !== "string") cmp.createdAt = iso();
	const last = conv.messages[conv.messages.length - 1];
	const promptIsLast = !!last && last.role === "user" && last.id === cmp.userMessageId;
	if (cmp.candidates.length === 0 || !promptIsLast) {
		// Cannot be resumed. Keep the original answer if the prompt is still last.
		if (promptIsLast && cmp.candidates[0]) conv.messages.push(candidateToMessage(cmp.candidates[0]));
		delete conv.comparison;
	}
}
