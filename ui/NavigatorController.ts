import type PythiaPlugin from "../main";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";

export interface NavigatorDeps {
	plugin: PythiaPlugin;
	navigatorEl: HTMLElement;
	indexTriggerEl: HTMLButtonElement;
	getConversation(): Conversation | null;
	setActiveConversation(conv: Conversation): Promise<void>;
	scrollToMessage(id: string): void;
	scrollToFavorite(fav: Favorite): void;
	removeFavorite(favId: string): Promise<void>;
	goToFavoritesSummary(): void;
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
			this.close();
			return;
		}

		navigatorEl.empty();
		const conv = this.d.getConversation();

		const makeSection = (
			label: string,
			defaultCollapsed: boolean,
			count: number,
			buildItems: (body: HTMLElement) => void,
			labelLink?: { onClick: () => void } | { disabled: true }
		): HTMLElement => {
			const section = navigatorEl.createDiv({ cls: "p-nav-section" });
			const header = section.createDiv({ cls: "p-nav-group-label p-nav-group-header" });
			const chevron = header.createEl("span", { cls: "p-nav-chevron" });
			const labelEl = header.createEl("span", { cls: "p-nav-group-name", text: label });
			if (labelLink && "onClick" in labelLink) {
				labelEl.addClass("p-nav-link");
				labelEl.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					labelLink.onClick();
				});
			} else if (labelLink && "disabled" in labelLink) {
				labelEl.addClass("p-nav-disabled");
			}
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

		// ── Forks (branch tree, F5) ──────────────────────────────────
		// Show the fork family as a tree: the source conversation (root) with its
		// child forks indented beneath it. The root is the current conversation's
		// parent when it is itself a fork, otherwise the current conversation.
		const all = this.d.plugin.conversationStore.getAll();
		const parentId = conv?.forkedFromId;
		const root = (parentId ? all.find((c) => c.id === parentId) : conv) ?? conv;
		const rootId = root?.id;
		const children = rootId ? all.filter((c) => c.forkedFromId === rootId) : [];
		const hasTree = !!root && children.length > 0;

		const openConv = (target: Conversation) => {
			navigatorEl.removeClass("open");
			document.removeEventListener("mousedown", onOutside, true);
			void this.d.setActiveConversation(target);
		};

		makeSection(t("forksSection"), true, children.length, (body) => {
			if (!hasTree || !root) {
				body.createDiv({ cls: "p-nav-empty", text: t("navNoForks") });
				return;
			}
			// Source (root) row
			const srcRow = body.createDiv({ cls: "p-nav-tree-source" });
			if (root.id === conv?.id) srcRow.addClass("active");
			srcRow.createEl("span", { cls: "p-nav-fork-icon", text: "⎇" });
			srcRow.createEl("span", { cls: "p-nav-label", text: root.name });
			srcRow.createEl("span", { cls: "p-nav-tag", text: t("navSourceTag") });
			srcRow.addEventListener("mousedown", (e) => {
				e.preventDefault(); e.stopPropagation();
				if (root.id !== conv?.id) openConv(root);
			});
			// Children, indented under a vertical rule
			const kids = body.createDiv({ cls: "p-nav-tree-children" });
			for (const child of children) {
				const isActive = child.id === conv?.id;
				const row = kids.createDiv({ cls: "p-nav-tree-item" });
				if (isActive) row.addClass("active");
				const dot = row.createEl("span", { cls: "p-nav-dot" });
				if (isActive) dot.addClass("active");
				row.createEl("span", { cls: "p-nav-label", text: child.name });
				if (isActive) {
					row.createEl("span", { cls: "p-nav-tag", text: t("navActiveTag") });
				} else {
					row.createEl("span", { cls: "p-nav-count-inline", text: String(child.messages.length) });
				}
				row.addEventListener("mousedown", (e) => {
					e.preventDefault(); e.stopPropagation();
					if (!isActive) openConv(child);
				});
			}
		});

		// ── Favorites (highlighted spans) ───────────────────────────
		// The section label links to the favorites summary card when one exists;
		// otherwise it is shown greyed and non-clickable.
		const favs = conv?.favorites ?? [];
		const hasFavSummary = !!conv?.favoritesSummary?.text?.trim();
		const favLabelLink = hasFavSummary
			? {
					onClick: () => {
						navigatorEl.removeClass("open");
						document.removeEventListener("mousedown", onOutside, true);
						this.d.goToFavoritesSummary();
					},
			  }
			: ({ disabled: true } as const);
		makeSection(t("favoritesSection"), false, favs.length, (body) => {
			if (favs.length === 0) {
				body.createDiv({ cls: "p-nav-empty", text: t("navNoFavorites") });
			} else {
				for (const fav of favs) {
					const item = body.createDiv({ cls: "p-nav-item" });
					item.createEl("span", { cls: "p-nav-star", text: "★" });
					item.createEl("span", { cls: "p-nav-label", text: fav.name });
					const del = item.createEl("span", {
						cls: "p-nav-del",
						text: "✕",
						attr: { title: t("removeHighlight") },
					});
					item.addEventListener("mousedown", (e) => {
						e.preventDefault();
						e.stopPropagation();
						// Mirror the Chapters handler exactly: jump synchronously, then close.
						this.d.scrollToFavorite(fav);
						navigatorEl.removeClass("open");
						document.removeEventListener("mousedown", onOutside, true);
					});
					del.addEventListener("mousedown", (e) => {
						e.preventDefault();
						e.stopPropagation();
						void this.d.removeFavorite(fav.id).then(() => {
							item.remove();
							// Keep the header count in sync without a full rebuild.
							const count = item.parentElement?.querySelectorAll(".p-nav-item").length ?? 0;
							if (count === 0) {
								body.createDiv({ cls: "p-nav-empty", text: t("navNoFavorites") });
							}
						});
					});
				}
			}
		}, favLabelLink);

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
