import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import type { GlossaryEntry } from "../services/glossary";
import { t, getObsidianLocale } from "../i18n";
import { formatSummaryTimestamp } from "../services/messageUtils";
import { definitionLanguageOf, displayLanguage, needsTranslation } from "../services/glossaryNotes";
import { resolveLanguageState } from "./instructionState";
import { abbreviateModel } from "../models/knownModels";
import { repaintTerms } from "./HighlightPainter";
import { termForkOpeningPrompt } from "../services/glossaryPrompts";
import { REGENERATE_ICON } from "./icons";

export interface GlossaryDeps {
	plugin: PythiaPlugin;
	/** The conversation the lookup was triggered from — supplies its language
	 *  override, so a definition is written in the language that conversation
	 *  answers in (ADR-148). */
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
	/** Switch the view to a conversation this controller just created (ADR-208). */
	openConversation(conv: Conversation): Promise<void>;
	/** Put a ready question in the composer, unsent (ADR-208). */
	prefillInput(text: string): void;
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
	/** Bumped per toggle so a second tap during the async lookup below does not
	 *  leave two anchors open. */
	private openGeneration = 0;
	/** A translation recorded a new surface form while an anchor was open
	 *  (ADR-206), so the transcript owes a repaint once it closes. */
	private formRecorded = false;

	constructor(private readonly d: GlossaryDeps) {}

	/** Close the inline anchor — teardown and pre-rebuild. */
	closeAnchor(): void {
		this.close(true);
	}

	/**
	 * `repaint` is false only when another anchor is about to open: repainting
	 * unwraps every mark, including the one the caller still holds a reference to
	 * and is about to insert after, which would leave the new anchor on a detached
	 * node. The pending repaint is not lost — it is taken by the next real close.
	 */
	private close(repaint: boolean): void {
		this.openAnchor?.remove();
		this.openAnchor = null;
		if (repaint) this.flushRepaint();
	}

	/** Draw the marks a newly recorded surface form earned, if one is owed. */
	private flushRepaint(): void {
		if (!this.formRecorded) return;
		this.formRecorded = false;
		this.repaintAll();
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

	/**
	 * Describe the selected person and mark them everywhere (ADR-151).
	 *
	 * The same shape as `defineSelection` because it is the same feature with a
	 * different resolver: vault note first, model second, one entry, marked in
	 * every conversation from then on.
	 */
	async describePerson(name: string, passage: string): Promise<void> {
		const entry = await this.d.plugin.glossaryService.lookupPerson(
			name, passage, false, this.d.getConversation() ?? undefined
		);
		if (!entry) return;
		this.repaintAll();
		new Notice(t("personDefined", { name: entry.term }));
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
		this.close(false); // `markEl` must survive until the new anchor hangs off it
		const generation = ++this.openGeneration;

		const service = this.d.plugin.glossaryService;
		const found = service.find(await service.all(), term);
		if (!found) return;
		// `all()` carries frontmatter only — the definition lives in the note body
		// and is read for the one term actually being opened (ADR-150).
		const entry = await service.hydrate(found);
		if (generation !== this.openGeneration || !markEl.isConnected) return; // superseded

		const isPerson = entry.kind === "person";
		const anchor = createDiv({
			// One class, one set of rules: a person anchor IS a term anchor, with a
			// modifier that changes only the left rule's stroke (ADR-142's lesson —
			// restating a rule for a near-twin is how the two drift apart).
			cls: isPerson ? "p-term-anchor p-term-anchor--person" : "p-term-anchor",
			attr: { "data-term": term },
		});
		// Immediately after the tapped mark, exactly like the fork and merge anchors
		// (ADR-156).
		//
		// This used to insert after the mark's whole *paragraph*, reasoning that a
		// term sits mid-sentence and a block spliced into one reflows the text
		// around it. The reflow is real and it is the price: the paragraph breaks at
		// the word. But fork and merge pay it too, and what the paragraph version
		// cost was worse — in a long paragraph the definition arrived far below the
		// word that opened it, so the reader had to find the connection the anchor
		// exists to make. Proximity is the whole point of an inline anchor; a card
		// at the end of a paragraph is a footnote, and this surface already has one
		// of those. A term also repeats, which makes distance worse rather than
		// better: several marked words in one paragraph would all open their card in
		// the same place.
		markEl.after(anchor);
		this.openAnchor = anchor;
		// Read before the anchor adds its own text to the message (ADR-166).
		const passage = markEl.closest("[data-msg-id]")?.textContent ?? "";
		const target = this.displayLanguage(passage);
		if (target) anchor.setAttr("data-lang", target);
		await this.show(anchor, entry, markEl);
	}

	/** The language this conversation's anchors show definitions in (ADR-166). */
	private displayLanguage(passage: string): string | null {
		const settings = this.d.plugin.settings;
		const conv = this.d.getConversation();
		const state = resolveLanguageState(conv?.outputLanguage, settings.outputLanguage ?? "auto", getObsidianLocale());
		return displayLanguage(state, passage);
	}

	/**
	 * Render `entry` in the anchor's language: the stored definition when it
	 * already is in that language, the cached translation when there is one, and
	 * otherwise a placeholder that the translation replaces. The stored text is
	 * never shown first and then swapped — reading a sentence that changes
	 * language under you is worse than a moment's wait.
	 */
	private async show(anchor: HTMLElement, entry: GlossaryEntry, markEl: HTMLElement): Promise<void> {
		const target = anchor.getAttribute("data-lang");
		if (!needsTranslation(entry, target)) { this.build(anchor, entry, markEl); return; }
		const from = definitionLanguageOf(entry);
		this.build(anchor, entry, markEl, { pending: target });
		const result = await this.d.plugin.glossaryService.translate(entry, target);
		// Owed even if the anchor has since closed — the form is in the note either
		// way. With nothing open there is no mark to protect, so it is paid now.
		if (result?.form) {
			this.formRecorded = true;
			if (!this.openAnchor) this.flushRepaint();
		}
		if (this.openAnchor !== anchor) return; // closed or replaced meanwhile
		this.build(anchor, entry, markEl, result ? { text: result.text, from } : undefined);
	}

	private build(
		anchor: HTMLElement,
		entry: GlossaryEntry,
		markEl: HTMLElement,
		/** A translation to show instead of the stored definition, or the language one is pending in. */
		shown?: { text: string; from: string | null } | { pending: string },
	): void {
		anchor.empty();

		const head = anchor.createDiv({ cls: "p-term-anchor-head" });
		const isPerson = entry.kind === "person";
		setIcon(head.createSpan({ cls: "p-term-anchor-icon" }), isPerson ? "user" : "book-open");
		head.createSpan({
			cls: "p-term-anchor-label",
			text: isPerson ? t("personAnchorLabel") : t("glossaryAnchorLabel"),
		});

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
		if (shown && "pending" in shown) {
			body.addClass("is-pending");
			body.setText(t("glossaryTranslating", { code: shown.pending.toUpperCase() }));
		} else {
			this.d.renderMarkdown(shown ? shown.text : entry.definition, body);
		}

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
		// A translation says so — of a hand-written definition too, whose words are
		// then no longer the user's own (ADR-166).
		if (shown && "text" in shown) {
			parts.push(shown.from
				? t("glossaryTranslatedFrom", { code: shown.from.toUpperCase() })
				: t("glossaryTranslated"));
		}
		meta.createSpan({ cls: "p-term-anchor-metatext", text: `${parts.join(" · ")} · ` });

		const regen = meta.createEl("button", {
			cls: "pb pb-icon is-inline p-term-anchor-btn",
			attr: { "aria-label": t("glossaryRegenerate"), title: t("glossaryRegenerate") },
		});
		setIcon(regen, REGENERATE_ICON);
		regen.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.regenerate(anchor, entry.term, markEl);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		const remove = meta.createEl("button", {
			cls: "pb pb-icon is-inline p-term-anchor-btn",
			attr: { "aria-label": t("glossaryRemove"), title: t("glossaryRemove") },
		});
		setIcon(remove, "trash");
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.forget(entry.term);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		// "Other sense" sits beside regenerate because it is regenerate with one
		// thing added — the reader saying which sense they meant (ADR-208). The two
		// halves of a mute definition are "says nothing" and "wrong sense", and only
		// the second has a cheap fix.
		const resense = meta.createEl("button", {
			cls: "pb pb-link p-term-anchor-sense",
			text: t("glossarySenseHint"),
			attr: { title: t("glossarySenseHintPrompt") },
		});
		resense.addEventListener("click", (e) => {
			e.stopPropagation();
			this.askSense(anchor, entry.term, markEl);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		const discuss = meta.createEl("button", {
			cls: "pb pb-link p-term-anchor-discuss",
			text: t("glossaryDiscuss"),
			attr: { title: t("glossaryDiscussTooltip") },
		});
		discuss.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.discuss(entry, markEl);
		});
		meta.createSpan({ cls: "p-term-anchor-metatext", text: " · " });

		// Same short label and arrow as the fork and merge anchors — "Im Glossar
		// öffnen" is long enough to wrap the meta row onto a second line. The
		// specific wording survives as the tooltip.
		const open = meta.createEl("button", {
			cls: "pb pb-link p-term-anchor-open",
			text: t("forkOpenShort"),
			attr: { "aria-label": t("glossaryOpenNote"), title: t("glossaryOpenNote") },
		});
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			// The note's own path, not a link-text lookup by term: a person and a
			// term can share a name, and a term whose file name was sanitized
			// ("C#" → "C-") would not resolve by name at all.
			void this.d.plugin.app.workspace.openLinkText(this.d.plugin.glossaryService.pathFor(entry), "", true);
		});
	}

	/**
	 * Ask which sense was meant, then define again with that answer (ADR-208).
	 *
	 * An inline field inside the anchor rather than a modal: the passage the wrong
	 * sense came from is on screen behind it, and that is what the reader is
	 * reading off while they type. The hint is never stored — it shapes one
	 * lookup, like ADR-177's one-shot template layer.
	 */
	private askSense(anchor: HTMLElement, term: string, markEl: HTMLElement): void {
		anchor.querySelector(".p-term-anchor-sensebox")?.remove();
		const box = anchor.createDiv({ cls: "p-term-anchor-sensebox" });
		const input = box.createEl("input", {
			cls: "p-term-anchor-senseinput",
			attr: { type: "text", placeholder: t("glossarySenseHintPlaceholder") },
		});
		const submit = (): void => {
			const hint = input.value.trim();
			box.remove();
			if (hint) void this.regenerate(anchor, term, markEl, hint);
		};
		input.addEventListener("keydown", (e) => {
			e.stopPropagation(); // the view's Scope owns Enter; this field owns it here
			if (e.key === "Enter") { e.preventDefault(); submit(); }
			if (e.key === "Escape") { e.preventDefault(); box.remove(); }
		});
		// Blur closes without asking: a stray tap must not fire a model call.
		input.addEventListener("blur", () => box.remove());
		input.addEventListener("click", (e) => e.stopPropagation());
		input.focus();
	}

	/**
	 * Open a conversation about this term (ADR-208).
	 *
	 * The anchor closes first: the conversation switch rebuilds the transcript,
	 * so an anchor left open would be pointing at a mark that no longer exists.
	 */
	private async discuss(entry: GlossaryEntry, markEl: HTMLElement): Promise<void> {
		const passage = markEl.closest("[data-msg-id]")?.textContent ?? "";
		const source = this.d.getConversation() ?? undefined;
		this.closeAnchor();
		try {
			const conv = await this.d.plugin.conversationService.createTermConversation(entry, passage, source);
			await this.d.openConversation(conv);
			// Prefilled, never sent: the reader edits it into the question they actually
			// have. Opening an empty conversation would make them restate what they just
			// tapped, and sending it for them would spend a turn on our guess.
			this.d.prefillInput(termForkOpeningPrompt(entry.term, passage));
		} catch (e) {
			new Notice(t("glossaryDiscussFailed", {
				term: entry.term,
				error: e instanceof Error ? e.message : String(e),
			}));
		}
	}

	private async regenerate(
		anchor: HTMLElement,
		term: string,
		markEl: HTMLElement,
		/** Which sense the reader meant (ADR-208); shapes this lookup and is not stored. */
		senseHint?: string,
	): Promise<void> {
		const passage = markEl.closest("[data-msg-id]")?.textContent ?? "";
		const service = this.d.plugin.glossaryService;
		const conv = this.d.getConversation() ?? undefined;
		const known = service.find(await service.all(), term);
		// A person takes no sense hint: a name has one sense, the one the passage names.
		const entry = known?.kind === "person"
			? await service.lookupPerson(term, passage, true, conv)
			: await service.lookup(term, passage, true, conv, senseHint);
		if (entry && this.openAnchor === anchor) await this.show(anchor, entry, markEl);
	}

	private async forget(term: string): Promise<void> {
		await this.d.plugin.glossaryService.remove(term);
		this.closeAnchor();
		// The term is no longer known, so its marks must go everywhere at once.
		this.repaintAll();
	}
}
