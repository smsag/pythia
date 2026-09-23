/**
 * A chart as a PNG on the clipboard (ADR-210).
 *
 * This is the half of the feature the user actually asked for: a picture that
 * pastes into Word, Docs, Slides or Notion. Everything awkward here follows from
 * one fact — **a CSS custom property does not cross the `<img>` boundary**. An
 * SVG rasterised through an `Image` is loaded as its own document: it cannot see
 * the page's stylesheet, so `fill: var(--p-chart-c0)` resolves to nothing and
 * every chart exports black on transparent. There is no shortcut around that.
 * The clone below is the fix, and `inlineChartColors` is the whole of it.
 *
 * Three smaller residues, each deliberate:
 *
 * - **Fonts.** That same isolated document loads no theme webfont, and hard rule
 *   2 forbids embedding one, so the clone is rewritten to a generic system
 *   stack. The PNG's typography drifts slightly from the panel's. The
 *   alternative is a silent fallback to a serif face, which is worse.
 * - **A background is painted in.** A transparent PNG looks right on a white
 *   page and unreadable on a dark slide. The chart carries the ground it was
 *   drawn against.
 * - **`blob:`, not `data:`.** No base64 inflation, and no percent-encoding bugs
 *   with the umlauts and em-dashes that appear in real labels.
 *
 * Nothing external is referenced by the SVG — no `<image>`, no linked CSS — so
 * the canvas is never tainted and `toBlob` always succeeds. Keep it that way.
 */

/** A crisp paste matters more than a small clipboard; 1× is visibly fuzzy in a
 *  document. Retina displays go higher still. */
const EXPORT_SCALE = 2;
/** A ceiling on the canvas so a very wide chart cannot spike memory. */
const MAX_CANVAS_PX = 4000;

const SYSTEM_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** The properties that decide what a shape looks like. Anything not listed here
 *  is either inherited from an attribute already on the clone or irrelevant to a
 *  raster. */
const PAINT_PROPS = [
	"fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
	"stroke-linejoin", "stroke-dasharray", "opacity",
	"font-size", "font-weight", "text-anchor", "dominant-baseline",
] as const;

/** The `--p-chart-cN` property a node is painted by, or "" when it is not a
 *  series shape. One reading of the class, shared by fill and stroke. */
function seriesProperty(node: Element): string {
	for (const cls of Array.from(node.classList)) {
		if (/^p-chart-c\d+$/.test(cls)) return `--${cls}`;
	}
	return "";
}

/**
 * Copy every resolved paint value from the live tree onto the clone.
 *
 * The two trees are walked in lockstep — `querySelectorAll("*")` returns
 * document order, and the clone is a deep copy, so index i is the same node in
 * both. Anything else (matching by id, re-querying per node) is slower and can
 * drift.
 */
export function inlineChartColors(live: SVGSVGElement, clone: SVGSVGElement, ground: string): void {
	const liveNodes  = [live,  ...Array.from(live.querySelectorAll("*"))];
	const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
	// Read straight off the root's inline style rather than through the CSSOM:
	// these are the values ui/chart/palette.ts put there, and taking them
	// directly means the export is correct even when getComputedStyle is not
	// helpful — a detached node, a stylesheet not yet applied, a headless DOM.
	const swatches = new Map<string, string>();
	for (let i = 0; i < live.style.length; i++) {
		const name = live.style[i];
		if (name.startsWith("--p-chart-c")) swatches.set(name, live.style.getPropertyValue(name).trim());
	}

	for (let i = 0; i < liveNodes.length && i < cloneNodes.length; i++) {
		const computed = getComputedStyle(liveNodes[i]);
		const target = cloneNodes[i] as SVGElement;
		for (const prop of PAINT_PROPS) {
			const value = computed.getPropertyValue(prop).trim();
			// An empty or still-unresolved value is left alone: whatever attribute
			// the clone already carries is a better guess than blanking it.
			if (!value || value.includes("var(")) continue;
			if (value === "none" && prop !== "fill" && prop !== "stroke") continue;
			target.setAttribute(prop, value);
		}

		// The series swatch is applied explicitly, after the computed pass, so the
		// one colour with no Obsidian token behind it never depends on the CSSOM.
		const swatch = swatches.get(seriesProperty(liveNodes[i]));
		if (swatch) {
			const strokes = liveNodes[i].classList.contains("p-chart-line");
			target.setAttribute(strokes ? "stroke" : "fill", swatch);
			if (strokes) target.setAttribute("fill", "none");
		}

		target.setAttribute("font-family", SYSTEM_FONT_STACK);
		// The custom properties were the live tree's way of colouring itself; the
		// clone is painted by attribute now, and leaving them would be the one
		// thing in the file still pretending a stylesheet is coming.
		target.removeAttribute("style");
		target.removeAttribute("class");
	}

	const width  = clone.getAttribute("width")  ?? "0";
	const height = clone.getAttribute("height") ?? "0";
	const bg = clone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
	bg.setAttribute("x", "0");
	bg.setAttribute("y", "0");
	bg.setAttribute("width", width);
	bg.setAttribute("height", height);
	bg.setAttribute("fill", ground);
	clone.insertBefore(bg, clone.firstChild);
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload  = () => resolve(img);
		img.onerror = () => reject(new Error("the chart SVG could not be rasterised"));
		img.src = url;
	});
}

/**
 * Rasterise a live chart SVG.
 *
 * Rejects rather than resolving an empty blob: the caller turns a rejection into
 * the text fallback and a notice, and a blank PNG on the clipboard would be a
 * silent failure the user only discovers in their document.
 */
export async function chartPngBlob(svg: SVGSVGElement, ground: string): Promise<Blob> {
	const width  = Number(svg.getAttribute("width"))  || svg.clientWidth  || 600;
	const height = Number(svg.getAttribute("height")) || svg.clientHeight || 400;

	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	inlineChartColors(svg, clone, ground);

	const markup = new XMLSerializer().serializeToString(clone);
	const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
	try {
		const img = await loadImage(url);
		const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
		const scale = Math.min(
			Math.max(EXPORT_SCALE, dpr),
			MAX_CANVAS_PX / Math.max(width, height, 1),
		);
		const canvas = document.createElement("canvas");
		canvas.width  = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d canvas context");
		ctx.scale(scale, scale);
		ctx.drawImage(img, 0, 0, width, height);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => blob ? resolve(blob) : reject(new Error("the chart could not be encoded as PNG")),
				"image/png",
			);
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}
