import { setIcon } from "obsidian";
import { t } from "../i18n";

type DiagObserverEntry = { mo: MutationObserver; ro: ResizeObserver };

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

	const existing = el.querySelector<SVGElement>("svg");
	if (existing && stampSvgSize(existing)) return;

	let svgWatched = false;
	const done = () => {
		mo.disconnect();
		ro.disconnect();
		diagObservers.delete(el);
	};
	const mo = new MutationObserver(() => {
		const svg = el.querySelector<SVGElement>("svg");
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
		const svg = el.querySelector<SVGElement>("svg");
		if (svg && stampSvgSize(svg)) done();
	});
	ro.observe(el);

	diagObservers.set(el, { mo, ro });

	setTimeout(done, 10_000);
}

function attachDragToPan(el: HTMLElement): void {
	const THRESHOLD = 5;
	let startX         = 0;
	let startScrollLeft = 0;
	let panning        = false;

	const onMove = (e: PointerEvent) => {
		const dx = e.clientX - startX;
		if (!panning) {
			if (Math.abs(dx) < THRESHOLD) return;
			panning = true;
			el.classList.add("p-panning");
		}
		el.scrollLeft = startScrollLeft - dx;
	};

	const cleanup = () => {
		if (panning) el.classList.remove("p-panning");
		panning = false;
		document.removeEventListener("pointermove",  onMove);
		document.removeEventListener("pointerup",    cleanup);
		document.removeEventListener("pointercancel", cleanup);
	};

	el.addEventListener("pointerdown", (e) => {
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		if (el.scrollWidth <= el.clientWidth) return;
		startX          = e.clientX;
		startScrollLeft = el.scrollLeft;
		panning         = false;
		document.addEventListener("pointermove",  onMove);
		document.addEventListener("pointerup",    cleanup);
		document.addEventListener("pointercancel", cleanup);
	});
}

export function decorateCodeBlocks(
	container: HTMLElement,
	diagObservers: WeakMap<HTMLElement, DiagObserverEntry>,
): void {
	container.querySelectorAll<HTMLElement>("pre:not([data-decorated])").forEach((pre) => {
		if (pre.closest(".block-language-mermaid, .block-language-plantuml")) return;
		pre.dataset.decorated = "1";
		const frame = wrapInScrollFrame(pre);

		const codeEl = pre.querySelector("code");
		const lang = codeEl?.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
		const makeFenced = (): string => {
			const raw = (codeEl ?? pre).innerText.replace(/\n$/, "");
			return `\`\`\`${lang}\n${raw}\n\`\`\``;
		};

		// Frameless header row: code-2 icon + language name (left), copy (right).
		// The header sits above the <pre>, which carries only top/bottom hairlines.
		const head = createEl("div", { cls: "p-code-head" });
		frame.insertBefore(head, pre);
		setIcon(head.createEl("span", { cls: "p-code-type-icon" }), "code-2");
		head.createEl("span", { cls: "p-code-lang", text: lang || "code" });

		const actions = head.createEl("div", { cls: "p-code-actions" });
		const copyBtn = actions.createEl("button", { cls: "p-code-btn p-code-copy", attr: { title: t("copyCodeTooltip") } });
		setIcon(copyBtn, "copy");
		copyBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await navigator.clipboard.writeText(makeFenced());
			setIcon(copyBtn, "check");
			copyBtn.addClass("copied");
			setTimeout(() => { setIcon(copyBtn, "copy"); copyBtn.removeClass("copied"); }, 1500);
		});

		attachDragToPan(pre);
	});

	const DIAG_SELECTOR = "[class*='block-language-']:not([data-decorated])";
	container.querySelectorAll<HTMLElement>(DIAG_SELECTOR).forEach((el) => {
		if (el.querySelector("pre") && !el.querySelector("svg")) return;
		el.dataset.decorated = "1";

		const codeEl = el.querySelector("code");
		const lang = el.className.match(/\bblock-language-(\S+)\b/)?.[1] ?? "mermaid";
		const source = codeEl?.innerText.replace(/\n$/, "") ?? "";

		if (source) {
			const makeFenced = (): string => `\`\`\`${lang}\n${source}\n\`\`\``;

			const copyBtn = el.createEl("button", {
				cls:  "p-code-btn p-code-copy p-diag-copy",
				attr: { title: "Copy diagram source" },
			});
			setIcon(copyBtn, "copy");
			copyBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				await navigator.clipboard.writeText(makeFenced());
				setIcon(copyBtn, "check");
				copyBtn.addClass("copied");
				setTimeout(() => { setIcon(copyBtn, "copy"); copyBtn.removeClass("copied"); }, 1500);
			});
		}

		fixDiagramSvgSize(el, diagObservers);
		attachDragToPan(el);
	});

	container.querySelectorAll<HTMLElement>("table:not([data-decorated])").forEach((table) => {
		table.dataset.decorated = "1";
		const frame = createEl("div", { cls: "p-scroll-frame" });
		table.parentNode!.insertBefore(frame, table);
		frame.appendChild(table);
		attachDragToPan(frame);
	});
}
