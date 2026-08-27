/**
 * Accent-contrast helpers.
 *
 * Obsidian ships `--text-on-accent` (and its counterpart `--text-on-accent-inverted`)
 * but the value is static — the theme fixes it (white in the default theme) and
 * never recomputes it from the user's chosen `--color-accent`. A pale or mid-tone
 * accent therefore renders on-accent labels (Send button, active toolbar/effort
 * pills) with poor contrast. These pure functions pick a readable on-accent label
 * color using WCAG relative luminance — preferring a theme token when it clears AA,
 * else falling back to pure black/white (guaranteed readable on any accent).
 */

export type Rgb = [number, number, number];

/** Parse an `rgb(...)` / `rgba(...)` string (as returned by getComputedStyle) to
 *  an [r,g,b] triple. Returns null for anything unparseable. */
export function parseRgb(value: string): Rgb | null {
	const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
	if (!m) return null;
	const rgb: Rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
	return rgb.every((c) => Number.isFinite(c)) ? rgb : null;
}

/** WCAG 2.1 relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: Rgb): number {
	const lin = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1 … 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Choose the CSS color value for an on-accent label that stays readable on
 * `accent`. `tokens` are the theme's candidate on-accent colors (each a CSS value
 * string plus its resolved rgb, e.g. `--text-on-accent` / `--text-on-accent-inverted`);
 * the highest-contrast one is used **only** when it clears `aa` (WCAG AA, default
 * 4.5). Otherwise — the case where every theme token reads poorly on this accent —
 * it falls back to pure `"#ffffff"` or `"#000000"`, whichever contrasts more, which
 * is guaranteed readable on ANY accent. Pass `tokens: []` to always use the
 * black/white fallback.
 */
export function readableOnAccent(
	accent: Rgb,
	tokens: { value: string; rgb: Rgb }[],
	aa = 4.5,
): string {
	const best = tokens
		.map((tkn) => ({ value: tkn.value, cr: contrastRatio(accent, tkn.rgb) }))
		.sort((a, b) => b.cr - a.cr)[0];
	if (best && best.cr >= aa) return best.value;
	return contrastRatio(accent, [255, 255, 255]) >= contrastRatio(accent, [0, 0, 0])
		? "#ffffff"
		: "#000000";
}
