/**
 * The search box's scope grammar (ADR-168).
 *
 * Pythia searches conversations; Obsidian searches notes. `note:` is the join
 * between them — "which conversation did I have ABOUT this note?" — so widening
 * never introduces a second kind of result row, and a result is always a
 * conversation. That is what keeps the panel's keyboard model, its row
 * component, its pick mode (ADR-143) and its IDF scoring (one corpus, one
 * document frequency) untouched.
 *
 * The scope is typed INTO the query rather than offered as a control, because
 * the panel has no chrome to spare and a filter row would have to be built,
 * translated, made keyboard-reachable and made to survive the mobile keyboard.
 * Discoverability is paid for elsewhere: by the placeholder, and by
 * auto-widening (`shouldWiden`), which shows the feature working before the
 * user has learned the syntax.
 */

export type SearchScope = "conversations" | "notes" | "all";

export interface ParsedQuery {
	scope: SearchScope;
	/** The query with the scope prefix removed. */
	query: string;
	/** The user typed a scope. Drives whether widening is announced: the chip
	 *  reports what the user did NOT ask for, and explaining back a scope they
	 *  typed themselves is noise. */
	explicit: boolean;
}

/** Recognized prefixes. German aliases are included deliberately — this is a
 *  German-first plugin and a German-first user types "notiz:" before "note:".
 *  Unlisted words are NOT commands: `parseScope` leaves them in the query as
 *  literal text rather than failing, so a colon in ordinary search text ("todo:
 *  rewrite") never becomes a silent filter. */
const PREFIXES: Record<string, SearchScope> = {
	note: "notes",
	notes: "notes",
	notiz: "notes",
	notizen: "notes",
	conv: "conversations",
	chat: "conversations",
	gespraech: "conversations",
	"gespräch": "conversations",
	all: "all",
	alle: "all",
};

/** Split a leading `scope:` prefix off the raw input. */
export function parseScope(raw: string): ParsedQuery {
	const text = (raw ?? "").trim();
	const m = /^([\p{L}]+):\s*(.*)$/su.exec(text);
	if (m) {
		const scope = PREFIXES[m[1].toLowerCase()];
		if (scope) return { scope, query: m[2].trim(), explicit: true };
	}
	return { scope: "conversations", query: text, explicit: false };
}

/** Below this many conversation-text hits, a non-empty query also searches the
 *  note dimension. Chosen as "the screen looks empty and the user is about to
 *  give up", not as a statistical threshold. */
export const WIDEN_MIN_RESULTS = 3;

/**
 * Whether to search the note dimension the user did not ask for.
 *
 * Deliberately narrow. It never fires on an empty query (that is the browse
 * listing), never when the user named a scope (they are in control), and never
 * while picking a conversation (ADR-143: the panel is being used to NAME a
 * target, and a row the user cannot explain is worse there than a short list).
 */
export function shouldWiden(o: {
	explicit: boolean;
	queryTokenCount: number;
	narrowCount: number;
	picking: boolean;
}): boolean {
	if (o.picking || o.explicit) return false;
	if (o.queryTokenCount === 0) return false;
	return o.narrowCount < WIDEN_MIN_RESULTS;
}
