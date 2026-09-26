import type {
	Conversation,
	Message,
	Comparison,
	ComparisonCandidate,
	Provider,
	RewriteTarget,
} from "../models/types";
import { MODEL_CATALOG } from "../models/knownModels";
import { normalizeNoteWrites } from "./noteWrites";

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
 * Keeping a candidate appends it as the assistant turn and keeps every other
 * candidate ON it, as `alternatives` — the tabs stay (ADR-219, revising
 * ADR-160's forks, which took the other answers out of sight). While that
 * answer is still the last one, `switchAlternative` can make another tab the
 * one the conversation holds.
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
		...(msg.cost ? { cost: msg.cost } : {}),
		...(msg.noteWrites ? { noteWrites: msg.noteWrites } : {}),
		...(msg.truncated ? { truncated: true as const } : {}),
		...(msg.rewriteTarget ? { rewriteTarget: msg.rewriteTarget } : {}),
	};
}

/** The assistant message a candidate becomes when it is kept. */
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
		...(c.cost ? { cost: c.cost } : {}),
		...(c.noteWrites ? { noteWrites: c.noteWrites } : {}),
		...(c.truncated ? { truncated: true as const } : {}),
		...(c.rewriteTarget ? { rewriteTarget: c.rewriteTarget } : {}),
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
	// An answer kept from an earlier comparison brings its tabs back as
	// candidates, or a second comparison would silently drop them (ADR-219).
	const prior = answer.alternatives ?? [];
	const comparison: Comparison = {
		id: makeId(),
		userMessageId,
		candidates: [candidateFromMessage(answer, conv.provider, conv.model), ...prior],
		createdAt: iso(),
		...(prior.length > 0 ? { priorAlternativeIds: prior.map((c) => c.id) } : {}),
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

/**
 * Keep one candidate as the assistant turn; every other candidate stays on it
 * as an alternative tab (ADR-219). Nothing is forked: favorites and merge links
 * made on a non-kept answer stay on the conversation under that answer's id and
 * are painted when its tab is shown. Mutates `conv` (appends the kept message,
 * clears the comparison); returns null if nothing matches.
 */
export function keepCandidate(conv: Conversation, candidateId: string): { kept: Message } | null {
	const cmp = conv.comparison;
	const prompt = comparisonPrompt(conv);
	if (!cmp || !prompt) return null;
	const chosen = cmp.candidates.find((c) => c.id === candidateId);
	if (!chosen) return null;

	const kept = candidateToMessage(chosen);
	const alternatives = cmp.candidates.filter((c) => c.id !== chosen.id);
	if (alternatives.length > 0) kept.alternatives = alternatives;
	conv.messages.push(kept);
	delete conv.comparison;
	return { kept };
}

/**
 * Whether the answer `messageId` may change which of its tabs the conversation
 * holds: only while it is the LAST message and no comparison is pending. A
 * later turn was built on the kept answer — the same rule as Retry (ADR-162).
 */
export function canSwitchAlternative(conv: Conversation, messageId: string): boolean {
	const last = conv.messages[conv.messages.length - 1];
	return !conv.comparison && !!last && last.id === messageId && last.role === "assistant" && !!last.alternatives?.length;
}

/**
 * Make alternative `candidateId` the answer the conversation holds, and the
 * answer it held an alternative (ADR-219). Each keeps its own id, so a
 * favorite, merge link or pin stays with its text. Returns false and changes
 * nothing when `canSwitchAlternative` says no or the id is unknown. Mutates.
 */
export function switchAlternative(conv: Conversation, messageId: string, candidateId: string): boolean {
	if (!canSwitchAlternative(conv, messageId)) return false;
	const current = conv.messages[conv.messages.length - 1];
	const alternatives = current.alternatives ?? [];
	const idx = alternatives.findIndex((c) => c.id === candidateId);
	if (idx < 0) return false;
	const chosen = alternatives[idx];
	// A message does not record its provider; the catalog knows it for a known
	// model, and the conversation's provider is the fallback for any other.
	const provider = MODEL_CATALOG.find((m) => m.id === current.model)?.provider ?? conv.provider;
	const demoted = candidateFromMessage(current, provider, conv.model);
	const next = candidateToMessage(chosen);
	// The tab order stays stable: the demoted answer takes the chosen one's place.
	const rest = alternatives.slice();
	rest[idx] = demoted;
	next.alternatives = rest;
	conv.messages[conv.messages.length - 1] = next;
	return true;
}

/** Put the original answer back and drop the comparison. Returns false if
 *  there was none. Mutates `conv`. */
export function cancelComparison(conv: Conversation): boolean {
	const cmp = conv.comparison;
	if (!cmp) return false;
	const original = cmp.candidates[0];
	if (original) {
		const restored = candidateToMessage(original);
		// Back as it was: its earlier tabs, not the runs this comparison added.
		const prior = new Set(cmp.priorAlternativeIds ?? []);
		const tabs = cmp.candidates.slice(1).filter((c) => prior.has(c.id));
		if (tabs.length > 0) restored.alternatives = tabs;
		conv.messages.push(restored);
	}
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
	if (cmp.priorAlternativeIds !== undefined && !(Array.isArray(cmp.priorAlternativeIds) && cmp.priorAlternativeIds.every((x) => typeof x === "string"))) {
		delete cmp.priorAlternativeIds;
	}
	if (typeof cmp.id !== "string") cmp.id = crypto.randomUUID();
	if (typeof cmp.createdAt !== "string") cmp.createdAt = iso();
	const last = conv.messages[conv.messages.length - 1];
	const promptIsLast = !!last && last.role === "user" && last.id === cmp.userMessageId;
	if (cmp.candidates.length === 0 || !promptIsLast) {
		// Cannot be resumed. Keep the original answer if the prompt is still last.
		if (promptIsLast && cmp.candidates[0]) {
			conv.comparison = cmp as Comparison;
			cancelComparison(conv); // the same restore Discard does, prior tabs included
		}
		delete conv.comparison;
	}
}

/**
 * Load-time guard for the tabs kept on an answer (ADR-219, principle 1). A tab
 * needs an id, a model and some text to be shown at all; a malformed cost or
 * note-write list is dropped rather than drawn wrong. Returns the tabs that
 * survive, or undefined when none do.
 */
export function normalizeAlternatives(value: unknown): ComparisonCandidate[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: ComparisonCandidate[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const c = raw as ComparisonCandidate;
		if (typeof c.id !== "string" || !c.id || typeof c.model !== "string" || typeof c.content !== "string" || !c.content) continue;
		if (typeof c.timestamp !== "string") c.timestamp = "";
		if (c.cost !== undefined) {
			const cost = c.cost as { usd?: unknown; asOf?: unknown } | null;
			const ok = !!cost && typeof cost.usd === "number" && Number.isFinite(cost.usd) && cost.usd >= 0 && typeof cost.asOf === "string";
			if (!ok) delete c.cost;
		}
		if (c.noteWrites !== undefined) {
			const writes = normalizeNoteWrites(c.noteWrites);
			if (writes) c.noteWrites = writes; else delete c.noteWrites;
		}
		if (c.truncated !== undefined && c.truncated !== true) delete (c as { truncated?: unknown }).truncated;
		if (c.rewriteTarget !== undefined && !isRewriteTarget(c.rewriteTarget)) delete c.rewriteTarget;
		if (c.tokenUsage !== undefined && !isTokenUsage(c.tokenUsage)) delete c.tokenUsage;
		out.push(c);
	}
	return out.length > 0 ? out : undefined;
}

const isPos = (p: unknown): boolean =>
	!!p && typeof p === "object" &&
	Number.isInteger((p as { line?: unknown }).line) && Number.isInteger((p as { ch?: unknown }).ch);

/** A target the Replace button can verify: a path, two editor positions, the text. */
function isRewriteTarget(v: unknown): v is RewriteTarget {
	if (!v || typeof v !== "object") return false;
	const t = v as Partial<RewriteTarget>;
	return typeof t.path === "string" && !!t.path && typeof t.text === "string" && isPos(t.from) && isPos(t.to);
}

/** Token counts the meta line prints and prices — finite, non-negative numbers. */
function isTokenUsage(v: unknown): boolean {
	if (!v || typeof v !== "object") return false;
	const u = v as { inputTokens?: unknown; outputTokens?: unknown };
	const ok = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n) && n >= 0;
	return ok(u.inputTokens) && ok(u.outputTokens);
}

/**
 * Every id an answer is known by: its own and each of its tabs' (ADR-225). A
 * favorite, merge link or pin made on a tab points at the tab's id, so anything
 * that removes the answer, or asks whether something points at it, asks about
 * all of them — the splice of an exchange and Retry's guard read this.
 */
export function answerIds(msg: Message): string[] {
	return [msg.id, ...(msg.alternatives ?? []).map((c) => c.id)];
}
