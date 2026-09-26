import { Notice, setIcon, TFile } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Message } from "../models/types";
import { t, getObsidianLocale } from "../i18n";
import { estimateTokensFromText, omittedByResume, resolveLanguageLabel } from "../services/messageUtils";
import { buildSystemPrompt } from "../services/ContextBuilder";
import { getContextWindow } from "../models/knownModels";
import { NoteSuggestModal } from "../suggest/NoteSuggest";
import { noteBasename } from "../services/pathUtils";
import { buildAccordion } from "./accordion";
import { appendSourceIcon, SOURCE_ICONS } from "./icons";

export interface ContextInspectorDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	/** The inspector card wrapper (`p-inspector-wrap`), created by the view in
	 *  buildChatArea for DOM position. Null before the chat area is built. */
	getWrapEl(): HTMLElement | null;
	/** The context-budget bar and its fill, under the header. */
	getBarEl(): HTMLElement | null;
	getBarFillEl(): HTMLElement;
	/** The header percent chip shown at ≥80%. */
	getChipEl(): HTMLElement;
	/** The most recent message carrying token usage (drives "used" figures). */
	getLastTokenUsageMsg(): Message | undefined;
	scrollToTop(): void;
	/** Re-render the reference pills after a context note is added/removed here. */
	refreshReferencePills(): void;
	/** A note removed here may have been attached from the composer, where its
	 *  `[[link]]` is still sitting. Without this the composer sync re-attaches it
	 *  on the next keystroke and the removal silently undoes itself (ADR-211). */
	onContextNoteRemoved(path: string): void;
	/** Trigger a conversation summary (the budget-tight "Zusammenfassen" action). */
	onSummarize(): void;
}

/**
 * The context-budget surfaces extracted from `PythiaSidebarView` (ADR-103,
 * engineering-review #120): the thin budget bar + header percent chip
 * (`updateContextBar`) and the expandable inspector card (`fillContextInspector`
 * / `revealContextInspector`) that lists context notes as wikilinks or, when the
 * window is ≥80% full, a per-source budget breakdown with a summarize action.
 *
 * Constructed ONCE per view (not per buildUI) so `inspectorOpen` survives a
 * rebuild — the DOM handles are read through getters, so a long-lived controller
 * still sees the current elements. Behaviour is identical to the inline methods.
 */
export class ContextInspectorController {
	private inspectorOpen = false; // preserved across rebuilds within a session

	constructor(private readonly d: ContextInspectorDeps) {}

	/** Short token label like "~4.3k" / "~640". */
	private fmtTok(n: number): string {
		return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
	}

	/** Scroll to the top and expand the inspector — the click target of the
	 *  budget bar / percent chip (F3). */
	reveal(): void {
		this.d.scrollToTop();
		this.inspectorOpen = true;
		const wrap = this.d.getWrapEl();
		if (wrap) {
			this.refresh();
			wrap.querySelector(".p-inspector")?.scrollIntoView({ block: "nearest" });
		}
	}

	/** Build/refresh the context inspector card (F2/F3) inside the wrap element.
	 *  Normal mode lists context notes as wikilinks + a system-prompt estimate;
	 *  when the context window is ≥80% full it switches to a budget breakdown
	 *  with per-source mini-bars and a "Zusammenfassen" action. No-op when the
	 *  wrap element isn't mounted yet. */
	refresh(): void {
		const wrap = this.d.getWrapEl();
		if (!wrap) return;
		wrap.empty();
		const conv = this.d.getConversation();
		if (!conv) { wrap.style.display = "none"; return; }

		const notes = conv.contextNotes ?? [];
		const noteTok = notes.map((p) => {
			const f = this.d.plugin.app.vault.getAbstractFileByPath(p);
			const tokens = f instanceof TFile ? Math.round(f.stat.size / 4) : 0;
			return { path: p, tokens };
		});
		const noteTotal = noteTok.reduce((a, b) => a + b.tokens, 0);
		const sysTokens = estimateTokensFromText(
			buildSystemPrompt(conv, this.d.plugin.settings.customInstructions, {
				// The language directive is part of what is really sent, so the
				// inspector's token count has to include it (ADR-148).
				languageLabel: resolveLanguageLabel(
					conv.outputLanguage ?? this.d.plugin.settings.outputLanguage,
					getObsidianLocale()
				),
			})
		);
		const last = this.d.getLastTokenUsageMsg();
		const windowSize = getContextWindow(conv.model);
		const used = last?.tokenUsage
			? last.tokenUsage.inputTokens + last.tokenUsage.outputTokens
			: noteTotal + sysTokens;
		const frac = windowSize > 0 ? Math.min(1, used / windowSize) : 0;
		const budgetTight = frac >= 0.8;

		// Messages the resume mode leaves out — never silent (ADR-231, #256).
		const omitted = omittedByResume(conv);

		// Nothing worth a card: no context notes, full history, plenty of budget.
		if (notes.length === 0 && !budgetTight && omitted === 0) { wrap.style.display = "none"; return; }
		wrap.style.display = "";

		// ── The shared accordion (ADR-192): same box as the summary cards ──
		const shortK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
		const titleText = budgetTight
			? `${t("ctxLabel")} · ${shortK(used)} / ${shortK(windowSize)}`
			: `${t("ctxLabel")} · ${this.fmtTok(noteTotal + sysTokens)}`;
		const acc = buildAccordion(wrap, {
			cls: "p-inspector",
			icon: SOURCE_ICONS.note,
			title: titleText,
			open: this.inspectorOpen,
			onToggle: (open) => { this.inspectorOpen = open; },
		});
		const card = acc.root;
		if (budgetTight) {
			card.addClass("warn");
			acc.meta.createSpan({ cls: "p-inspector-pct", text: `${Math.round(frac * 100)}%` });
		}

		// ── Body ─────────────────────────────────────────────────────
		const body = acc.body;
		body.addClass("p-inspector-body");
		if (omitted > 0) {
			acc.meta.createSpan({ cls: "p-inspector-resume-chip", text: t("ctxResumeChip") });
			this.resumeRow(body, conv, omitted);
		}

		const miniBar = (row: HTMLElement, fraction: number, warn = false) => {
			const bar = row.createDiv({ cls: "p-ins-bar" });
			const fill = bar.createDiv({ cls: "p-ins-bar-fill" });
			fill.style.width = `${Math.min(100, fraction * 100).toFixed(1)}%`;
			if (warn) fill.addClass("warn");
		};
		const wikilinkRow = (parent: HTMLElement, path: string): HTMLElement => {
			const row = parent.createDiv({ cls: "p-inspector-row" });
			const ref = row.createSpan({ cls: "p-wikilink" });
			appendSourceIcon(ref, "note"); // the inspector lists attached notes only
			const name = ref.createEl("span", {
				cls: "p-wikilink-name",
				text: noteBasename(path),
				attr: { title: path },
			});
			name.addEventListener("click", async () => {
				const f = this.d.plugin.app.vault.getAbstractFileByPath(path);
				if (f instanceof TFile) await this.d.plugin.app.workspace.getLeaf(false).openFile(f);
				else new Notice(t("fileNotFound", { path }));
			});
			return row;
		};

		if (budgetTight) {
			// Conversation history row
			const histTokens = Math.max(0, used - noteTotal - sysTokens);
			const histRow = body.createDiv({ cls: "p-inspector-row" });
			histRow.createSpan({ cls: "p-inspector-rowlabel", text: t("ctxHistoryRow", { count: String(conv.messages.length) }) });
			miniBar(histRow, windowSize > 0 ? histTokens / windowSize : 0, true);
			histRow.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(histTokens) });

			for (const n of noteTok) {
				const row = wikilinkRow(body, n.path);
				miniBar(row, windowSize > 0 ? n.tokens / windowSize : 0);
				row.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(n.tokens) });
			}

			const sysRow = body.createDiv({ cls: "p-inspector-row" });
			sysRow.createSpan({ cls: "p-inspector-rowlabel", text: t("ctxSystemPrompt") });
			miniBar(sysRow, windowSize > 0 ? sysTokens / windowSize : 0);
			sysRow.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(sysTokens) });

			// Warning + Zusammenfassen
			const warnRow = body.createDiv({ cls: "p-inspector-warn" });
			setIcon(warnRow.createSpan({ cls: "p-inspector-warn-icon" }), "alert-triangle");
			const savings = Math.round(histTokens * 0.85);
			warnRow.createSpan({ cls: "p-inspector-warn-text", text: t("ctxNearFull", { n: this.fmtTok(savings) }) });
			const sumBtn = warnRow.createEl("button", { cls: "pb pb-secondary p-inspector-summarize", text: t("ctxSummarize") });
			sumBtn.addEventListener("click", (e) => { e.stopPropagation(); this.d.onSummarize(); });
		} else {
			for (const n of noteTok) {
				const row = wikilinkRow(body, n.path);
				row.createSpan({ cls: "p-wikilink-tokens", text: this.fmtTok(n.tokens) });
				const x = row.createEl("button", { cls: "pb pb-icon is-inline p-wikilink-x", text: "×" });
				x.addEventListener("click", async () => {
					conv.contextNotes = conv.contextNotes.filter((p) => p !== n.path);
					this.d.onContextNoteRemoved(n.path);
					await this.d.plugin.conversationStore.save(conv);
					this.d.refreshReferencePills();
				});
			}
			const footer = body.createDiv({ cls: "p-inspector-footer" });
			const addLink = footer.createSpan({ cls: "p-inspector-add", text: t("ctxAddNote") });
			addLink.addEventListener("click", () => {
				new NoteSuggestModal(this.d.plugin.app, (file) => {
					if (!conv.contextNotes.includes(file.path)) {
						conv.contextNotes.push(file.path);
						void this.d.plugin.conversationStore.save(conv);
						this.d.refreshReferencePills();
					}
				}).open();
			});
			footer.createSpan({ cls: "p-inspector-sys", text: t("ctxSystemPromptEst", { est: this.fmtTok(sysTokens) }) });
		}
	}

	/** What the resume mode leaves out, and the one way back (ADR-231). */
	private resumeRow(body: HTMLElement, conv: Conversation, omitted: number): void {
		const row = body.createDiv({ cls: "p-inspector-resume" });
		setIcon(row.createSpan({ cls: "p-inspector-warn-icon" }), "history");
		row.createSpan({
			cls: "p-inspector-warn-text",
			text: conv.resumeMode === "summary"
				? t("ctxResumeSummary", { count: String(omitted) })
				: t("ctxResumeHybrid", { count: String(omitted) }),
		});
		const btn = row.createEl("button", { cls: "pb pb-secondary p-inspector-summarize", text: t("ctxSendFullHistory") });
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await sendFullHistory(conv, this.d.plugin);
			new Notice(t("ctxFullHistoryOn"));
			this.refresh();
		});
	}

	/** Context-budget bar under the header: fill = (last-known context size) /
	 *  (model context window). Turns warning-colored and surfaces a header
	 *  percent chip at ≥80%. Hidden until a turn has produced token usage. */
	updateContextBar(): void {
		const barEl = this.d.getBarEl();
		if (!barEl) return;
		const chipEl = this.d.getChipEl();
		const conv = this.d.getConversation();
		const last = this.d.getLastTokenUsageMsg();
		if (!conv || !last?.tokenUsage) {
			barEl.style.display = "none";
			chipEl.style.display = "none";
			return;
		}
		const used = last.tokenUsage.inputTokens + last.tokenUsage.outputTokens;
		const windowSize = getContextWindow(conv.model);
		const frac = windowSize > 0 ? Math.min(1, used / windowSize) : 0;
		const pct = Math.round(frac * 100);
		const warn = frac >= 0.8;
		barEl.style.display = "";
		this.d.getBarFillEl().style.width = `${(frac * 100).toFixed(1)}%`;
		barEl.toggleClass("warn", warn);
		barEl.setAttr("title", t("ctxBarTooltip", {
			used: used.toLocaleString(),
			total: windowSize.toLocaleString(),
			pct: String(pct),
		}));
		if (warn) {
			chipEl.setText(`${pct}%`);
			chipEl.style.display = "";
		} else {
			chipEl.style.display = "none";
		}
	}
}

/** Back to the whole history: the resume mode and its boundary both go, so no
 *  later resume point is half-remembered (ADR-231). */
export async function sendFullHistory(conv: Conversation, plugin: Pick<PythiaPlugin, "conversationStore">): Promise<void> {
	conv.resumeMode = "full";
	delete conv.resumedAfterId;
	await plugin.conversationStore.save(conv);
}
