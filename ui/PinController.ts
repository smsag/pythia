import { Component, Notice, setIcon, type App } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Pin, PinKind } from "../models/types";
import { t } from "../i18n";
import { addPin, isRefusal, pinExcerpt, removePin, type PinDraft } from "../services/pins";
import { buildAccordion, setAccordionOpen } from "./accordion";
import { scrollChatTo } from "./chatScroll";
import { chartBlockAsTable } from "../services/chartSpec";
import { CHART_VIEW_EVENT, chartSourceOf, chartViewOf, setChartView, type ChartView, type ChartViewDetail } from "./chart/card";
import { copyTextWithFeedback } from "./clipboard";
import { decorateCodeBlocks } from "./CodeBlockDecorator";
import { describeErrorForLog } from "../services/redact";
import { flashText } from "./HighlightPainter";
import { PIN_ICON } from "./icons";
import { codeBlockSource, diagramSource, tableMarkdown, type PinBlock } from "./pinSources";
import { findAnswerEl } from "./AnswerTabsController";
import { renderAnswerMarkdown } from "./renderMarkdown";

export interface PinDeps {
	app: App;
	plugin: PythiaPlugin;
	/** The view: the owner of what `MarkdownRenderer` renders into a pin. */
	component: Component;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	expandBubbleIfCollapsed(row: HTMLElement): void;
}

/**
 * How ↗ finds each kind of block again: where to look, and the same builder
 * that made the snapshot. A Record over every non-text kind, so a new `PinKind`
 * is a compile error here — not the runtime `undefined` two parallel lists gave.
 */
const BLOCK_FINDERS: Record<Exclude<PinKind, "text">, { selector: string; sourceOf: (el: HTMLElement) => string | undefined }> = {
	code:    { selector: "pre", sourceOf: (el) => codeBlockSource(el) },
	diagram: { selector: "[class*='block-language-']", sourceOf: (el) => diagramSource(el) },
	chart:   { selector: ".p-chart-card", sourceOf: (el) => chartSourceOf(el) },
	table:   { selector: "table", sourceOf: (el) => tableMarkdown(el as HTMLTableElement) },
};

/** What the strip calls each kind. Literal `t()` calls, so the dead-key test
 *  can see every key used. */
function kindLabel(kind: PinKind): string {
	switch (kind) {
		case "text":    return t("pinKindText");
		case "code":    return t("pinKindCode");
		case "diagram": return t("pinKindDiagram");
		case "chart":   return t("pinKindChart");
		case "table":   return t("pinKindTable");
	}
}

/**
 * Answer content pinned to the top of the conversation (ADR-216).
 *
 * A floating overlay inside `.pythia-messages-wrapper`: one accordion showing
 * ONE pin — collapsed to a single line by default, the chat scrolling under it —
 * with ‹ n/m › when there are several, copy, ↗ back to the source and ✕. The
 * collapsed line's height is published as `--p-pin-strip-h`, which pads the top
 * of `.p-chat` so nothing is hidden under the strip at scroll 0; an EXPANDED pin
 * floats over the chat on purpose, and `scrollChatTo` measures it when jumping.
 *
 * Pins are data on the conversation; which one is shown, whether it is open and
 * which way a pinned chart shows its data are view state, kept here for the
 * session and never written.
 */
export class PinController {
	private overlay: HTMLElement | null = null;
	private wrapper: HTMLElement | null = null;
	private signature = "";
	/** Conversations whose pin is open. Per conversation, like the pin shown, and
	 *  for the session only: view state, never written (ADR-216 addendum). */
	private readonly opened = new Set<string>();
	private readonly shown = new Map<string, string>(); // conversation id → pin id shown
	/** A chart pin shown as its table (ADR-254): pinned from the table view, or
	 *  switched to it in the strip. Only "table" is kept — "chart" is the default.
	 *  The pin's own: a switch in the strip never reaches the answer, nor one in
	 *  the answer the strip. For the session only, like `opened`. */
	private readonly chartViews = new Map<string, ChartView>(); // pin id → view
	/** Owns what the open pin's body rendered; replaced — and unloaded — with it. */
	private bodyComponent: Component | null = null;
	private readonly diagObservers = new WeakMap<HTMLElement, { mo: MutationObserver; ro: ResizeObserver }>();
	private stripObserver: ResizeObserver | null = null;

	constructor(private readonly d: PinDeps) {}

	/** Build the (empty, hidden) overlay into the messages wrapper. */
	mount(wrapper: HTMLElement): void {
		this.wrapper = wrapper;
		this.overlay = wrapper.createDiv({ cls: "p-pins" });
		this.overlay.hidden = true;
		this.signature = "";
	}

	/** Pin the selected passage (the selection strip's Pin). */
	pinText(text: string, messageId: string, occurrenceIndex: number | undefined): void {
		this.add({ messageId, kind: "text", source: text, occurrenceIndex });
	}

	/** Pin a code block, diagram, chart or table (its own pin button). */
	readonly pinBlock: PinBlock = (kind, source, from) => {
		const row = from.closest<HTMLElement>("[data-msg-id]");
		if (!row) {
			// Inside the streaming answer: its row has no id until it commits. (Inside
			// a pin's own body no pin button is ever drawn.)
			if (from.closest(".p-msg-ai")) new Notice(t("pinNotYet"));
			return;
		}
		if (row.classList.contains("p-msg-user")) return;
		// A chart is pinned in the view it was showing: the pin is the whole card,
		// both views, and it opens as what the user was looking at (ADR-254).
		const view = kind === "chart" ? chartViewOf(from.closest(".p-chart-card")) : "chart";
		this.add({ messageId: row.getAttribute("data-msg-id") ?? "", kind, source }, view);
	};

	private add(draft: PinDraft, chartView: ChartView = "chart"): void {
		const conv = this.d.getConversation();
		if (!conv || !draft.messageId) return;
		const result = addPin(conv, draft, crypto.randomUUID(), new Date().toISOString());
		if (isRefusal(result)) {
			if (result.reason === "limit") new Notice(t("pinLimit", { limit: result.limit }));
			else if (result.reason === "tooLong") new Notice(t("pinTooLong", { chars: result.chars, max: result.max }));
			return; // "empty": nothing was selected — the idle case, nothing to say
		}
		// Pinning a chart already pinned returns that pin; it now opens in the view
		// it was pinned from again, so its body must be redrawn even if it is shown.
		if (draft.kind === "chart" && this.setChartPinView(result.id, chartView)) this.signature = "";
		this.shown.set(conv.id, result.id);
		void this.d.plugin.conversationStore.save(conv);
		this.render();
	}

	/**
	 * Draw the pins of the current conversation. Cheap when nothing changed: keyed
	 * on the conversation, its pins and the one shown, so a new message does not
	 * re-render a pinned diagram.
	 */
	render(): void {
		const overlay = this.overlay;
		if (!overlay || !this.wrapper) return;
		const conv = this.d.getConversation();
		const pins = conv?.pins ?? [];
		if (!conv || pins.length === 0) {
			this.hide();
			return;
		}
		const shownId = this.shown.get(conv.id);
		const index = Math.max(0, pins.findIndex((p) => p.id === shownId));
		const pin = pins[index];
		const signature = `${conv.id}|${pins.map((p) => p.id).join(",")}|${pin.id}`;
		if (signature === this.signature && !overlay.hidden) return;
		this.signature = signature;

		overlay.empty();
		overlay.hidden = false;
		this.wrapper.addClass("has-pins");

		const acc = buildAccordion(overlay, {
			cls: "p-pin",
			icon: PIN_ICON,
			title: `${kindLabel(pin.kind)} · ${pinExcerpt(pin.kind, pin.source)}`,
			open: this.opened.has(conv.id),
			onToggle: (open) => { if (open) this.opened.add(conv.id); else this.opened.delete(conv.id); },
		});

		if (pins.length > 1) {
			const step = (by: number): void => {
				this.shown.set(conv.id, pins[(index + by + pins.length) % pins.length].id);
				this.render();
			};
			this.iconButton(acc.actions, "chevron-left", t("pinPrevTooltip"), () => step(-1));
			acc.actions.createSpan({ cls: "p-pin-count", text: t("pinCount", { n: index + 1, m: pins.length }) });
			this.iconButton(acc.actions, "chevron-right", t("pinNextTooltip"), () => step(1));
		}
		// Collapsed, the strip keeps what is used without opening it — cycling and ↗ —
		// so the title keeps its room in a 300px sidebar (measured: all six squeezed
		// it to "Text · the …"). Copy and ✕ act on what you can see, so they come
		// with the open pin (`.p-pin-action--open`, hidden by CSS while collapsed).
		const copy = this.iconButton(acc.actions, "copy", t("pinCopyTooltip"), () => void copyTextWithFeedback(copy, this.copyText(pin)), true);
		this.iconButton(acc.actions, "arrow-up-right", t("pinJumpTooltip"), () => this.jump(conv, pin, acc.root));
		this.iconButton(acc.actions, "x", t("pinRemoveTooltip"), () => this.unpin(conv, pin), true);

		this.renderBody(acc.body, pin);
		this.publishStripHeight(acc.root.querySelector<HTMLElement>(".p-acc-head"));
	}

	private renderBody(body: HTMLElement, pin: Pin): void {
		if (pin.kind === "text") {
			this.releaseBody(); // the previous pin's rendered body, if it had one
			// Selected text is not Markdown: a leading "#" or "1." must stay itself.
			body.createDiv({ cls: "p-pin-text", text: pin.source });
			return;
		}
		const inner = body.createDiv({ cls: "p-pin-rendered p-ai-body" });
		if (pin.kind === "chart") {
			// The card's own switch, pressed in the strip: this pin keeps the view, and
			// cancelling tells the card not to put it in the session's memory, which
			// the answer the chart came from would read on its next draw (ADR-254).
			// The listener lives and dies with `inner`, drawn anew for every pin shown.
			inner.addEventListener(CHART_VIEW_EVENT, (e) => {
				e.preventDefault();
				this.setChartPinView(pin.id, (e as CustomEvent<ChartViewDetail>).detail.view);
			});
		}
		// A snapshot of model output: remote media waits for a press (ui/remoteMedia.ts).
		renderAnswerMarkdown(this.d.app, pin.source, inner, this.freshBodyComponent()).then(
			// The same decorations as in the answer — header, copy, pan, sizing — and
			// deliberately NO pin: a pin's body is not a place to pin from. A chart
			// is then shown in this pin's view, read now rather than before the
			// render: the strip may have been switched while it ran (principle 7).
			() => {
				decorateCodeBlocks(inner, this.diagObservers);
				const card = pin.kind === "chart" ? inner.querySelector<HTMLElement>(".p-chart-card") : null;
				if (card) setChartView(card, this.chartPinView(pin.id));
			},
			(e: unknown) => {
				// Never an empty pin and nothing said (principle 2): log what a report
				// can quote, and show the snapshot as the text it is.
				console.error("[Pythia] pin render failed:", describeErrorForLog(e));
				inner.empty();
				inner.removeClass("p-ai-body");
				inner.addClass("p-pin-text");
				inner.setText(pin.source);
			},
		);
	}

	/**
	 * A child of the view that owns ONE pin body's render. Rendering straight into
	 * the view left a child per render — cycling five pins ten times kept fifty —
	 * until the view closed. Replacing the child unloads what the last body
	 * registered (ADR-216 addendum).
	 */
	private freshBodyComponent(): Component {
		this.releaseBody();
		this.bodyComponent = this.d.component.addChild(new Component());
		return this.bodyComponent;
	}

	private releaseBody(): void {
		if (this.bodyComponent) this.d.component.removeChild(this.bodyComponent);
		this.bodyComponent = null;
	}

	/** The view a chart pin opens in. */
	private chartPinView(pinId: string): ChartView {
		return this.chartViews.get(pinId) ?? "chart";
	}

	/** Record a chart pin's view; true when that changed it. */
	private setChartPinView(pinId: string, view: ChartView): boolean {
		const changed = this.chartPinView(pinId) !== view;
		if (view === "table") this.chartViews.set(pinId, view);
		else this.chartViews.delete(pinId);
		return changed;
	}

	/** What the strip's Copy copies: what the open pin shows (ADR-216). A chart
	 *  shown as its table copies the table as Markdown (ADR-254) — the same text
	 *  as the card's own *Copy table*; anything else, the snapshot. */
	private copyText(pin: Pin): string {
		if (pin.kind === "chart" && this.chartPinView(pin.id) === "table") return chartBlockAsTable(pin.source) ?? pin.source;
		return pin.source;
	}

	private iconButton(parent: HTMLElement, icon: string, title: string, onClick: () => void, whenOpen = false): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: `pb pb-icon p-pin-action${whenOpen ? " p-pin-action--open" : ""}`, attr: { title, "aria-label": title } });
		setIcon(btn, icon);
		btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
		return btn;
	}

	private unpin(conv: Conversation, pin: Pin): void {
		removePin(conv, pin.id);
		this.chartViews.delete(pin.id);
		void this.d.plugin.conversationStore.save(conv);
		this.render();
	}

	/**
	 * ↗: back to where the pin came from. The pin collapses first, so what it
	 * jumps to is not under it. A snapshot outlives its message — deleted, retried,
	 * moved to a fork by a comparison — and then this says so.
	 */
	private jump(conv: Conversation, pin: Pin, root: HTMLElement): void { void this.jumpTo(conv, pin, root); }

	private async jumpTo(conv: Conversation, pin: Pin, root: HTMLElement): Promise<void> {
		const messagesEl = this.d.getMessagesEl();
		// An answer's row — found at once, so the jump stays in the tap — or the
		// comparison tab it was pinned from, brought up first (ADR-225).
		const row = messagesEl.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(pin.messageId)}"]`)
			?? await findAnswerEl(messagesEl, pin.messageId);
		if (!row) { new Notice(t("pinGone")); return; }
		this.opened.delete(conv.id);
		setAccordionOpen(root, false);
		this.d.expandBubbleIfCollapsed(row);
		const target = this.findSource(row, pin);
		scrollChatTo(messagesEl, target ?? row);
	}

	/** The pinned thing inside its message, found by the same builder that made
	 *  the snapshot; null when the answer no longer holds it. Flashed when found. */
	private findSource(row: HTMLElement, pin: Pin): HTMLElement | null {
		const body = row.querySelector<HTMLElement>(".p-ai-body") ?? row;
		if (pin.kind === "text") return flashText(body, pin.source, pin.occurrenceIndex ?? 0);
		const { selector, sourceOf } = BLOCK_FINDERS[pin.kind];
		const hit = Array.from(body.querySelectorAll<HTMLElement>(selector)).find((el) => sourceOf(el) === pin.source) ?? null;
		if (hit) {
			hit.addClass("p-pin-flash-block");
			setTimeout(() => hit.removeClass("p-pin-flash-block"), 1200);
		}
		return hit;
	}

	/** The collapsed line's height pads the chat's top, so the strip never hides
	 *  the start of the conversation. Measured: the line's height is the theme's. */
	private publishStripHeight(head: HTMLElement | null): void {
		this.stripObserver?.disconnect();
		if (!head || !this.wrapper) return;
		const wrapper = this.wrapper;
		const set = (): void => wrapper.style.setProperty("--p-pin-strip-h", `${head.offsetHeight}px`);
		set();
		if (typeof ResizeObserver === "function") {
			this.stripObserver = new ResizeObserver(set);
			this.stripObserver.observe(head);
		}
	}

	/** The view closed: stop measuring the strip and release the pin's body. */
	dispose(): void {
		this.hide();
	}

	private hide(): void {
		this.stripObserver?.disconnect();
		this.stripObserver = null;
		this.signature = "";
		this.releaseBody();
		if (this.overlay) { this.overlay.empty(); this.overlay.hidden = true; }
		this.wrapper?.removeClass("has-pins");
		this.wrapper?.style.removeProperty("--p-pin-strip-h");
	}
}
