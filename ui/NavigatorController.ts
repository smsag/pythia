import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export interface NavigatorDeps {
	plugin: PythiaPlugin;
	navigatorEl: HTMLElement;
	indexTriggerEl: HTMLButtonElement;
	getConversation(): Conversation | null;
	setActiveConversation(conv: Conversation): Promise<void>;
	scrollToMessage(id: string): void;
}

export class NavigatorController {
	private outsideCleanup: (() => void) | null = null;

	constructor(private readonly d: NavigatorDeps) {}

	/** Close the popover and remove the outside-click listener. */
	close(): void {
		this.d.navigatorEl.removeClass("open");
		this.outsideCleanup?.();
		this.outsideCleanup = null;
	}

	toggle(): void {
		const { navigatorEl } = this.d;
		if (navigatorEl.hasClass("open")) {
			navigatorEl.removeClass("open");
			return;
		}

		navigatorEl.empty();
		const conv = this.d.getConversation();

		const makeSection = (
			label: string,
			defaultCollapsed: boolean,
			count: number,
			buildItems: (body: HTMLElement) => void
		): HTMLElement => {
			const section = navigatorEl.createDiv({ cls: "p-nav-section" });
			const header = section.createDiv({ cls: "p-nav-group-label p-nav-group-header" });
			const chevron = header.createEl("span", { cls: "p-nav-chevron" });
			header.createEl("span", { text: label });
			if (count > 0) header.createEl("span", { cls: "p-nav-count", text: String(count) });
			const body = section.createDiv({ cls: "p-nav-section-body" });

			if (defaultCollapsed) {
				body.style.display = "none";
				chevron.setText("▸");
			} else {
				chevron.setText("▾");
				buildItems(body);
			}

			header.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (body.style.display === "none") {
					body.style.display = "";
					chevron.setText("▾");
					if (!body.hasChildNodes()) buildItems(body);
				} else {
					body.style.display = "none";
					chevron.setText("▸");
				}
			});
			return section;
		};

		// ── Forks ────────────────────────────────────────────────────
		const forks = conv
			? this.d.plugin.conversationStore.getAll().filter(c => c.forkedFromId === conv.id)
			: [];
		makeSection(t("forksSection"), true, forks.length, (body) => {
			if (forks.length === 0) {
				body.createDiv({ cls: "p-nav-empty", text: t("navNoForks") });
			} else {
				for (const fork of forks) {
					const item = body.createDiv({ cls: "p-nav-item" });
					item.createEl("span", { cls: "p-nav-fork-icon", text: "⎇" });
					item.createEl("span", { cls: "p-nav-label", text: fork.name });
					item.addEventListener("mousedown", (e) => {
						e.preventDefault();
						e.stopPropagation();
						navigatorEl.removeClass("open");
						document.removeEventListener("mousedown", onOutside, true);
						void this.d.setActiveConversation(fork);
					});
				}
			}
		});

		// ── Starred ─────────────────────────────────────────────────
		const favs = conv?.favorites ?? [];
		makeSection(t("favoritesSection"), false, favs.length, (body) => {
			if (favs.length === 0) {
				body.createDiv({ cls: "p-nav-empty", text: t("navNoStarred") });
			} else {
				for (const fav of favs) {
					const item = body.createDiv({ cls: "p-nav-item" });
					item.createEl("span", { cls: "p-nav-star", text: "★" });
					item.createEl("span", { cls: "p-nav-label", text: fav.name });
					item.addEventListener("mousedown", (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.d.scrollToMessage(fav.messageId);
						navigatorEl.removeClass("open");
						document.removeEventListener("mousedown", onOutside, true);
					});
				}
			}
		});

		// ── Chapters ─────────────────────────────────────────────────
		const userMsgs = conv?.messages.filter((m) => m.role === "user") ?? [];
		const chaptersSection = makeSection(t("chaptersSection"), false, userMsgs.length, (body) => {
			if (userMsgs.length === 0) {
				body.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
			} else {
				for (const msg of userMsgs) {
					const label = msg.chapterName ?? msg.content.slice(0, 60).replace(/\s+/g, " ").trim();
					const item = body.createDiv({ cls: "p-nav-item" });
					item.createEl("span", { cls: "p-nav-label", text: label });
					item.addEventListener("mousedown", (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.d.scrollToMessage(msg.id);
						navigatorEl.removeClass("open");
						document.removeEventListener("mousedown", onOutside, true);
					});
				}
			}
		});

		navigatorEl.addClass("open");

		// Scroll to Chapters so it's visible without scrolling, even when
		// Forks and Starred above it are long.
		requestAnimationFrame(() => {
			chaptersSection.scrollIntoView({ block: "start", behavior: "instant" });
		});

		// Close on mousedown outside (capture phase so it fires before any Obsidian handlers).
		// Stored in outsideCleanup so it can be removed if the view closes or conversation
		// switches before the user clicks outside (#26).
		this.outsideCleanup?.();
		const onOutside = (e: MouseEvent) => {
			if (!navigatorEl.contains(e.target as Node) && e.target !== this.d.indexTriggerEl) {
				navigatorEl.removeClass("open");
				this.outsideCleanup?.();
				this.outsideCleanup = null;
			}
		};
		// Defer so the trigger's own mousedown doesn't immediately close it.
		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			this.outsideCleanup = () =>
				document.removeEventListener("mousedown", onOutside, true);
		}, 0);
	}
}
