import { setIcon } from "obsidian";
import { t } from "../i18n";
import { copyTextWithFeedback } from "./clipboard";
import { attachDragToPan } from "./dragToPan";
import { decorateTables } from "./tableDecorator";
import { appendPinButton, codeBlockSource, diagramSource, type PinBlock } from "./pinSources";
import { chartSourceOf } from "./chart/card";

type DiagObserverEntry = { mo: MutationObserver; ro: ResizeObserver };

/**
 * What Obsidian's own Mermaid renderer leaves (measured in 1.13.7's app.js): a
 * post-processor finds `code.language-mermaid`, renders it asynchronously and
 * REPLACES the `<pre>` with `<div class="mermaid"><svg width="100%" …>` — no
 * `block-language-*` container, and no source left in the DOM. Only a plugin's
 * code-block processor produces a `block-language-*` container.
 */
const MERMAID_PENDING = "pre > code.language-mermaid";
/** Where a pending Mermaid block stays when the vault has not trusted Mermaid:
 *  Obsidian's guard shows the source with an Allow button; left as it is. */
const MERMAID_GUARD = ".mermaid-wrapper";

/**
 * A canvas that lays itself out: Vizardry sizes its SVGs to its host and gives
 * each its own scroll frame, and its root carries `block-language-vizardry`.
 * Pythia's diagram treatment (natural size, outer scroll, drag-to-pan) fought
 * it — stamping a toolbar icon and leaving the diagram alone, or collapsing
 * a wheel to nothing. styles.css excludes the same class.
 */
const SELF_SIZED = ".vizardry-canvas";

const DIAGRAM_SELECTOR = `:is(.mermaid, [class*='block-language-']):not([data-decorated]):not(${SELF_SIZED})`;

/** The diagram's own SVG — never an icon in a button or a toolbar, which may
 *  come first in the block and would be stamped instead of the drawing. */
function diagramSvg(el: HTMLElement): SVGElement | null {
	return Array.from(el.querySelectorAll<SVGElement>("svg"))
		.find((svg) => !svg.closest("button") && !svg.classList.contains("svg-icon")) ?? null;
}

function wrapInScrollFrame(scrollEl: HTMLElement): HTMLElement {
	const frame = createEl("div", { cls: "p-code-frame" });
	scrollEl.parentNode!.insertBefore(frame, scrollEl);
	frame.appendChild(scrollEl);
	return frame;
}

function stampSvgSize(svg: SVGElement): boolean {
	const vb = svg.getAttribute("viewBox");
	if (vb) {
		const parts = vb.trim().split(/[\s,]+/).map(Number);
		if (parts.length >= 4 && parts[2] > 0) {
			const [, , w, h] = parts;
			svg.style.setProperty("width",     `${w}px`, "important");
			svg.style.setProperty("height",    `${h}px`, "important");
			svg.style.setProperty("max-width", "none",   "important");
			svg.style.display = "block";
			return true;
		}
	}
	const rawW = svg.getAttribute("width") ?? "";
	const rawH = svg.getAttribute("height") ?? "";
	const attrW = rawW.includes("%") ? NaN : parseFloat(rawW);
	const attrH = rawH.includes("%") ? NaN : parseFloat(rawH);
	if (attrW > 0) {
		svg.style.setProperty("width",     `${attrW}px`, "important");
		svg.style.setProperty("max-width", "none",       "important");
		svg.style.display = "block";
		if (attrH > 0) svg.style.setProperty("height", `${attrH}px`, "important");
		return true;
	}
	const styleW = parseFloat(svg.style.width);
	if (styleW > 0) {
		svg.style.setProperty("width",     `${styleW}px`, "important");
		svg.style.setProperty("max-width", "none",        "important");
		svg.style.display = "block";
		const styleH = parseFloat(svg.style.height);
		if (styleH > 0) svg.style.setProperty("height", `${styleH}px`, "important");
		return true;
	}
	const styleMaxW = parseFloat(svg.style.maxWidth);
	if (styleMaxW > 0) {
		svg.style.setProperty("width",     `${styleMaxW}px`, "important");
		svg.style.setProperty("max-width", "none",           "important");
		svg.style.display = "block";
		return true;
	}
	try {
		const bbox = (svg as unknown as SVGGraphicsElement).getBBox();
		const bboxW = bbox.width + Math.max(0, bbox.x);
		const bboxH = bbox.height + Math.max(0, bbox.y);
		if (bboxW > 0) {
			svg.style.setProperty("width",     `${bboxW}px`, "important");
			svg.style.setProperty("height",    `${bboxH}px`, "important");
			svg.style.setProperty("max-width", "none",       "important");
			svg.style.display = "block";
			return true;
		}
	} catch { /* SVG not yet painted — keep observing */ }
	return false;
}

function fixDiagramSvgSize(
	el: HTMLElement,
	diagObservers: WeakMap<HTMLElement, DiagObserverEntry>,
): void {
	const prev = diagObservers.get(el);
	prev?.mo.disconnect();
	prev?.ro.disconnect();

	const existing = diagramSvg(el);
	if (existing && stampSvgSize(existing)) return;

	let svgWatched = false;
	const done = () => {
		mo.disconnect();
		ro.disconnect();
		diagObservers.delete(el);
	};
	const mo = new MutationObserver(() => {
		const svg = diagramSvg(el);
		if (!svg) return;
		if (stampSvgSize(svg)) { done(); return; }
		if (!svgWatched) {
			svgWatched = true;
			mo.observe(svg, {
				attributes:      true,
				attributeFilter: ["style", "viewBox", "width", "height"],
			});
		}
	});
	mo.observe(el, {
		childList:       true,
		subtree:         true,
		attributes:      true,
		attributeFilter: ["viewBox", "width", "height"],
	});

	const ro = new ResizeObserver(() => {
		const svg = diagramSvg(el);
		if (svg && stampSvgSize(svg)) done();
	});
	ro.observe(el);

	diagObservers.set(el, { mo, ro });

	setTimeout(done, 10_000);
}


/**
 * Decorate the code blocks, diagrams, charts and tables in rendered markdown.
 * `onPin` adds a pin beside each one's Copy (ADR-216) — passed only for an
 * ANSWER; a pin's own body, a summary card or a vault note gets none.
 */
export function decorateCodeBlocks(
	container: HTMLElement,
	diagObservers: WeakMap<HTMLElement, DiagObserverEntry>,
	onPin?: PinBlock,
): void {
	container.querySelectorAll<HTMLElement>("pre:not([data-decorated])").forEach((pre) => {
		if (pre.closest(".block-language-mermaid, .block-language-plantuml")) return;
		// Obsidian is about to replace this <pre> with the drawing; framing it
		// as code would leave the diagram inside a "mermaid" code frame.
		if (pre.querySelector(":scope > code.language-mermaid")) return;
		pre.dataset.decorated = "1";
		const frame = wrapInScrollFrame(pre);

		const lang = pre.querySelector("code")?.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";

		// Frameless header row: code-2 icon + language name (left), copy (right).
		// The header sits above the <pre>, which carries only top/bottom hairlines.
		const head = createEl("div", { cls: "p-code-head" });
		frame.insertBefore(head, pre);
		setIcon(head.createEl("span", { cls: "p-code-type-icon" }), "code-2");
		head.createEl("span", { cls: "p-code-lang", text: lang || "code" });

		const actions = head.createEl("div", { cls: "p-code-actions" });
		const copyBtn = actions.createEl("button", { cls: "pb pb-icon p-code-btn p-code-copy", attr: { title: t("copyCodeTooltip") } });
		setIcon(copyBtn, "copy");
		copyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void copyTextWithFeedback(copyBtn, codeBlockSource(pre));
		});
		if (onPin) appendPinButton(actions, "p-code-btn", "code", () => codeBlockSource(pre), onPin);

		attachDragToPan(pre);
	});

	decorateDiagrams(container, diagObservers, onPin);
	watchPendingMermaid(container, diagObservers, onPin);

	// A chart card is drawn by the global code-block processor, which cannot be
	// handed a pin; it records its source instead, and the pin goes on here.
	if (onPin) {
		container.querySelectorAll<HTMLElement>(".p-chart-card:not(.p-chart-card--error)").forEach((card) => {
			const actions = card.querySelector<HTMLElement>(".p-chart-actions");
			const source = chartSourceOf(card);
			if (!actions || !source || actions.querySelector(".p-pin-btn")) return;
			appendPinButton(actions, "p-chart-btn", "chart", () => source, onPin);
		});
	}

	// Wide tables get the same scroll-frame treatment (ADR-131).
	decorateTables(container, onPin);
}

/**
 * Obsidian draws a Mermaid block after the render returns, when its library has
 * loaded and the block is on screen, by swapping the `<pre>` for a new element.
 * So a pending block is watched until none is left: each swap is decorated as
 * it lands. No timeout — a block in a hidden pane is drawn when shown, which may
 * be much later. The observer ends when the last block is drawn; if the answer
 * is thrown away first, it goes with the subtree it observes.
 */
const mermaidWatchers = new WeakMap<HTMLElement, MutationObserver>();

function watchPendingMermaid(
	container: HTMLElement,
	diagObservers: WeakMap<HTMLElement, DiagObserverEntry>,
	onPin?: PinBlock,
): void {
	const pending = (): boolean => Array.from(container.querySelectorAll(MERMAID_PENDING))
		.some((code) => !code.closest(MERMAID_GUARD));
	mermaidWatchers.get(container)?.disconnect();
	mermaidWatchers.delete(container);
	if (!pending()) return;
	const mo = new MutationObserver(() => {
		decorateDiagrams(container, diagObservers, onPin);
		if (!pending()) { mo.disconnect(); mermaidWatchers.delete(container); }
	});
	mo.observe(container, { childList: true, subtree: true });
	mermaidWatchers.set(container, mo);
}

/** Every undecorated diagram in `container`: natural size, a scroll frame, and
 *  Copy/Pin when the renderer left its source behind. */
function decorateDiagrams(
	container: HTMLElement,
	diagObservers: WeakMap<HTMLElement, DiagObserverEntry>,
	onPin?: PinBlock,
): void {
	container.querySelectorAll<HTMLElement>(DIAGRAM_SELECTOR).forEach((el) => {
		if (el.closest(SELF_SIZED)) return;
		if (el.querySelector("pre") && !diagramSvg(el)) return;
		el.dataset.decorated = "1";

		const source = diagramSource(el);

		if (source) {
			const copyBtn = el.createEl("button", {
				cls:  "pb pb-icon p-code-btn p-code-copy p-diag-copy",
				attr: { title: t("copyDiagramTooltip") },
			});
			setIcon(copyBtn, "copy");
			copyBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				void copyTextWithFeedback(copyBtn, source);
			});
			if (onPin) appendPinButton(el, "p-code-btn p-diag-copy p-diag-pin", "diagram", () => source, onPin);
		}

		fixDiagramSvgSize(el, diagObservers);
		attachDragToPan(el);
	});
}
