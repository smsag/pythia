/**
 * Model-declared citations (F2/F11).
 *
 * The model is instructed to append a citation marker immediately after any
 * statement drawn from a source:
 *
 *   ⟦cite:note:<vault-path>⟧      — an attached note
 *   ⟦cite:web:<domain>⟧           — a web-search result (domain only, no scheme)
 *
 * The kind prefix removes vault-vs-web ambiguity, and the delimiters `⟦ ⟧`
 * are not Markdown and carry no scheme, so the marker survives
 * `MarkdownRenderer.render()` as literal text (no wikilink transform, no URL
 * autolinking) — which is what lets it be painted into a numbered chip
 * afterwards, mirroring the favorites re-paint pattern.
 *
 * Pythia — not the model — owns the numbering: sources are numbered by first
 * appearance, deduped by (kind, ref).
 */

export type CitationKind = "vault" | "web";

export interface CitationSource {
	n: number;            // 1-based, in order of first appearance
	kind: CitationKind;
	ref: string;          // vault path (kind "vault") or domain (kind "web")
	title: string;        // display label (basename without .md, or bare domain)
}

/** Global, kind-prefixed marker pattern. `[^⟧]+` never crosses a closing
 *  bracket, so refs containing `:` (paths, domains) parse correctly. */
const MARKER_SOURCE = "⟦cite:(note|web):([^⟧]+)⟧";

function markerRegExp(): RegExp {
	return new RegExp(MARKER_SOURCE, "g");
}

function titleFor(kind: CitationKind, ref: string): string {
	if (kind === "web") return ref.replace(/^www\./, "");
	return (ref.split("/").pop() ?? ref).replace(/\.md$/, "");
}

/** Extract the ordered, deduped source list from a message's content. */
export function parseCitations(content: string): CitationSource[] {
	if (!content || content.indexOf("⟦cite:") === -1) return [];
	const seen = new Map<string, number>();
	const sources: CitationSource[] = [];
	const re = markerRegExp();
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const kind: CitationKind = m[1] === "web" ? "web" : "vault";
		const ref = m[2].trim();
		if (!ref) continue;
		const key = `${kind}:${ref}`;
		if (seen.has(key)) continue;
		const n = sources.length + 1;
		seen.set(key, n);
		sources.push({ n, kind, ref, title: titleFor(kind, ref) });
	}
	return sources;
}

/** Remove all citation markers from content (for note export / plain text).
 *  Collapses a doubled space or a stray space-before-punctuation left behind. */
export function stripCitationMarkers(content: string): string {
	if (!content || content.indexOf("⟦cite:") === -1) return content;
	return content
		.replace(markerRegExp(), "")
		.replace(/ +([.,;:!?])/g, "$1")
		.replace(/[ \t]{2,}/g, " ");
}

/** A callback that walks each citation marker in `content` in document order,
 *  invoking `onText` for the literal spans between markers and `onMarker` for
 *  each marker (with the source it resolves to, if any). Pure/DOM-free so the
 *  caller decides how to build nodes. */
export function eachCitationSegment(
	content: string,
	sources: CitationSource[],
	onText: (text: string) => void,
	onMarker: (source: CitationSource | null) => void,
): void {
	const byKey = new Map(sources.map((s) => [`${s.kind}:${s.ref}`, s]));
	const re = markerRegExp();
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		if (m.index > last) onText(content.slice(last, m.index));
		const kind: CitationKind = m[1] === "web" ? "web" : "vault";
		const ref = m[2].trim();
		onMarker(byKey.get(`${kind}:${ref}`) ?? null);
		last = m.index + m[0].length;
	}
	if (last < content.length) onText(content.slice(last));
}
