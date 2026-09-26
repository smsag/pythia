import { containsWebUrl } from "./webSearchHeuristics";
import type { Conversation, Message } from "../models/types";

/**
 * Pure decision predicates lifted verbatim from `PythiaSidebarView.sendMessage`.
 *
 * `sendMessage` is the 270-line send/stream orchestration slated for extraction
 * into a `SendController` (see ADR-097 / engineering-review #119). It is too
 * DOM- and plugin-entangled to instantiate in a unit test, so its post-turn
 * *trigger conditions* — the small, pure branches a careless extraction would
 * silently break (an off-by-one on the message count, a dropped date-name
 * regex) — live here where they can be characterized directly. Behaviour is
 * identical to the inline checks they replaced; this is a seam, not a change.
 */

/**
 * True at the exact moment a brand-new conversation earns an LLM-generated title:
 * right after its first exchange (user + assistant = 2 messages) while it still
 * carries its auto-assigned date name (e.g. "2026-08-27"). Evaluated AFTER the
 * assistant message has been pushed, so the count includes it.
 */
export function shouldGenerateTitle(conv: Conversation): boolean {
	return conv.messages.length === 2 && /\d{4}-\d{2}-\d{2}$/.test(conv.name);
}

/**
 * True when a user turn has no chapter name yet — chapter names are generated
 * once per user message and never overwritten.
 */
export function shouldGenerateChapterName(userMsg: Message): boolean {
	return !userMsg.chapterName;
}

/**
 * True when web search should be offered for THIS send although the
 * conversation's globe is off (ADR-099): the setting allows it, a key exists,
 * and the message carries a link (ADR-226 — a time-sensitive word no longer
 * counts).
 *
 * Lifted out of `sendMessage` under ADR-178's line budget, and it belongs here
 * anyway: it is a four-term rule with no DOM in it, and the only place it was
 * written could not be tested. Never persists `researchMode` — the caller arms
 * a clone for one turn. The comparison asks it too, so a compared model gets
 * the same tools the original answer had.
 */
export function shouldAutoArmSearch(opts: {
	researchMode: boolean | undefined;
	autoArmEnabled: boolean;
	hasApiKey: boolean;
	wantsWeb: boolean;
}): boolean {
	return !opts.researchMode && opts.autoArmEnabled && opts.hasApiKey && opts.wantsWeb;
}

/**
 * Whether an outgoing message wants the web: it carries a link for read_url
 * (ADR-217). ADR-099 also armed on time-sensitive words and on any year from
 * this one on; ADR-226 dropped that — "now", "update", "cost" or a daily note
 * named by its date armed nearly every message, and each armed send told the
 * model to search first, sending text drawn from the user's notes to a third
 * party the user had not switched on.
 */
export function wantsWeb(text: string): boolean {
	return containsWebUrl(text);
}
