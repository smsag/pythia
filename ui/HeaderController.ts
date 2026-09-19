import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import type { EffortLevel, OutputLanguage } from "../models/types";
import { t, getLang, getObsidianLocale } from "../i18n";
import { resumeDeepLink } from "../utils";
import { debugLog } from "../services/messageUtils";
import { describeErrorForLog } from "../services/redact";
import { abbreviateModel, MODEL_CATALOG } from "../models/knownModels";
import type { ModelInfo } from "../models/knownModels";
import { goodForModel, profileLine } from "../models/modelGuidance";
import { DEFAULT_MAX_TOKENS_REASONING } from "../services/promptConstants";
import { ConversationSettingsModal } from "../suggest/ConversationSettingsModal";
import { attachOutsideDismiss } from "./outsideDismiss";
import { ActionSheet } from "./ActionSheet";
import { openChoicePicker, placeBelow, type ChoiceItem } from "./choicePicker";
import { resolveEffortState, resolveLanguageState } from "./instructionState";
import { languageOptions, languageOptionLabel } from "./languageOptions";

type DomEventRegistrar = (
	el: HTMLElement | Document | Window,
	type: string,
	callback: (ev: Event) => void,
	options?: boolean | AddEventListenerOptions,
) => void;

export interface HeaderDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	/** The view content pane (`containerEl.children[1]`) — the model popover mounts here. */
	getContainer(): HTMLElement;
	registerDomEvent: DomEventRegistrar;
	// History surface (HistoryController).
	openHistoryView(): void;
	handleDeleteConversation(): void;
	// Context inspector (ContextInspectorController).
	revealContextInspector(): void;
	updateContextBar(): void;
	refreshContextInspector(): void;
	// Send hint warning (Composer — still in the view).
	updateSendHint(): void;
}

/**
 * The header chrome extracted from `PythiaSidebarView` (ADR-103,
 * engineering-review #120): the header row (search · name · [ctx chip] ·
 * model | effort | language · menu · delete · new — ADR-165), the inline rename
 * flow, the model popover, the effort and language pickers, and the menu
 * (rename · copy link · conversation settings). `mount()` builds the header;
 * `renderHeader`/`updateInstructions` refresh it; `getChipEl` exposes the
 * context chip other controllers need.
 */
export class HeaderController {
	private convNameEl!: HTMLElement;
	private instEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private effortEl!: HTMLButtonElement;
	private langEl!: HTMLButtonElement;
	private menuBtn!: HTMLButtonElement;
	private deleteConvBtn!: HTMLButtonElement;
	private renameWrapEl!: HTMLElement;
	private renameInputEl!: HTMLInputElement;
	/** The conversation an AI rename is running for — one at a time. */
	private autoRenaming: Conversation | null = null;
	private ctxChipEl!: HTMLButtonElement;
	private modelPopoverCleanup: (() => void) | null = null;
	/** Close for the open effort/language picker or menu, if any. */
	private pickerCleanup: (() => void) | null = null;
	private sheet: ActionSheet | null = null;

	constructor(private readonly d: HeaderDeps) {}

	/** The context-budget percent chip (ContextInspectorController drives it). */
	getChipEl(): HTMLButtonElement { return this.ctxChipEl; }

	/** Close the model popover and any picker — view teardown/rebuild. */
	close(): void {
		this.modelPopoverCleanup?.();
		this.pickerCleanup?.();
		this.sheet?.close();
	}

	mount(container: HTMLElement): void {
		const header = container.createDiv({ cls: "p-header" });

		// Header order, left → right (ADR-165, revising ADR-098): search · name
		// (grows) · [ctx chip] · model | effort | language · menu · delete · new.
		// The name group takes the flex space so the cluster stays pinned to the
		// right edge, and "+" is always the last child so it never shifts.

		// ── Far left: conversation search ──────────────────────────────────────
		// The loupe opens the full conversation panel (browse + content search) with
		// its search input focused (ADR-107). It replaced the former history icon;
		// the panel is now the single conversation-search surface.
		const historyBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("historyTooltip") },
		});
		setIcon(historyBtn, "search");
		this.d.registerDomEvent(historyBtn, "click", () => this.d.openHistoryView());

		// ── Conversation name (grows; hosts the inline rename input) ───────────
		// Plain, non-interactive text (ADR-107); rename is reached from the menu.
		const titleGroup = header.createDiv({ cls: "p-title-group" });

		this.convNameEl = titleGroup.createDiv({
			cls: "p-title",
			text: t("noConversation"),
		});

		this.renameWrapEl = titleGroup.createDiv({ cls: "p-rename-wrap" });
		this.renameWrapEl.style.display = "none";

		this.renameInputEl = this.renameWrapEl.createEl("input", {
			cls: "p-rename-input",
			attr: { type: "text", placeholder: t("renameConvPlaceholder") },
		});
		this.d.registerDomEvent(this.renameInputEl, "keydown", (e) => {
			const ev = e as KeyboardEvent;
			if (ev.key === "Enter") { ev.preventDefault(); this.exitRename(true); }
			if (ev.key === "Escape") { ev.preventDefault(); this.exitRename(false); }
		});
		this.d.registerDomEvent(this.renameInputEl, "blur", () => this.exitRename(true));

		// Context-budget warning chip (e.g. "94%"), shown only at >=80% usage.
		// Clicking it scrolls to the top and opens the context inspector.
		this.ctxChipEl = header.createEl("button", { cls: "p-ctx-chip" });
		this.ctxChipEl.style.display = "none";
		this.d.registerDomEvent(this.ctxChipEl, "click", () => this.d.revealContextInspector());

		// ── Instructions: model | effort | language (ADR-165) ──────────────────
		// What every answer is sent with, readable and changeable in one tap each.
		this.instEl = header.createDiv({ cls: "p-inst", attr: { role: "group" } });
		this.instEl.style.display = "none";

		this.modelBadgeEl = this.instEl.createEl("button", {
			cls: "p-inst-seg p-inst-model",
			attr: { title: t("changeModelTooltip") },
		});
		this.d.registerDomEvent(this.modelBadgeEl, "click", () => this.openModelPopover());

		this.effortEl = this.instEl.createEl("button", { cls: "p-inst-seg p-inst-effort" });
		this.d.registerDomEvent(this.effortEl, "click", () => this.openEffortPicker());

		this.langEl = this.instEl.createEl("button", { cls: "p-inst-seg p-inst-lang" });
		this.d.registerDomEvent(this.langEl, "click", () => this.openLanguagePicker());

		// ── Menu: rename · copy link · conversation settings ───────────────────
		this.menuBtn = header.createEl("button", {
			cls: "p-hdr-btn p-hdr-menu",
			attr: { title: t("convMenuTooltip") },
		});
		setIcon(this.menuBtn, "chevron-down");
		this.menuBtn.style.display = "none";
		this.d.registerDomEvent(this.menuBtn, "click", () => this.openMenu());

		this.deleteConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("deleteConvTooltip") },
		});
		setIcon(this.deleteConvBtn, "trash");
		this.deleteConvBtn.style.display = "none";
		this.d.registerDomEvent(this.deleteConvBtn, "click", () => this.d.handleDeleteConversation());

		// ── Far right: new conversation (always the last child) ────────────────
		const newConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("newConvTooltip") },
		});
		setIcon(newConvBtn, "plus");
		this.d.registerDomEvent(newConvBtn, "click", () => this.d.plugin.cmdNewConversation());
	}

	renderHeader(): void {
		const conv = this.d.getConversation();
		if (!conv) {
			// Empty state: only search, the name, and "+" are shown (ADR-098).
			this.convNameEl.setText(t("noConversation"));
			this.menuBtn.style.display = "none";
			this.deleteConvBtn.style.display = "none";
			return;
		}
		this.menuBtn.style.display = "";
		this.deleteConvBtn.style.display = "";
		this.convNameEl.setText(conv.name);
	}

	/** Paint model | effort | language from the conversation and the settings
	 *  (ADR-165). Call after anything that can change what a send is sent with. */
	updateInstructions(): void {
		const conv = this.d.getConversation();
		if (!conv) {
			this.instEl.style.display = "none";
			return;
		}
		const settings = this.d.plugin.settings;
		this.modelBadgeEl.setText(abbreviateModel(conv.model ?? ""));

		const effort = resolveEffortState(conv, settings.effort);
		const effortText = effort.supported ? this.effortLabel(effort.level) : "—";
		this.effortEl.setText(effortText);
		this.effortEl.toggleClass("is-pinned", effort.pinned);
		this.effortEl.toggleClass("is-off", !effort.supported);
		this.effortEl.setAttr("title", !effort.supported
			? t("effortUnsupportedNotice", { model: abbreviateModel(conv.model) })
			: effort.pinned
				? t("effortSegPinnedTooltip", { v: effortText })
				: t("effortSegDefaultTooltip", { v: effortText }));

		const lang = resolveLanguageState(conv.outputLanguage, settings.outputLanguage, getObsidianLocale());
		this.langEl.setText(lang.code);
		this.langEl.toggleClass("is-pinned", lang.pinned);
		const langName = languageOptionLabel(lang.setting);
		this.langEl.setAttr("title", lang.pinned
			? t("langSegPinnedTooltip", { v: langName })
			: t("langSegDefaultTooltip", { v: langName }));

		this.instEl.style.display = "";
		this.d.updateSendHint();
		this.d.updateContextBar();
	}

	private effortLabel(level: EffortLevel | null): string {
		if (level === "low") return t("effortLevelLow");
		if (level === "medium") return t("effortLevelMedium");
		if (level === "high") return t("effortLevelHigh");
		return t("effortSegmentDefault");
	}

	private sheetFor(): ActionSheet {
		return (this.sheet ??= new ActionSheet(this.d.getContainer()));
	}

	/** Open one picker at a time; a second tap on the same control closes it. */
	private togglePicker(anchor: HTMLElement, title: string, items: ChoiceItem[]): void {
		const wasOpen = anchor.hasClass("open");
		this.pickerCleanup?.();
		this.pickerCleanup = null;
		this.modelPopoverCleanup?.();
		if (wasOpen) return;
		const close = openChoicePicker({
			container: this.d.getContainer(), anchor, title, items, sheet: this.sheetFor(),
		});
		this.pickerCleanup = () => { close(); this.pickerCleanup = null; };
	}

	private async saveInstructions(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		// Paint before the save: the segment must show the choice at the tap (ADR-155).
		this.updateInstructions();
		this.d.refreshContextInspector();
		await this.d.plugin.conversationStore.save(conv);
	}

	private openEffortPicker(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const effort = resolveEffortState(conv, this.d.plugin.settings.effort);
		if (!effort.supported) {
			new Notice(t("effortUnsupportedNotice", { model: abbreviateModel(conv.model) }));
			return;
		}
		const globalEffort = this.d.plugin.settings.effort;
		const choose = (value: EffortLevel | undefined) => () => {
			// "Default" stores undefined, never today's default (principle 6).
			conv.effort = value;
			void this.saveInstructions();
		};
		const items: ChoiceItem[] = [
			{
				label: globalEffort
					? t("effortSegmentDefaultWith", { v: this.effortLabel(globalEffort) })
					: t("effortSegmentDefault"),
				detail: t("pickerFollowsSettings"),
				icon: "", active: conv.effort === undefined, onSelect: choose(undefined),
			},
			{ label: t("effortLevelLow"), detail: t("effortPickLowDetail"), icon: "", active: conv.effort === "low", onSelect: choose("low") },
			{ label: t("effortLevelMedium"), detail: t("effortPickMediumDetail"), icon: "", active: conv.effort === "medium", onSelect: choose("medium") },
			{ label: t("effortLevelHigh"), detail: t("effortPickHighDetail"), icon: "", active: conv.effort === "high", onSelect: choose("high") },
		];
		this.togglePicker(this.effortEl, t("convEffortLabel"), items);
	}

	private openLanguagePicker(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const globalLanguage = this.d.plugin.settings.outputLanguage;
		const choose = (value: OutputLanguage | undefined) => () => {
			const before = resolveLanguageState(conv.outputLanguage, globalLanguage, getObsidianLocale()).code;
			conv.outputLanguage = value;
			const after = resolveLanguageState(value, globalLanguage, getObsidianLocale()).code;
			// Existing answers stay as written — say so at the moment it matters.
			if (before !== after && conv.messages.length > 0) new Notice(t("langChangedNotice"));
			void this.saveInstructions();
		};
		const obsidianCode = resolveLanguageState("obsidian", globalLanguage, getObsidianLocale()).code;
		const detailFor = (value: OutputLanguage): string | undefined =>
			value === "auto" ? t("langPickAutoDetail")
				: value === "obsidian" ? t("langPickObsidianDetail", { code: obsidianCode })
					: undefined;
		const items: ChoiceItem[] = [
			{
				label: t("convLanguageDefault", { v: languageOptionLabel(globalLanguage) }),
				detail: t("pickerFollowsSettings"),
				icon: "", active: conv.outputLanguage === undefined, onSelect: choose(undefined),
			},
			...languageOptions().map(([value, label]): ChoiceItem => ({
				label, detail: detailFor(value), icon: "",
				active: conv.outputLanguage === value, onSelect: choose(value),
			})),
		];
		this.togglePicker(this.langEl, t("convLanguageLabel"), items);
	}

	private openMenu(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		// ↻ only when there is something to name — an empty conversation has no digest.
		const canRetitle = conv.messages.length > 0;
		this.togglePicker(this.menuBtn, "", [
			{
				label: t("renameConvTooltip"), icon: "pencil", onSelect: () => this.enterRenameMode(),
				trailing: canRetitle
					? { icon: "refresh-cw", label: t("renameLLMTooltip"), onSelect: () => void this.onRenameLLM() }
					: undefined,
			},
			{ label: t("copyConvLinkTooltip"), icon: "link", onSelect: () => void this.onCopyConversationLink() },
			{ label: t("openConvSettings"), icon: "sliders", onSelect: () => this.openConversationSettings() },
		]);
	}

	/** Update just the title text (e.g. after an auto-generated title). */
	setConvName(name: string): void {
		this.convNameEl.setText(name);
	}

	/** Format a context window as "1M" / "200k" / "128k". */
	private fmtWindow(n: number): string {
		if (n >= 1_000_000) {
			const m = n / 1_000_000;
			return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
		}
		return `${Math.round(n / 1000)}k`;
	}

	/** Anchored model popover (F7): provider groups with context-window labels,
	 *  Reasoning tags, an active check, and a footer that opens the full
	 *  conversation-settings modal. Selecting a model applies it immediately. */
	private openModelPopover(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		if (this.modelPopoverCleanup) { this.modelPopoverCleanup(); return; } // toggle
		this.pickerCleanup?.();

		const container = this.d.getContainer();
		const pop = container.createDiv({ cls: "p-model-pop" });
		// Widen with the panel (phones and wide sidebars): 226 px was cramped for
		// "GPT-4.1 nano" + Reasoning chip + context column on a phone.
		const width = Math.round(Math.min(300, Math.max(226, container.getBoundingClientRect().width - 24)));
		placeBelow(container, this.instEl, pop, width);
		this.modelBadgeEl.addClass("open");

		const closePop = () => {
			pop.remove();
			this.modelBadgeEl.removeClass("open");
			detachOutside();
			this.modelPopoverCleanup = null;
		};
		const detachOutside = attachOutsideDismiss(
			(target) => pop.contains(target) || target === this.modelBadgeEl,
			closePop,
			{ escape: true },
		);
		// Set now, not after the deferred listener registration: a `close()` from a
		// view rebuild in the same tick must find something to call.
		this.modelPopoverCleanup = closePop;

		// Touch (no hover): first tap on a row reveals its "good for" examples and
		// arms it; a second tap on the same row confirms. Desktop reveals on hover
		// and selects on the first click (armId stays null).
		const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
		const lang = getLang();
		let armedId: string | null = null;

		const providers: { key: typeof conv.provider; label: string }[] = [
			{ key: "anthropic", label: "ANTHROPIC" },
			{ key: "openai", label: "OPENAI" },
			{ key: "mistral", label: "MISTRAL" },
		];
		// Selecting a model repaints the list instead of closing it: the popover is a
		// panel, not a one-shot menu, so a model switch followed by a trip to
		// conversation settings (its footer) no longer needs a reopen. Every row owns
		// a check element from the start so the repaint only toggles visibility.
		const rows: { m: ModelInfo; row: HTMLElement; check: HTMLElement }[] = [];
		const paintActive = (): void => {
			const current = this.d.getConversation();
			for (const r of rows) {
				const on = !!current && r.m.id === current.model && r.m.provider === current.provider;
				r.row.toggleClass("active", on);
				r.check.style.display = on ? "" : "none";
			}
		};
		for (const p of providers) {
			const models = MODEL_CATALOG.filter((m) => m.provider === p.key && !m.hidden);
			if (!models.length) continue;
			pop.createDiv({ cls: "p-model-pop-group", text: p.label });
			for (const m of models) {
				const row = pop.createDiv({ cls: "p-model-pop-row" });
				// Top line: name · reasoning tag · context window · active check.
				const line = row.createDiv({ cls: "p-model-pop-line" });
				line.createSpan({ cls: "p-model-pop-name", text: m.abbreviation });
				if (m.isReasoning || m.isMistralReasoning) {
					line.createSpan({ cls: "p-model-pop-rtag", text: t("reasoningTag") });
				}
				line.createSpan({ cls: "p-model-pop-ctx", text: this.fmtWindow(m.contextWindow) });
				const check = line.createSpan({ cls: "p-model-pop-check" });
				setIcon(check, "check");
				rows.push({ m, row, check });
				// "Good for" examples (smaller, hover- or tap-revealed) + touch confirm hint.
				const good = goodForModel(m.id, lang);
				if (good) row.createSpan({ cls: "p-model-pop-good", text: good });
				// Speed · depth · cost, and the one fact a reasoning tag does not
				// say: it needs a bigger token budget (ADR-162).
				const profile = profileLine(m.id, lang);
				if (profile) row.createSpan({ cls: "p-model-pop-good p-model-pop-profile", text: profile });
				if (m.isReasoning || m.isMistralReasoning) {
					row.createSpan({ cls: "p-model-pop-good", text: t("reasoningNeedsBudget", { recommended: String(DEFAULT_MAX_TOKENS_REASONING) }) });
				}
				row.createSpan({ cls: "p-model-pop-taphint", text: t("tapAgainToSelect") });
				row.addEventListener("mousedown", (e) => {
					e.preventDefault(); e.stopPropagation();
					if (coarse && armedId !== m.id) {
						// First tap: reveal the explainer and wait for a confirming tap.
						armedId = m.id;
						pop.querySelectorAll(".p-model-pop-row.armed")
							.forEach((r) => r.classList.remove("armed"));
						row.addClass("armed");
						return;
					}
					// Confirmed: drop the armed state so the row stops showing the
					// touch hint and a later tap re-arms rather than re-applying.
					armedId = null;
					pop.querySelectorAll(".p-model-pop-row.armed")
						.forEach((r) => r.classList.remove("armed"));
					// `applyModelChoice` sets the conversation's provider/model before
					// its first await, so the repaint below already sees the new value;
					// only the store write is deferred.
					void this.applyModelChoice(m);
					paintActive();
				});
			}
		}
		paintActive();

		const footer = pop.createDiv({ cls: "p-model-pop-footer" });
		setIcon(footer.createSpan({ cls: "p-model-pop-footer-icon" }), "sliders");
		footer.createSpan({ text: t("openConvSettings") });
		footer.addEventListener("mousedown", (e) => {
			e.preventDefault(); e.stopPropagation();
			closePop();
			this.openConversationSettings();
		});

	}

	private async applyModelChoice(m: ModelInfo): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		conv.provider = m.provider;
		conv.model = m.id;
		// Say so now, not at the next send: the switch is allowed (the key may be
		// added in a moment), but a send that fails with "key not configured" after
		// the model badge changed reads as a bug.
		if (!this.d.plugin.hasApiKeyFor(m.provider)) new Notice(t("modelNoKeyNotice", { provider: m.provider }));
		await this.d.plugin.conversationStore.save(conv);
		this.updateInstructions();
		this.d.refreshContextInspector();
	}

	openConversationSettings(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		new ConversationSettingsModal(
			this.d.plugin.app,
			conv,
			async (updated) => {
				await this.d.plugin.conversationStore.save(updated);
				this.updateInstructions();
				this.d.refreshContextInspector();
			},
			this.d.plugin.settings.temperature,
			this.d.plugin.settings.effort,
			this.d.plugin.settings.maxTokens,
			this.d.plugin.settings.outputLanguage
		).open();
	}

	private enterRenameMode(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		this.convNameEl.style.display = "none";
		this.renameWrapEl.style.display = "";
		this.renameInputEl.value = conv.name;
		requestAnimationFrame(() => {
			this.renameInputEl.focus();
			this.renameInputEl.select();
		});
	}

	exitRename(confirm: boolean): void {
		if (this.renameWrapEl.style.display === "none") return;
		this.renameWrapEl.style.display = "none";
		this.convNameEl.style.display = "";
		const conv = this.d.getConversation();
		if (confirm && conv) {
			const newName = this.renameInputEl.value.trim();
			if (newName && newName !== conv.name) {
				void this.d.plugin.renameConversation(conv, newName);
				this.convNameEl.setText(newName);
			}
		}
	}

	/**
	 * The menu row's ↻: rename with AI in one tap, without opening the editor.
	 * The current name pulses until the new one replaces it; only a failure or an
	 * empty reply says anything (ADR-158). The conversation is captured, so a
	 * switch mid-call renames the right one and leaves the header alone.
	 */
	private async onRenameLLM(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || this.autoRenaming) return;
		this.autoRenaming = conv;
		this.convNameEl.addClass("is-generating");
		try {
			const title = await this.d.plugin.llmRouter.retitleConversation(conv);
			if (!title) { new Notice(t("renameLLMEmpty")); return; }
			if (title !== conv.name) await this.d.plugin.renameConversation(conv, title);
			if (this.d.getConversation()?.id === conv.id) this.convNameEl.setText(conv.name);
		} catch (e) {
			debugLog(this.d.plugin.settings, "retitle failed", describeErrorForLog(e));
			new Notice(t("renameLLMFailed"));
		} finally {
			this.autoRenaming = null;
			this.convNameEl.removeClass("is-generating");
		}
	}

	/** Copy an obsidian://pythia deep-link for the current conversation to the clipboard. */
	async onCopyConversationLink(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		const link = resumeDeepLink(conv.id, this.d.plugin.app.vault.getName());
		try {
			await navigator.clipboard.writeText(link);
		} catch {
			// Clipboard access is denied in some webviews and when the window is
			// not focused; an unhandled rejection here told the user nothing.
			new Notice(t("copyFailed"));
			return;
		}
		new Notice(t("convLinkCopied"));
	}
}
