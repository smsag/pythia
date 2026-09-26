import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { SOURCE_ICONS } from "./icons";
import { paintToggle } from "./toolbarIcons";

export interface ResearchToggleDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	registerDomEvent(el: HTMLElement, type: "click", cb: () => void): void;
}

/** The globe's four states, and what each one says (ADR-230). */
export type ResearchState = "on" | "noKey" | "auto" | "off";

/** Which of the four states the globe is in: pure, so the rule is tested. */
export function researchState(researchMode: boolean | undefined, hasApiKey: boolean, autoArmEnabled: boolean): ResearchState {
	if (researchMode === true) return hasApiKey ? "on" : "noKey";
	return autoArmEnabled && hasApiKey ? "auto" : "off";
}

/**
 * The web-search globe in the input toolbar (ADR-230, engineering-review #257).
 *
 * The globe used to say only on or off, while a search could also run with it
 * "off" (auto-search, shown by a 1.6 s pulse) and "on" could do nothing (no
 * key, said once). Now each state is visible and named in the tooltip:
 * - on: accent fill.
 * - on without a key: no fill, warning colour — it is not searching.
 * - off, auto-search on: plain; the tooltip says it searches by itself for
 *   time-sensitive questions and links.
 * - off: plain.
 * While a send is auto-armed the globe stays lit for the whole answer, and
 * its tooltip names the word that armed it ("current", a year, a link).
 */
export class ResearchToggleController {
	private btn: HTMLButtonElement | null = null;
	/** The cue that armed the send in flight, or null when none did. */
	private armedBy: string | null = null;

	constructor(private readonly d: ResearchToggleDeps) {}

	/** Build the globe in the toolbar. */
	mount(toolbar: HTMLElement): void {
		this.btn = toolbar.createEl("button", { cls: "pb pb-icon p-tool-btn p-research-btn" });
		setIcon(this.btn, SOURCE_ICONS.web);
		this.d.registerDomEvent(this.btn, "click", () => this.toggle());
		this.paint();
	}

	/** Repaint for the active conversation, the key and the setting. */
	paint(): void {
		const btn = this.btn;
		if (!btn) return;
		const conv = this.d.getConversation();
		const { plugin } = this.d;
		const state = researchState(conv?.researchMode, plugin.webSearchService.hasApiKey(), plugin.settings.webSearchAutoArm);
		paintToggle(btn, state === "on");
		btn.toggleClass("is-nokey", state === "noKey");
		btn.toggleClass("is-auto-armed", this.armedBy !== null);
		btn.setAttr("title", this.armedBy !== null ? t("researchArmedTooltip", { cue: this.armedBy }) : this.tooltip(state));
	}

	/** One send auto-armed web search because of `cue`: lit until it ends. */
	arm(cue: string): void {
		this.armedBy = cue;
		this.paint();
	}

	/** The send ended: back to the conversation's own state. */
	disarm(): void {
		if (this.armedBy === null) return;
		this.armedBy = null;
		this.paint();
	}

	/** Literal t() calls, so the dead-key check in tests/i18n.test.ts sees them. */
	private tooltip(state: ResearchState): string {
		switch (state) {
			case "on": return t("researchOnTooltip");
			case "noKey": return t("researchNoKeyTooltip");
			case "auto": return t("researchAutoTooltip");
			case "off": return t("researchOffTooltip");
		}
	}

	/** Toggle web search for the active conversation; persists, so the choice
	 *  survives reloads and device sync. Warns (but still toggles) when no
	 *  Tavily key is set, so the intent is remembered for when one is added. */
	private toggle(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		conv.researchMode = !conv.researchMode;
		this.paint();
		if (conv.researchMode && !this.d.plugin.webSearchService.hasApiKey()) {
			new Notice(t("researchNoKeyNotice"));
		} else {
			new Notice(conv.researchMode ? t("researchEnabledNotice") : t("researchDisabledNotice"));
		}
		void this.d.plugin.conversationStore.save(conv);
	}
}
