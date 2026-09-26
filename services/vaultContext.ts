/**
 * Vault context without a model of Pythia's own (ADR-224).
 *
 * Which notes answer a turn is Schreibstube's to find: it owns the one
 * language model on the device and the index of the vault. What stays here is
 * what is Pythia's to decide — the text a turn is searched with, and which of
 * the notes found Pythia may send to a cloud model: only those inside the
 * folders the settings name, never Pythia's own conversation or scratch notes,
 * never a note marked `pythia: false`.
 *
 * Pure: strings and settings in, answers out.
 */

/** How much of the preceding answer joins the search text (ADR-183). */
const CARRY_OVER_CHARS = 200;

/**
 * The text a turn is searched with. The message leads; a short follow-up
 * ("and the second one?") carries the head of the previous answer, so the
 * turns that most need the conversation's context are not the ones without
 * it. A message long enough to stand on its own is left alone (ADR-183).
 */
export function retrievalQuery(message: string, previousAnswer = ""): string {
	const q = message.trim();
	if (!q) return "";
	if (q.length >= CARRY_OVER_CHARS) return q;
	const carry = previousAnswer.trim().slice(0, CARRY_OVER_CHARS).trim();
	return carry ? `${q}\n\n${carry}` : q;
}

/**
 * Whether a note's frontmatter keeps it out of vault context: `pythia: false`
 * (or the string "false"). Anything else, a missing key or an unreadable cache
 * included, is not an opt-out — a typo must not silently drop a note (ADR-183).
 */
export function isIndexingOptedOut(frontmatter: unknown): boolean {
	if (!frontmatter || typeof frontmatter !== "object") return false;
	const value = (frontmatter as Record<string, unknown>).pythia;
	return value === false || value === "false";
}

/** True when `path` is inside an include folder (or none is set) and outside
 *  every skip folder. "Insights" holds "Insights/x.md", not "Insights-old/y.md". */
export function isPathInScope(path: string, include: string[], skip: string[]): boolean {
	const under = (p: string, f: string) => p === f || p.startsWith(f + "/");
	return (include.length === 0 || include.some((f) => under(path, f))) && !skip.some((f) => under(path, f));
}

/** The folders a turn may draw notes from, and Pythia's own, which it never does. */
export function contextScope(settings: {
	vaultContextFolders: string[];
	conversationsFolder: string;
	scratchFolder: string;
}): { include: string[]; skip: string[] } {
	const norm = (f: string) => (typeof f === "string" ? f : "").replace(/\/+$/, "");
	return {
		include: settings.vaultContextFolders.map(norm).filter(Boolean),
		skip: [settings.conversationsFolder, settings.scratchFolder].map(norm).filter(Boolean),
	};
}
