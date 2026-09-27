import type { MessageSource } from "../models/types";
import { stripForeignCitations, webDomain } from "./citations";
import { noteWikilink } from "./noteWrites";

/**
 * Citations in a note Pythia writes become Markdown footnotes (ADR-238).
 *
 * In the chat a `⟦cite:…⟧` marker is painted as a numbered chip and the
 * sources row lists what it points at. A note has neither: the marker would
 * land in the vault as literal noise, and the source it named would be lost.
 * So the marker becomes `[^n]` and the note gains the footnote under it —
 *
 *   ⟦cite:note:Folder/Rates.md⟧  →  [^1]  …  [^1]: [[Folder/Rates|Rates]]
 *   ⟦cite:web:3⟧                 →  [^2]  …  [^2]: [Title](https://…)
 *
 * Two doors, one rule. A note TOOL (`create_note` · `rewrite_note` ·
 * `prepend_note`) resolves a web marker against the results the answer has
 * fetched so far (`citationsToFootnotes`). A TRANSCRIPT (Save to note, the
 * archive) resolves each message's markers against that message's own
 * `sources`, with one numbering across the whole note (`FootnoteNumbering`).
 * Either way a web marker nothing answers for is dropped, because a footnote
 * Pythia cannot tie to a page it read is not a source, and two markers for one
 * source share one footnote.
 *
 * Labels are numbers, and a number already used as a footnote label — in the
 * text written, or in the note it joins — is skipped, so Pythia's footnotes
 * never collide with the author's. A marker inside a fenced code block is
 * text, and is left alone.
 *
 * Pure: no Obsidian, no vault.
 */

export interface FootnoteWebSource {
	n: number;
	title?: string;
	url: string;
}

/** What a marker points at, once resolved. */
export type CitationTarget =
	| { kind: "vault"; path: string }
	| { kind: "web"; url: string; title?: string };

/** Marker kind and ref → its target, or null to drop the marker. */
export type CitationResolver = (kind: "note" | "web", ref: string) => CitationTarget | null;

const MARKER_RE = /[ \t]*⟦cite:(note|web):([^⟧]+)⟧/g;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const LABEL_RE = /\[\^([^\]\s]+)\]/g;

/** A Markdown link's text: brackets escaped, so a title cannot close it. */
function linkText(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(/([[\]\\])/g, "\\$1");
}

/** A Markdown link's target: a space or parenthesis would end it early. A bare
 *  domain (a message from before ADR-226) is read as https. */
function linkTarget(url: string): string {
	const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
	return full.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");
}

function definitionOf(target: CitationTarget): string {
	if (target.kind === "vault") return noteWikilink(target.path.endsWith(".md") ? target.path : `${target.path}.md`);
	const title = target.title?.trim() || webDomain(target.url);
	return `[${linkText(title)}](${linkTarget(target.url)})`;
}

/**
 * One numbering for one note. Built over every text the note will contain —
 * what is written and what is already there — so no label they use is handed
 * out again, and shared across the messages of a transcript so a source cited
 * twice keeps its first number.
 */
export class FootnoteNumbering {
	private readonly taken = new Set<string>();
	private readonly labelByTarget = new Map<string, string>();
	private next = 1;

	constructor(texts: string[]) {
		for (const text of texts) {
			for (const m of text.matchAll(LABEL_RE)) this.taken.add(m[1]);
		}
	}

	/**
	 * `content` with its markers replaced by footnote references, and the
	 * definitions of the sources it cites FIRST appended under it. A source an
	 * earlier call already defined is referenced, not defined again.
	 */
	apply(content: string, resolve: CitationResolver): string {
		const cleaned = stripForeignCitations(content);
		if (cleaned.indexOf("⟦cite:") === -1) return cleaned;

		const definitions: string[] = [];
		const replaceMarkers = (line: string): string =>
			line.replace(MARKER_RE, (_whole, kind: "note" | "web", rawRef: string) => {
				const ref = rawRef.trim();
				const target = ref ? resolve(kind, ref) : null;
				if (!target) return "";
				const key = target.kind === "vault" ? `vault:${target.path}` : `web:${target.url}`;
				let label = this.labelByTarget.get(key);
				if (!label) {
					label = this.nextLabel();
					this.labelByTarget.set(key, label);
					definitions.push(`[^${label}]: ${definitionOf(target)}`);
				}
				return `[^${label}]`;
			});

		let inFence = false;
		const body = cleaned
			.split("\n")
			.map((line) => {
				if (FENCE_RE.test(line)) { inFence = !inFence; return line; }
				return inFence ? line : replaceMarkers(line);
			})
			.join("\n");

		if (definitions.length === 0) return body;
		return `${body.trimEnd()}\n\n${definitions.join("\n")}\n`;
	}

	private nextLabel(): string {
		while (this.taken.has(String(this.next))) this.next++;
		const label = String(this.next++);
		this.taken.add(label);
		return label;
	}
}

/** The note tools' resolver: a web marker is the result this answer fetched
 *  with that number, else the first from that domain — the chat's rule
 *  (ADR-226). A vault marker names its path. */
export function fetchedResultsResolver(results: FootnoteWebSource[]): CitationResolver {
	return (kind, ref) => {
		if (kind === "note") return { kind: "vault", path: ref };
		const hit = results.find((r) => String(r.n) === ref) ?? results.find((r) => webDomain(r.url) === webDomain(ref));
		return hit ? { kind: "web", url: hit.url, title: hit.title } : null;
	};
}

/** A stored message's resolver: its markers against its own `sources`, found
 *  the way the chat finds a chip (by what the marker said, else by ref). */
export function messageSourcesResolver(sources: MessageSource[] | undefined): CitationResolver {
	const list = sources ?? [];
	return (kind, ref) => {
		if (kind === "note") return { kind: "vault", path: ref };
		const hit = list.find((s) => s.kind === "web" && (s.cite ?? s.ref) === ref)
			?? list.find((s) => s.kind === "web" && webDomain(s.ref) === webDomain(ref));
		return hit ? { kind: "web", url: hit.ref, title: hit.title } : null;
	};
}

/**
 * A note tool's content with its markers as footnotes. `existing` is the text
 * already in the note the content joins (prepend), read only for the labels
 * it uses. Content with no marker is returned unchanged except for foreign
 * citation noise.
 */
export function citationsToFootnotes(content: string, webSources: FootnoteWebSource[] = [], existing = ""): string {
	return new FootnoteNumbering([content, existing]).apply(content, fetchedResultsResolver(webSources));
}
