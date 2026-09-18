import type { Conversation } from "../models/types";
import { targetLabel } from "../services/rewriteTarget";
import { t } from "../i18n";

/**
 * What the reference row shows, as data (ADR-178).
 *
 * The row started as "the notes attached to this conversation" and has since
 * collected three more things that are not that: auto-retrieved vault context
 * (ADR-116), the one-shot template armed for the next answer (ADR-177), and the
 * passage being rewritten. Which ones appear, and in what order, is a rule —
 * so it is a pure function with tests rather than twenty lines inside a DOM
 * builder, and `sidebar.ts` paints whatever this returns.
 */
export type RefEntry =
	/** The armed one-shot template — it governs the next answer. */
	| { kind: "template"; path: string; label: string }
	/** The passage a rewrite will replace. */
	| { kind: "rewrite"; path: string; label: string }
	/** A note the user attached; removable. */
	| { kind: "context"; path: string }
	/** A note this conversation wrote; its ✕ deletes the file. */
	| { kind: "output"; path: string; field: "savedNotePath" | "summaryNote" }
	/** Pulled in by vault context for the last turn; read-only. */
	| { kind: "auto"; path: string };

/**
 * Order is meaning, not taste: the two things that change what the **next**
 * answer does lead, then what the user attached, then what the conversation
 * produced, then what Pythia pulled in on its own.
 */
export function referenceEntries(conv: Conversation, autoPaths: readonly string[]): RefEntry[] {
	const entries: RefEntry[] = [];

	const tpl = conv.pendingTemplate;
	if (tpl) entries.push({ kind: "template", path: tpl.id, label: tpl.name });

	const rewrite = conv.pendingRewrite;
	if (rewrite) {
		entries.push({
			kind: "rewrite",
			path: rewrite.path,
			label: t("rewriteBarLabel", { passage: targetLabel(rewrite.text) }),
		});
	}

	for (const path of conv.contextNotes ?? []) entries.push({ kind: "context", path });
	if (conv.savedNotePath) entries.push({ kind: "output", path: conv.savedNotePath, field: "savedNotePath" });
	if (conv.summaryNote) entries.push({ kind: "output", path: conv.summaryNote, field: "summaryNote" });

	// Never twice: a note the user attached by hand is not also an auto pill.
	const manual = new Set(conv.contextNotes ?? []);
	for (const path of autoPaths) {
		if (!manual.has(path)) entries.push({ kind: "auto", path });
	}
	return entries;
}
