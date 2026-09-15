import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import type { GlossaryEntry } from "../services/glossary";
import { t } from "../i18n";
import { formatSummaryTimestamp } from "../services/messageUtils";
import { abbreviateModel } from "../models/knownModels";
import { repaintTerms } from "./HighlightPainter";

export interface GlossaryDeps {
	plugin: PythiaPlugin;
	/** The conversation the lookup was triggered from — supplies its language
	 *  override, so a definition is written in the language that conversation
	 *  answers in (ADR-148). */
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
}

/**
 * Glossary terms in the message body (ADR-136).
 *
 * The third mark-and-anchor surface, after fork origins and merge links, but
 * built on a different principle: fork and merge marks are anchored to a stored
 * span in one message, whereas a term is marked at *every* occurrence in *every*
 * conversation. The glossary note is the only source of truth; nothing about a
 * term is stored on the conversation.
 *
 * That is what makes it compound. Look a term up once and it is explained
 * wherever it appears again, including in conversations that do not exist yet.
 */
export class GlossaryController {
	private openAnchor: HTMLElement | null = null;

	constructor(private readonly d: GlossaryDeps) {}

	/** Close the inline anchor — teardown and pre-rebuild. */
	closeAnchor(): void {
		this.openAnchor?.remove();
		this.openAnchor = null;
	}

	/**
	 * Mark known terms in one rendered message body.
	 *
	 * Async because the glossary note is read from the vault on first use. The
	 * body is re-checked for liveness afterwards: a conversation switch can detach
	 * it while the read is in flight, and painting a detached node is wasted work.
	 */
	async repaint(body: HTMLElement): Promise<void> {
		const service = this.d.plugin.glossaryService;
		if (!service) return;
		const entries = await service.all();
		if (!body.isConnected) return;
		repaintTerms(body, service.indexFor(entries));
	}

	/**
	 * Define the selected term and mark it everywhere.
	 *
	 * `passage` is the surrounding message text, which is what lets the model
	 * explain the sense that applies here rather than every possible meaning.
	 */
	async defineSelection(term: string, passage: string): Promise<void> {
		const entry = await this.d.plugin.glossaryService.lookup(term, passage, false, this.d.getConversation() ?? undefined);
		if (!entry) return;
		// Every message can contain the new term, so the whole transcript is
		// repainted rather than just the message the selection came from.
		this.repaintAll();
		new Notice(t("glossaryDefined", { term: entry.term }));
	}

	/** Repaint every rendered answer. A term is known globally, so adding or
	 *  removing one changes the whole transcript, not just one message. */
	repaintAll(): void {
		this.d.getMessagesEl().querySelectorAll<HTMLElement>(".p-ai-body")
			.forEach((body) => void this.repaint(body));
	}

	/** Toggle the inline definition for a marked term. */
	async toggleAnchor(term: string, markEl: HTMLElement): Promise<void> {
		if (this.openAnchor?.getAttribute("data-term") === term) {
			this.closeAnchor();
			return;
		}
		this.closeAnchor();

		const service = this.d.plugin.glossaryService;
		const found = service.find(await service.all(), term);
		if (!found) return;
		// `all()` carries frontmatter only — the definition lives in the note body
		// and is read for the one term actually being opened (ADR-150).
		const entry = await service.hydrate(found);

		// Insert after the mark's own paragraph rather than inline beside it: a term
		// sits mid-sentence, and splicing a block into a sentence reflows the text
		// around it. Fork and merge anchors can attach directly because their marks
		// are deliberate, often sentence-length selections.
		const block = markEl.closest("p, li, td, th, div") ?? markEl;
		const anchor = createDiv({ cls: "p-term-anchor", attr: { "data-term": term } });
		block.after(anchor);
		this.openAnchor = anchor;
		this.build(anchor, entry, markEl);
	}

	private build(anchor: HTMLElement, entry: GlossaryEntry, markEl: HTMLElement): void {
		anchor.empty();

		const head = anchor.createDiv({ cls: "p-term-anchor-head" });
		setIcon(head.createSpan({ cls: "p-term-anchor-icon" }), "book-open");
		head.createSpan({ cls: "p-term-anchor-label", text: t("glossaryAnchorLabel") });

		anchor.createDiv({ cls: "p-term-anchor-title", text: entry.term });

		// The other forms this entry answers for. Shown because a mark on "Zählern"
		// opening an entry titled "Zähler" otherwise looks like a mismatch, and
		// because seeing the list is what tells the user a wrong one is editable.
		if (entry.aliases?.length) {
			anchor.createDiv({
				cls: "p-term-anchor-aliases",
				text: t("glossaryAliases", { list: entry.aliases.join(" · ") }),
			});
		}

		const body = anchor.createDiv({ cls: "p-term-anchor-body" });
		this.d.renderMarkdown(entry.definition, body);

		const meta = anchor.createDiv({ cls: "p-term-anchor-meta" });
		// Bare model name and date, exactly like the fork and merge meta lines —
		// no "defined by" prefix. The row's job is provenance at a glance, and the
		// prefix is the one part of it the reader already knows.
		const parts: string[] = [
			entry.source === "model"
				// Entries written before the model was recorded fall back to the old
				// (often wrong) guess rather than showing nothing.
				? abbreviateModel(entry.model ?? this.d.plugin.settings.defaultAnthropicModel)
				: t("glossarySourceManual"),
		];
		if (entry.updatedAt) parts.push(formatSummaryTimestamp(entry.updatedAt));
		meta.createSpan({ cls: "p-term-anchor-metatext", text: `${parts.join(" · ")} · ` });

		const regen = meta.createEl("button", {
			cls: "p-term-anchor-btn",
			attr: { "aria-label": t("glossaryRegenerate"), title: t("glossaryRegenerate") },
		});
		setIcon(regen, "rotate-cw");
		regen.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.regenerate(anchor, entry.term, markEl);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		const remove = meta.createEl("button", {
			cls: "p-term-anchor-btn",
			attr: { "aria-label": t("glossaryRemove"), title: t("glossaryRemove") },
		});
		setIcon(remove, "trash");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.forget(entry.term);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		// Same short label and arrow as the fork and merge anchors — "Im Glossar
		// öffnen" is long enough to wrap the meta row onto a second line. The
		// specific wording survives as the tooltip.
		const open = meta.createEl("button", {
			cls: "p-term-anchor-open",
			text: t("forkOpenShort"),
			attr: { "aria-label": t("glossaryOpenNote"), title: t("glossaryOpenNote") },
		});
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			// Open the term's own note now that each term is one (ADR-150).
			void this.d.plugin.app.workspace.openLinkText(entry.term, "", true);
		});
	}

	private async regenerate(anchor: HTMLElement, term: string, markEl: HTMLElement): Promise<void> {
		const passage = markEl.closest("[data-msg-id]")?.textContent ?? "";
		const entry = await this.d.plugin.glossaryService.lookup(term, passage, true, this.d.getConversation() ?? undefined);
		if (entry && this.openAnchor === anchor) this.build(anchor, entry, markEl);
	}

	private async forget(term: string): Promise<void> {
		await this.d.plugin.glossaryService.remove(term);
		this.closeAnchor();
		// The term is no longer known, so its marks must go everywhere at once.
		this.repaintAll();
	}
}
