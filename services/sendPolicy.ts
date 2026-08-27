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
