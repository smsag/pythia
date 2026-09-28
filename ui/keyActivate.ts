/**
 * The ONE way a click-only span or div becomes a keyboard control (principle 4).
 *
 * Several link-like controls are spans on purpose — a real `<a>` picks up
 * Obsidian core's anchor underline, a `<button>` would restyle an inline name —
 * but a span is invisible to the keyboard and to a screen reader. This gives
 * one the role, a tab stop and Enter/Space, calling the same handler a click
 * does. The element is transient (rebuilt with its row), so its own listener is
 * released with it; nothing is registered on the document.
 */
export function makeKeyActivatable(
	el: HTMLElement,
	activate: (e: KeyboardEvent) => void,
	role: "button" | "link" | "menuitem" = "button",
): void {
	el.setAttribute("role", role);
	if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
	el.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.isComposing) return;
		// A link answers Enter only; a button and a menu item answer Space too.
		if (e.key === "Enter" || (e.key === " " && role !== "link")) {
			e.preventDefault();
			e.stopPropagation();
			activate(e);
		}
	});
}
