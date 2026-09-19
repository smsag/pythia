/**
 * The input toolbar's design-system icons (docs/design.md): inline SVG at
 * stroke-width 1.6, not Obsidian's `setIcon`, because the design system
 * specifies these glyphs. Moved out of `PythiaSidebarView` under the ADR-097
 * ratchet — they are drawing, not view logic.
 */

const SVG_ATTR = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6" };

/** Paperclip — attach a note. */
export function drawAttachIcon(btn: HTMLElement): void {
	const svg = btn.createSvg("svg", { attr: SVG_ATTR });
	svg.createSvg("path", {
		attr: { d: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" },
	});
}

/** Floppy disk — save the response to a note. */
export function drawSaveIcon(btn: HTMLElement): void {
	const svg = btn.createSvg("svg", { attr: SVG_ATTR });
	svg.createSvg("path", {
		attr: { d: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" },
	});
	svg.createSvg("polyline", { attr: { points: "17 21 17 13 7 13 7 21" } });
	svg.createSvg("polyline", { attr: { points: "7 3 7 8 15 8" } });
}

/** The toolbar's shared on/off state: accent fill plus `aria-pressed`. A button
 *  not built yet (the toolbar mounts after the first paint) is skipped. */
export function paintToggle(btn: HTMLElement | undefined, on: boolean): void {
	if (!btn) return;
	btn.toggleClass("is-active", on);
	btn.setAttr("aria-pressed", String(on));
}
