/**
 * A written account of what sits underneath the composer (ADR-148).
 *
 * Five records — ADR-132, 134, 135, 146 and 147 — tried to remove a strip of
 * dead space below the input area, and every one of them was reasoned from a
 * screenshot of the bottom edge plus a guess at which box owned it. ADR-147
 * ended with a commitment: "if any strip survives this, it is not the leaf
 * container and I will instrument rather than guess again." A strip survived.
 * This is the instrument.
 *
 * It answers the two questions a screenshot cannot:
 *
 *   1. Where does Pythia's panel actually end? — the ancestor chain's rects say
 *      so exactly, and they also say which ancestor's padding, margin or height
 *      creates any space below it.
 *   2. What paints the pixels in the strip? — hit-testing the strip itself names
 *      the element, so a gradient nobody can find in `styles.css` stops being a
 *      mystery and becomes a selector.
 *
 * The formatting half is pure and unit-tested. The reading half needs a real
 * layout engine (`getBoundingClientRect`, `getComputedStyle`,
 * `elementsFromPoint`) and is exercised only on the device — which is the whole
 * point: the facts this collects are the ones that cannot be had from here.
 */

/** Everything about one box that has ever mattered to the bottom-strip question. */
export interface BoxFacts {
	label: string;
	top: number;
	bottom: number;
	left: number;
	right: number;
	padding: string;
	margin: string;
	backgroundColor: string;
	backgroundImage: string;
	boxShadow: string;
	maskImage: string;
	overflow: string;
}

/** One hit test inside the strip: what is painted at this height, topmost first. */
export interface ProbePoint {
	y: number;
	stack: string[];
}

export interface LayoutReport {
	version: string;
	platform: string;
	viewportWidth: number;
	viewportHeight: number;
	visualViewportHeight: number | null;
	/** `.p-input-area`'s bottom — where the composer stops. */
	composerBottom: number;
	/** `.pythia-view`'s bottom — where our panel stops. */
	panelBottom: number;
	chain: BoxFacts[];
	probes: ProbePoint[];
}

const MAX_ANCESTORS = 24;
const MAX_STACK = 6;

/**
 * A selector-shaped name for an element.
 *
 * Classes are capped at four because Obsidian's chrome stacks a lot of state
 * classes onto one node and the report has to stay readable on a phone. The
 * `data-type` attribute is always kept — it is the one attribute that says which
 * leaf a container belongs to, and hence whether a rule could be scoped to us.
 */
export function labelFor(el: Element): string {
	const raw = typeof el.className === "string" ? el.className.trim() : "";
	const classes = raw ? raw.split(/\s+/).slice(0, 4) : [];
	const cls = classes.length ? "." + classes.join(".") : "";
	const type = el.getAttribute("data-type");
	return `${el.tagName.toLowerCase()}${cls}${type ? `[data-type="${type}"]` : ""}`;
}

function px(n: number): number {
	return Math.round(n * 10) / 10;
}

export function readBox(el: Element, win: Window): BoxFacts {
	const r = el.getBoundingClientRect();
	const s = win.getComputedStyle(el);
	return {
		label: labelFor(el),
		top: px(r.top),
		bottom: px(r.bottom),
		left: px(r.left),
		right: px(r.right),
		padding: s.padding || "0px",
		margin: s.margin || "0px",
		backgroundColor: s.backgroundColor,
		backgroundImage: s.backgroundImage,
		boxShadow: s.boxShadow,
		maskImage: s.maskImage || (s as unknown as Record<string, string>).webkitMaskImage || "none",
		overflow: s.overflow,
	};
}

/** The chain from `from` outwards, ending at `<body>` (or after MAX_ANCESTORS). */
export function ancestorChain(from: Element, win: Window): BoxFacts[] {
	const out: BoxFacts[] = [];
	let el: Element | null = from;
	while (el && out.length < MAX_ANCESTORS) {
		out.push(readBox(el, win));
		if (el.tagName.toLowerCase() === "body") break;
		el = el.parentElement;
	}
	return out;
}

/**
 * Hit-test the strip between `fromY` and `toY` at `x`.
 *
 * `elementsFromPoint` is the only API that answers "who is on top here" without
 * knowing the app's DOM in advance, which is exactly the constraint that made
 * the previous five diagnoses guesses. Points outside the strip are skipped
 * rather than clamped, so an empty `probes` array reads as "there is no strip"
 * instead of as a row of duplicates.
 */
export function probeStrip(doc: Document, x: number, fromY: number, toY: number, steps = 5): ProbePoint[] {
	if (!(toY > fromY + 1)) return [];
	const out: ProbePoint[] = [];
	for (let i = 0; i <= steps; i++) {
		const y = px(fromY + ((toY - fromY) * i) / steps);
		const hits = doc.elementsFromPoint(x, Math.min(y, toY - 0.5));
		out.push({ y, stack: hits.slice(0, MAX_STACK).map(labelFor) });
	}
	return out;
}

/**
 * Read everything the report needs from a live panel.
 *
 * `inputAreaEl` is `.p-input-area` and `panelEl` is `.pythia-view`; both are
 * passed in rather than queried here so the caller owns the "is a view even
 * open" question and this stays a function of its arguments.
 */
export function collectLayoutReport(
	panelEl: HTMLElement,
	inputAreaEl: HTMLElement,
	win: Window,
	version: string,
	platform: string,
): LayoutReport {
	const panel = panelEl.getBoundingClientRect();
	const composer = inputAreaEl.getBoundingClientRect();
	const probeX = px(panel.left + panel.width / 2);
	return {
		version,
		platform,
		viewportWidth: px(win.innerWidth),
		viewportHeight: px(win.innerHeight),
		visualViewportHeight: win.visualViewport ? px(win.visualViewport.height) : null,
		composerBottom: px(composer.bottom),
		panelBottom: px(panel.bottom),
		chain: ancestorChain(inputAreaEl, win),
		// Probe from the composer's bottom to the viewport's, not to the panel's:
		// the open question is whether the strip belongs to us at all, and a probe
		// that stops at our own edge could never have answered it.
		probes: probeStrip(win.document, probeX, composer.bottom, px(win.innerHeight)),
	};
}

function facts(b: BoxFacts): string[] {
	const extras: string[] = [];
	if (b.backgroundImage !== "none") extras.push(`bg-image ${b.backgroundImage}`);
	if (b.boxShadow !== "none") extras.push(`shadow ${b.boxShadow}`);
	if (b.maskImage !== "none") extras.push(`mask ${b.maskImage}`);
	return extras;
}

/**
 * Render the report as markdown.
 *
 * Pure: everything it needs is in `r`. That is what makes the shape of the
 * answer testable from here even though the numbers can only come from a phone.
 */
export function formatLayoutReport(r: LayoutReport): string {
	const gap = px(r.viewportHeight - r.panelBottom);
	const inside = px(r.panelBottom - r.composerBottom);
	const lines: string[] = [];

	lines.push("# Pythia layout report");
	lines.push("");
	lines.push(`- plugin: ${r.version} · platform: ${r.platform}`);
	lines.push(`- viewport: ${r.viewportWidth}×${r.viewportHeight}` +
		(r.visualViewportHeight === null ? "" : ` · visual ${r.visualViewportHeight}`));
	lines.push(`- composer bottom: ${r.composerBottom}`);
	lines.push(`- panel bottom: ${r.panelBottom}`);
	lines.push(`- **${inside}px between the composer and the panel's own bottom** (design intends 4)`);
	lines.push(`- **${gap}px between the panel's bottom and the viewport's** (not ours — app or theme chrome)`);
	lines.push("");

	lines.push("## Ancestors, composer outwards");
	lines.push("");
	lines.push("| box | top | bottom | padding | margin | overflow |");
	lines.push("|---|---|---|---|---|---|");
	for (const b of r.chain) {
		lines.push(`| \`${b.label}\` | ${b.top} | ${b.bottom} | ${b.padding} | ${b.margin} | ${b.overflow} |`);
	}
	lines.push("");

	const painters = r.chain.filter((b) => facts(b).length > 0);
	lines.push("## Boxes that paint something");
	lines.push("");
	if (painters.length === 0) {
		lines.push("None in the chain — no ancestor carries a background image, shadow or mask.");
	} else {
		for (const b of painters) lines.push(`- \`${b.label}\` — ${facts(b).join("; ")}`);
	}
	lines.push("");

	lines.push("## What is painted below the composer");
	lines.push("");
	if (r.probes.length === 0) {
		lines.push("Nothing — the composer reaches the bottom of the viewport.");
	} else {
		for (const p of r.probes) lines.push(`- y=${p.y}: ${p.stack.map((s) => `\`${s}\``).join(" ← ") || "(nothing)"}`);
	}
	lines.push("");
	return lines.join("\n");
}
