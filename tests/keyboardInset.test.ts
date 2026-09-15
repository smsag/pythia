import { describe, it, expect } from "vitest";
import {
	keyboardOverlap,
	needsBottomSafeArea,
	BOTTOM_EDGE_TOLERANCE,
	MIN_KEYBOARD_INSET,
	type ViewportMetrics,
} from "../ui/keyboardInset";

/** A phone-sized layout viewport with the panel ending at the bottom of it. */
const base: ViewportMetrics = {
	containerBottom: 900,
	layoutHeight: 900,
	visualHeight: 900,
	visualOffsetTop: 0,
};

describe("keyboardOverlap", () => {
	it("is 0 at rest, so the panel is never touched without a keyboard", () => {
		expect(keyboardOverlap(base)).toBe(0);
	});

	it("is 0 for the stacked-sidebar case that caused the dead strip (ADR-132)", () => {
		// The panel is one of several leaves: it ends well above the viewport
		// bottom, and Obsidian's own chrome occupies the rest. The old code
		// measured a difference here and shrank the panel by it, leaving
		// uncovered background below. Nothing is covering the panel, so: 0.
		expect(keyboardOverlap({ ...base, containerBottom: 700 })).toBe(0);
	});

	it("is 0 when the viewport shrinks by less than a keyboard", () => {
		// Obsidian's bottom chrome and the home indicator are tens of pixels, not
		// hundreds. The safe-area padding on the input area covers those.
		expect(keyboardOverlap({ ...base, visualHeight: 900 - (MIN_KEYBOARD_INSET - 1) })).toBe(0);
	});

	it("reports the covered height once a real keyboard is open", () => {
		// 350px keyboard: visible area ends at 550, panel ends at 900.
		expect(keyboardOverlap({ ...base, visualHeight: 550 })).toBe(350);
	});

	it("reports only the part of the panel actually covered", () => {
		// Panel ends at 700, keyboard starts at 550 → 150px of it is covered.
		expect(keyboardOverlap({ ...base, containerBottom: 700, visualHeight: 550 })).toBe(150);
	});

	it("is 0 when a keyboard is open but the panel sits entirely above it", () => {
		expect(keyboardOverlap({ ...base, containerBottom: 500, visualHeight: 550 })).toBe(0);
	});

	it("accounts for a scrolled or pinch-zoomed visual viewport", () => {
		// offsetTop shifts the visible band down, so the visible bottom is 100+500.
		expect(keyboardOverlap({
			containerBottom: 800, layoutHeight: 900, visualHeight: 500, visualOffsetTop: 100,
		})).toBe(200);
	});

	it("rounds to whole pixels", () => {
		expect(keyboardOverlap({ ...base, containerBottom: 900.4, visualHeight: 550 })).toBe(350);
		expect(keyboardOverlap({ ...base, containerBottom: 900.6, visualHeight: 550 })).toBe(351);
	});
});

describe("needsBottomSafeArea", () => {
	const SCREEN = 900;

	it("is true when the panel reaches the bottom of the screen", () => {
		// Pythia is the only leaf: the home indicator really is under the composer.
		expect(needsBottomSafeArea(900, SCREEN)).toBe(true);
	});

	it("is false when another leaf sits below the panel (ADR-134)", () => {
		// The reported case: a stacked mobile sidebar. env(safe-area-inset-bottom)
		// still reports the device inset here, which is why CSS alone reserved ~25px
		// of dead space under the composer.
		expect(needsBottomSafeArea(700, SCREEN)).toBe(false);
	});

	it("tolerates sub-pixel layout and a hairline border at the edge", () => {
		expect(needsBottomSafeArea(SCREEN - BOTTOM_EDGE_TOLERANCE, SCREEN)).toBe(true);
		expect(needsBottomSafeArea(SCREEN - BOTTOM_EDGE_TOLERANCE - 1, SCREEN)).toBe(false);
	});

	it("is true when the panel extends past the screen bottom", () => {
		expect(needsBottomSafeArea(950, SCREEN)).toBe(true);
	});
});
