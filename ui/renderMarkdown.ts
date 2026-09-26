import { type App, type Component, MarkdownRenderer } from "obsidian";
import { decorateTables } from "./tableDecorator";

/**
 * Render markdown into `el` and apply the decorations that every Pythia surface
 * should share.
 *
 * Today that means tables: a wide one is wrapped in a scroll frame instead of
 * being squeezed into the sidebar (ADR-131). Assistant messages get this via
 * `decorateCodeBlocks`, which also handles code and diagrams; the secondary
 * surfaces — summary cards, the fork anchor, the merge anchor — render plain
 * markdown and previously got no table treatment at all, which is the gap this
 * closes.
 *
 * Decoration runs after the render promise resolves, because the tables do not
 * exist in the DOM until then. Errors are logged rather than thrown: a failed
 * summary render must not take down the surface around it.
 */
export function renderRichMarkdown(
	app: App,
	md: string,
	el: HTMLElement,
	component: Component,
): void {
	void MarkdownRenderer.render(app, md, el, "", component)
		.then(() => decorateTables(el))
		.catch((e) => console.error("[Pythia] markdown render:", e));
}

/** `renderRichMarkdown`, awaited — for a caller that decorates what it rendered
 *  (the answer tabs paint citations and marks onto the result, ADR-219). */
export async function renderRichMarkdownAsync(app: App, md: string, el: HTMLElement, component: Component): Promise<void> {
	try {
		await MarkdownRenderer.render(app, md, el, "", component);
		decorateTables(el);
	} catch (e) {
		console.error("[Pythia] markdown render:", e);
	}
}
