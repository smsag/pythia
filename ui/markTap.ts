/**
 * Which mark did a tap mean? (ADR-157)
 *
 * Marks nest: since terms may be painted inside a favorite, a fork origin or a
 * merge link, a single tap can land inside several at once. Every candidate is an
 * ancestor of the tap target, so they form a chain, and **the innermost one
 * wins** — it is the most specific thing under the finger, and the outer mark
 * stays tappable everywhere else along its span whereas the inner one has nowhere
 * else to be tapped.
 *
 * This replaced a fixed type order (fork → merge → term). That order was written
 * defensively and had never fired between a term and a deliberate mark, because
 * the painter refused to put a term inside one at all. Depth also survives either
 * nesting order, which matters because which mark ends up outside depends on
 * which repaint ran last.
 *
 * Favorites are deliberately not resolved here: tapping one selects its span and
 * re-labels the toolbar rather than opening an anchor, so it is a different kind
 * of outcome and stays with the controller as the fallback.
 */
export type MarkTap =
	| { kind: "fork"; el: HTMLElement; id: string }
	| { kind: "merge"; el: HTMLElement; id: string }
	| { kind: "term"; el: HTMLElement; term: string };

export function resolveMarkTap(target: Element | null): MarkTap | null {
	if (!target) return null;
	const candidates: MarkTap[] = [];

	const fork = target.closest<HTMLElement>(".p-fork-origin");
	const forkId = fork?.getAttribute("data-fork-id");
	if (fork && forkId) candidates.push({ kind: "fork", el: fork, id: forkId });

	const merge = target.closest<HTMLElement>(".p-merge-link");
	const mergeId = merge?.getAttribute("data-merge-id");
	if (merge && mergeId) candidates.push({ kind: "merge", el: merge, id: mergeId });

	// `.p-person` as well as `.p-term`: people are glossary entries and open the
	// same anchor (ADR-151). This lookup only ever asked for `.p-term`, so a person
	// mark was painted and then did nothing when tapped.
	const term = target.closest<HTMLElement>(".p-term, .p-person");
	const termName = term?.getAttribute("data-term");
	if (term && termName) candidates.push({ kind: "term", el: term, term: termName });

	if (candidates.length === 0) return null;
	// Innermost wins. All candidates sit on one ancestor chain, so this is a total
	// order; the array order breaks a tie that cannot occur.
	return candidates.reduce((a, b) => (a.el.contains(b.el) ? b : a));
}
