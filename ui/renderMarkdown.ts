import { type App, Component, MarkdownRenderer } from "obsidian";
import { blockRemoteMedia, deferRemoteMedia } from "./remoteMedia";
import { decorateTables } from "./tableDecorator";

/**
 * Render MODEL-PRODUCED markdown: the one door every answer, summary, anchor
 * and pin goes through, so no remote image or media loads until the user asks
 * (ui/remoteMedia.ts). Rejects as `MarkdownRenderer.render` does; the caller
 * decides what a failed render says.
 */
export async function renderAnswerMarkdown(app: App, md: string, el: HTMLElement, component: Component): Promise<void> {
	try {
		await MarkdownRenderer.render(app, deferRemoteMedia(md), el, "", component);
	} finally {
		blockRemoteMedia(el);
	}
}

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
	void renderAnswerMarkdown(app, md, el, component)
		.then(() => decorateTables(el))
		.catch((e) => console.error("[Pythia] markdown render:", e));
}

/** `renderRichMarkdown`, awaited — for a caller that decorates what it rendered
 *  (the answer tabs paint citations and marks onto the result, ADR-219). */
export async function renderRichMarkdownAsync(app: App, md: string, el: HTMLElement, component: Component): Promise<void> {
	try {
		await renderAnswerMarkdown(app, md, el, component);
		decorateTables(el);
	} catch (e) {
		console.error("[Pythia] markdown render:", e);
	}
}

/**
 * One child Component that owns ONE render and is replaced — and unloaded — by
 * the next. Rendering straight into the view left a child per render until the
 * view closed (the message list per rebuild, a comparison body per tab switch,
 * an answer tab per select). PinController's pin body is the same pattern.
 */
export class RenderSlot {
	private child: { parent: Component; comp: Component } | null = null;

	/** `parent` is read at each renew: a slot may hang under the current rebuild. */
	constructor(private readonly parent: () => Component | undefined) {}

	get current(): Component | null { return this.child?.comp ?? null; }

	/** Release the previous render and hand out a fresh owner for the next. */
	renew(): Component {
		this.release();
		const parent = this.parent();
		const comp = new Component();
		if (parent) {
			parent.addChild(comp);
			this.child = { parent, comp };
		} else {
			comp.load(); // headless use: nothing to hang it on, still unloaded on release
			this.child = { parent: comp, comp };
		}
		return comp;
	}

	release(): void {
		const c = this.child;
		this.child = null;
		if (!c) return;
		if (c.parent === c.comp) c.comp.unload();
		else c.parent.removeChild(c.comp);
	}
}
