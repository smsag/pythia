import { containsWebUrl, timeSensitiveCue } from "./webSearchHeuristics";
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
 * and the message wants the web — it reads as time-sensitive or carries a
 * link (`wantsWeb`, ADR-229).
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
 * Whether web research is on for THIS send, and why (ADR-228). The ONE rule —
 * the send and every comparison run ask it:
 * - `active`: the tools are offered and the recency block is added. Never
 *   without a key: research on with no key used to offer tools that could only
 *   fail and tell the model to search first, wasting rounds.
 * - `autoArmed`: on for this message only, because it carries a link.
 * - `missingKey`: the user turned research on but no Tavily key is set, which
 *   the send says rather than quietly answering without the web.
 */
export function researchForSend(opts: {
	researchMode: boolean | undefined;
	autoArmEnabled: boolean;
	hasApiKey: boolean;
	wantsWeb: boolean;
}): { active: boolean; autoArmed: boolean; missingKey: boolean } {
	const autoArmed = shouldAutoArmSearch(opts);
	return {
		active: opts.hasApiKey && (opts.researchMode === true || autoArmed),
		autoArmed,
		missingKey: opts.researchMode === true && !opts.hasApiKey,
	};
}

/**
 * Whether an outgoing message wants the web: it reads as time-sensitive
 * (ADR-099) or it carries a link for read_url (ADR-217). ADR-226 dropped the
 * time cues; ADR-229 restored them — "show me the current ECB rate" is the case
 * auto-search exists for — without the [[note links]] a daily note's date
 * lived in. The year anchors the "this year or later" cue.
 */
export function wantsWeb(text: string, currentYear: number): boolean {
	return webCue(text, currentYear) !== null;
}

/** Why a message wants the web — the time cue as it appears, or "link" — or
 *  null. The one answer both `wantsWeb` and the visible reason read (ADR-230). */
export function webCue(text: string, currentYear: number): string | null {
	return timeSensitiveCue(text, currentYear) ?? (containsWebUrl(text) ? "link" : null);
}
