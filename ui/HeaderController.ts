import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t, getLang } from "../i18n";
import { abbreviateModel, MODEL_CATALOG } from "../models/knownModels";
import type { ModelInfo } from "../models/knownModels";
import { goodForModel } from "../models/modelGuidance";
import { ConversationSettingsModal } from "../suggest/ConversationSettingsModal";

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
 * engineering-review #120): the header row (history · name · rename · link ·
 * delete · [ctx chip] · model · new), the inline rename flow, the model badge +
 * anchored model popover, and the copy-deep-link action. `mount()` builds the
 * header; `renderHeader`/`updateModelBadge` refresh it; `getChipEl` exposes the
 * context chip other controllers need. Behaviour is identical to the inline
 * methods it replaced.
 */
export class HeaderController {
	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private deleteConvBtn!: HTMLButtonElement;
	private copyLinkBtn!: HTMLButtonElement;
	private renameBtn!: HTMLButtonElement;
	private renameWrapEl!: HTMLElement;
	private renameInputEl!: HTMLInputElement;
	private renameLLMBtn!: HTMLButtonElement;
	private ctxChipEl!: HTMLButtonElement;
	private modelPopoverCleanup: (() => void) | null = null;

	constructor(private readonly d: HeaderDeps) {}

	/** The context-budget percent chip (ContextInspectorController drives it). */
	getChipEl(): HTMLButtonElement { return this.ctxChipEl; }

	/** Close the model popover — view teardown/rebuild. */
	close(): void {
		this.modelPopoverCleanup?.();
	}

	mount(container: HTMLElement): void {
		const header = container.createDiv({ cls: "p-header" });

		// Header order, left → right (ADR-098): history · name (grows) · rename ·
		// link · delete · [ctx chip] · model · new. The name group takes the flex
		// space so the action cluster stays pinned to the right edge, and the "+"
		// new-conversation button is always the last child so its position never
		// shifts as other controls show/hide.

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
		// Plain, non-interactive text (ADR-107): the title used to open the quick
		// switcher on click; that surface was folded into the search panel above.
		const titleGroup = header.createDiv({ cls: "p-title-group" });

		this.convNameEl = titleGroup.createDiv({
			cls: "p-title",
			text: t("noConversation"),
		});

		this.renameWrapEl = titleGroup.createDiv({ cls: "p-rename-wrap" });
		this.renameWrapEl.style.display = "none";

		this.renameLLMBtn = this.renameWrapEl.createEl("button", {
			cls: "p-hdr-btn p-rename-refresh",
			attr: { title: t("renameLLMTooltip") },
		});
		setIcon(this.renameLLMBtn, "refresh-cw");
		this.d.registerDomEvent(this.renameLLMBtn, "mousedown", (e) => {
			e.preventDefault();
			void this.onRenameLLM();
		});

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

		// ── Right cluster: rename · link · delete · [ctx] · model · new ────────
		this.renameBtn = header.createEl("button", {
			cls: "p-hdr-btn p-rename-btn",
			attr: { title: t("renameConvTooltip") },
		});
		setIcon(this.renameBtn, "pencil");
		this.renameBtn.style.display = "none";
		this.d.registerDomEvent(this.renameBtn, "click", () => this.enterRenameMode());

		this.copyLinkBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("copyConvLinkTooltip") },
		});
		setIcon(this.copyLinkBtn, "link");
		this.copyLinkBtn.style.display = "none";
		this.d.registerDomEvent(this.copyLinkBtn, "click", () => this.onCopyConversationLink());

		this.deleteConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("deleteConvTooltip") },
		});
		setIcon(this.deleteConvBtn, "trash");
		this.deleteConvBtn.style.display = "none";
		this.d.registerDomEvent(this.deleteConvBtn, "click", () => this.d.handleDeleteConversation());

		// Context-budget warning chip (e.g. "94%"), shown only at >=80% usage.
		// Clicking it scrolls to the top and opens the context inspector.
		this.ctxChipEl = header.createEl("button", { cls: "p-ctx-chip" });
		this.ctxChipEl.style.display = "none";
		this.d.registerDomEvent(this.ctxChipEl, "click", () => this.d.revealContextInspector());

		this.modelBadgeEl = header.createEl("button", {
			cls: "p-model",
			text: "",
			attr: { title: t("changeModelTooltip") },
		});
		this.modelBadgeEl.style.display = "none";
		this.d.registerDomEvent(this.modelBadgeEl, "click", () => this.openModelPopover());

		// ── Far right: new conversation (always the last child) ────────────────
		const newConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("newConvTooltip") },
		});
		setIcon(newConvBtn, "plus");
		this.d.registerDomEvent(newConvBtn, "click", () => this.d.plugin.cmdNewConversation());

		// Template label is absolutely positioned (see styles.css), so it does not
		// participate in the header flex row and never displaces the "+" button.
		this.templateLabelEl = header.createDiv({ cls: "pythia-template-label" });
		this.templateLabelEl.style.display = "none";
	}

	renderHeader(): void {
		const conv = this.d.getConversation();
		if (!conv) {
			// Empty state: only history, the name, and "+" are shown (ADR-098).
			this.convNameEl.setText(t("noConversation"));
			this.templateLabelEl.setText("");
			this.templateLabelEl.style.display = "none";
			this.copyLinkBtn.style.display = "none";
			this.renameBtn.style.display = "none";
			this.deleteConvBtn.style.display = "none";
			return;
		}
		this.copyLinkBtn.style.display = "";
		this.renameBtn.style.display = "";
		this.deleteConvBtn.style.display = "";
		this.convNameEl.setText(conv.name);
		if (conv.templateId) {
			const tplName =
				conv.templateId
					.split("/")
					.pop()
					?.replace(/\.md$/, "") ?? "";
			this.templateLabelEl.setText(t("templateLabel", { name: tplName }));
			this.templateLabelEl.style.display = "";
		} else {
			this.templateLabelEl.setText("");
			this.templateLabelEl.style.display = "none";
		}
	}

	updateModelBadge(): void {
		const conv = this.d.getConversation();
		if (!conv) {
			this.modelBadgeEl.style.display = "none";
			return;
		}
		const model = conv.model ?? "";
		this.modelBadgeEl.setText(abbreviateModel(model));
		this.modelBadgeEl.style.display = "";
		this.d.updateSendHint();
		this.d.updateContextBar();
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

		const container = this.d.getContainer();
		const pop = container.createDiv({ cls: "p-model-pop" });
		// Absolute within the (position:relative) view root — robust against an
		// Obsidian ancestor that turns position:fixed into a clipped containing
		// block. Height is capped to the space below the chip with internal scroll.
		const cRect = container.getBoundingClientRect();
		const rect = this.modelBadgeEl.getBoundingClientRect();
		const width = 226;
		const top = rect.bottom - cRect.top + 4;
		let left = rect.right - cRect.left - width;
		left = Math.max(4, Math.min(left, cRect.width - width - 4));
		pop.style.position = "absolute";
		pop.style.top = `${top}px`;
		pop.style.left = `${left}px`;
		pop.style.width = `${width}px`;
		pop.style.maxHeight = `${Math.max(120, cRect.height - top - 8)}px`;
		this.modelBadgeEl.addClass("open");

		const onOutside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node) && e.target !== this.modelBadgeEl) closePop();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePop(); };
		const closePop = () => {
			pop.remove();
			this.modelBadgeEl.removeClass("open");
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("keydown", onKey, true);
			this.modelPopoverCleanup = null;
		};

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
		for (const p of providers) {
			const models = MODEL_CATALOG.filter((m) => m.provider === p.key && !m.hidden);
			if (!models.length) continue;
			pop.createDiv({ cls: "p-model-pop-group", text: p.label });
			for (const m of models) {
				const active = m.id === conv.model && m.provider === conv.provider;
				const row = pop.createDiv({ cls: "p-model-pop-row" });
				if (active) row.addClass("active");
				// Top line: name · reasoning tag · context window · active check.
				const line = row.createDiv({ cls: "p-model-pop-line" });
				line.createSpan({ cls: "p-model-pop-name", text: m.abbreviation });
				if (m.isReasoning || m.isMistralReasoning) {
					line.createSpan({ cls: "p-model-pop-rtag", text: t("reasoningTag") });
				}
				line.createSpan({ cls: "p-model-pop-ctx", text: this.fmtWindow(m.contextWindow) });
				if (active) setIcon(line.createSpan({ cls: "p-model-pop-check" }), "check");
				// "Good for" examples (smaller, hover- or tap-revealed) + touch confirm hint.
				const good = goodForModel(m.id, lang);
				if (good) row.createSpan({ cls: "p-model-pop-good", text: good });
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
					void this.applyModelChoice(m);
					closePop();
				});
			}
		}

		const footer = pop.createDiv({ cls: "p-model-pop-footer" });
		setIcon(footer.createSpan({ cls: "p-model-pop-footer-icon" }), "sliders");
		footer.createSpan({ text: t("openConvSettings") });
		footer.addEventListener("mousedown", (e) => {
			e.preventDefault(); e.stopPropagation();
			closePop();
			this.onModelBadgeClick();
		});

		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("keydown", onKey, true);
			this.modelPopoverCleanup = closePop;
		}, 0);
	}

	private async applyModelChoice(m: ModelInfo): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		conv.provider = m.provider;
		conv.model = m.id;
		await this.d.plugin.conversationStore.save(conv);
		this.updateModelBadge();
		this.d.refreshContextInspector();
	}

	onModelBadgeClick(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		new ConversationSettingsModal(
			this.d.plugin.app,
			conv,
			async (updated) => {
				await this.d.plugin.conversationStore.save(updated);
				this.updateModelBadge();
				this.d.refreshContextInspector();
			},
			this.d.plugin.settings.temperature,
			this.d.plugin.settings.effort,
			this.d.plugin.settings.maxTokens
		).open();
	}

	private enterRenameMode(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		this.convNameEl.style.display = "none";
		this.renameBtn.style.display = "none";
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
		this.renameBtn.style.display = conv ? "" : "none";
		if (confirm && conv) {
			const newName = this.renameInputEl.value.trim();
			if (newName && newName !== conv.name) {
				conv.name = newName;
				void this.d.plugin.conversationStore.save(conv);
				void this.d.plugin.renameConversationFile(conv);
				this.convNameEl.setText(newName);
			}
		}
	}

	private async onRenameLLM(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;

		this.renameLLMBtn.disabled = true;
		this.renameLLMBtn.addClass("p-rename-refresh-loading");

		try {
			const msgs = conv.messages;
			const userMsg   = msgs.find(m => m.role === "user")?.content     ?? "";
			const assistMsg = msgs.find(m => m.role === "assistant")?.content ?? "";
			const title = await this.d.plugin.llmRouter.generateConversationTitle(
				userMsg, assistMsg, conv.provider
			);
			// Fill the input with the generated name — user can still edit before confirming
			this.renameInputEl.value = title;
			this.renameInputEl.focus();
			this.renameInputEl.select();
		} catch {
			new Notice(t("renameLLMFailed"));
		} finally {
			this.renameLLMBtn.disabled = false;
			this.renameLLMBtn.removeClass("p-rename-refresh-loading");
		}
	}

	/** Copy an obsidian://pythia deep-link for the current conversation to the clipboard. */
	async onCopyConversationLink(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		const link = `obsidian://pythia?cmd=resume&id=${encodeURIComponent(conv.id)}`;
		await navigator.clipboard.writeText(link);
		// Brief visual feedback on the button
		setIcon(this.copyLinkBtn, "check");
		setTimeout(() => setIcon(this.copyLinkBtn, "link"), 1500);
		new Notice(t("convLinkCopied"));
	}
}
