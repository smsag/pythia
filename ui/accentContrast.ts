import { parseRgb, readableOnAccent, type Rgb } from "../services/color";

/**
 * Resolve a readable text color for accent-filled surfaces and publish it as
 * `--p-on-accent` on `root`.
 *
 * The plugin cannot know a theme's accent in advance, and a theme's own
 * `--text-on-accent` is not guaranteed to clear AA contrast against it. So the
 * accent and the theme's two on-accent tokens are resolved through a throwaway
 * probe span (the only way to read a CSS custom property's computed value), and
 * `readableOnAccent` picks the best candidate that clears AA, falling back to
 * pure black or white when none does.
 *
 * Moved out of `sidebar.ts` (ADR-097 ratchet, ADR-130 session): it reads nothing
 * from the view but the root element, so it belongs beside the other UI helpers.
 * `services/color.ts` stays DOM-free, which is what keeps it unit-testable.
 */
export function applyAccentContrast(root: HTMLElement): void {
	const resolve = (expr: string): Rgb | null => {
		const probe = root.createSpan();
		probe.style.color = expr;
		probe.style.display = "none";
		const rgb = parseRgb(getComputedStyle(probe).color);
		probe.remove();
		return rgb;
	};
	const accent = resolve("var(--color-accent)");
	if (!accent) {
		root.style.removeProperty("--p-on-accent"); // leave the CSS fallback in charge
		return;
	}

	// Offer the theme's own on-accent tokens (when defined and resolvable) as
	// candidates; readableOnAccent uses the best one only if it clears AA, else
	// forces pure black/white. Keeping the CSS var strings (not the resolved rgb)
	// as the values means the label still tracks a later theme edit to that token.
	const tokens: { value: string; rgb: Rgb }[] = [];
	const onAccent = resolve("var(--text-on-accent, #fff)");
	const inverted = resolve("var(--text-on-accent-inverted, #000)");
	if (onAccent) tokens.push({ value: "var(--text-on-accent, #fff)", rgb: onAccent });
	if (inverted) tokens.push({ value: "var(--text-on-accent-inverted, #000)", rgb: inverted });

	root.style.setProperty("--p-on-accent", readableOnAccent(accent, tokens));
}
