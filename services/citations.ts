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

/** Remove foreign inline citation markers other models emit natively — e.g.
 *  GPT/OpenAI's `【1†source】` / `【1:2†source】` bracket-dagger form — which
 *  Pythia does not render as chips and which otherwise leak into the text as
 *  literal noise. Only brackets containing a `†` are removed, so ordinary CJK
 *  text in `【…】` is left alone. */
export function stripForeignCitations(content: string): string {
	if (!content || content.indexOf("【") === -1) return content;
	return content
		.replace(/[ \t]*【[^】]*†[^】]*】/gu, "")
		.replace(/ +([.,;:!?])/g, "$1")
		.replace(/[ \t]{2,}/g, " ");
}

/** Remove all citation markers from content (for note export / plain text) —
 *  both Pythia's `⟦cite:…⟧` and foreign `【…†…】` forms. Collapses a doubled
 *  space or a stray space-before-punctuation left behind. */
export function stripCitationMarkers(content: string): string {
	let out = content ?? "";
	if (out.indexOf("⟦cite:") !== -1) {
		out = out
			.replace(markerRegExp(), "")
			.replace(/ +([.,;:!?])/g, "$1")
			.replace(/[ \t]{2,}/g, " ");
	}
	return stripForeignCitations(out);
}

/** Normalize a web ref (a bare domain from a model marker, or a full URL from a
 *  Tavily result) to a comparable bare domain. Falls back to the stripped input
 *  when it can't be parsed as a URL. */
export function webDomain(ref: string): string {
	const s = (ref ?? "").trim();
	try {
		return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
	} catch {
		return s.replace(/^www\./, "");
	}
}

/** Append web sources discovered deterministically from the web_search tool
 *  result (independent of the model's citation habits) to an existing source
 *  list, deduped by DOMAIN and numbered continuously after the existing entries.
 *  Each appended web source keeps its full URL in `ref` (for opening) and shows
 *  its bare domain as `title`.
 *
 *  Dedup is by domain, not full URL, so a model-emitted `⟦cite:web:example.com⟧`
 *  (ref = bare domain) and a Tavily result for `https://example.com/article`
 *  (ref = full URL) collapse to a single source instead of listing the same site
 *  twice. The FIRST occurrence wins, which keeps any inline `⟦cite:web:…⟧` chip
 *  mapping intact (see `eachCitationSegment`). */
export function appendWebSources(
	sources: CitationSource[],
	web: { title?: string; url: string }[],
): CitationSource[] {
	const out = sources.slice();
	const seen = new Set(out.filter((s) => s.kind === "web").map((s) => webDomain(s.ref)));
	for (const w of web) {
		const url = (w.url ?? "").trim();
		if (!url) continue;
		const domain = webDomain(url);
		if (seen.has(domain)) continue;
		seen.add(domain);
		out.push({ n: out.length + 1, kind: "web", ref: url, title: domain });
	}
	return out;
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
