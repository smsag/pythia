import { parseRgb, readableOnAccent, type Rgb } from "../services/color";

/**
 * Resolve a readable text color for accent-filled surfaces and publish it as
 * `--p-on-accent` on `root`.
 *
 * The plugin cannot know a theme's accent in advance, so the accent is resolved
 * through a throwaway probe span (the only way to read a CSS custom property's
 * computed value) and `readableOnAccent` picks **pure white or pure black**,
 * whichever contrasts more.
 *
 * **Theme tokens are no longer candidates** (ADR-154). This used to offer the
 * theme's `--text-on-accent` / `--text-on-accent-inverted` and keep the better
 * one whenever it cleared AA, to respect a theme that deliberately tints its
 * on-accent label. Two problems with that, and the second is the one that was
 * reported: the label is 10px mono, where a token sitting just over 4.5 is still
 * hard work; and a token that clears AA *numerically* can still be a dark grey on
 * a mid accent, which is what a user saw on the Send button. Black and white are
 * the two highest-contrast choices available against any colour — there is no
 * accent for which a theme token beats both — so deferring to a token could only
 * ever lower contrast. Honouring a theme's taste is not worth an unreadable
 * primary action.
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

	// No candidates: pure black or white, whichever reads better on this accent.
	root.style.setProperty("--p-on-accent", readableOnAccent(accent, []));
}
