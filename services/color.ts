/**
 * Accent-contrast helpers.
 *
 * Obsidian ships `--text-on-accent` (and its counterpart `--text-on-accent-inverted`)
 * but the value is static — the theme fixes it (white in the default theme) and
 * never recomputes it from the user's chosen `--color-accent`. A pale or mid-tone
 * accent therefore renders on-accent labels (Send button, active toolbar/effort
 * pills) with poor contrast. These pure functions decide which of the two theme
 * tokens actually reads better on a given accent, using WCAG relative luminance.
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
 * Given the accent color and both on-accent theme tokens, return which one reads
 * better on the accent. "normal" → `--text-on-accent`, "inverted" →
 * `--text-on-accent-inverted`. Ties favor "normal" (the theme's intended default).
 */
export function betterOnAccent(accent: Rgb, onAccent: Rgb, onAccentInverted: Rgb): "normal" | "inverted" {
	return contrastRatio(accent, onAccent) >= contrastRatio(accent, onAccentInverted)
		? "normal"
		: "inverted";
}
