import { setIcon } from "obsidian";

/** One selectable row in a bottom action sheet. */
export interface ActionSheetItem {
	label: string;
	/** Obsidian icon id (rendered via setIcon). Empty for a choice row, which
	 *  shows a check when `active` instead (ADR-165). */
	icon: string;
	/** One-line explanation under the label — readable without hover. */
	detail?: string;
	/** The current choice: accent label and a check. */
	active?: boolean;
	disabled?: boolean;
	onSelect: () => void;
	/** A second, icon-only action at the row's trailing edge — the same subject,
	 *  a different verb (rename by hand · rename with AI). Its own tap target;
	 *  pressing it never runs `onSelect`. */
	trailing?: { icon: string; label: string; onSelect: () => void };
}

export interface ActionSheetOptions {
	/** Optional heading shown above the items. */
	title?: string;
}

/**
 * A mobile-native bottom action sheet: a full-width panel docked to the bottom
 * of the host element behind a tap-to-dismiss scrim, with large touch targets,
 * a drag handle, swipe-down-to-dismiss, and iOS safe-area padding.
 *
 * Replaces the small floating popover (`.p-send-menu`) for touch, where a
 * stacked popover is the wrong UX — it's cramped, mis-placed near the keyboard,
 * and undiscoverable. Desktop keeps the popover; this is created only on mobile
 * (see sidebar's `openSummaryMenu`).
 *
 * Self-contained: `open()` mounts the DOM and its listeners; every dismissal
 * path routes through `close()`, which removes them all. One sheet instance per
 * host is reused across opens.
 */
export class ActionSheet {
	private host: HTMLElement;
	private scrim: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	constructor(host: HTMLElement) {
		this.host = host;
	}

	get isOpen(): boolean {
		return this.scrim !== null;
	}

	open(items: ActionSheetItem[], opts: ActionSheetOptions = {}): void {
		this.close(); // never stack two sheets

		const scrim = this.host.createDiv({ cls: "p-sheet-scrim" });
		const sheet = scrim.createDiv({ cls: "p-sheet" });
		sheet.setAttr("role", "dialog");
		sheet.setAttr("aria-modal", "true");

		// Drag handle (also the visual affordance that this is dismissable).
		const handleWrap = sheet.createDiv({ cls: "p-sheet-handle-wrap" });
		handleWrap.createDiv({ cls: "p-sheet-handle" });

		if (opts.title) {
			sheet.createDiv({ cls: "p-sheet-title", text: opts.title });
		}

		const list = sheet.createDiv({ cls: "p-sheet-list" });
		for (const item of items) {
			const row = list.createDiv({
				cls: `p-sheet-item${item.disabled ? " p-sheet-item-disabled" : ""}${item.active ? " is-active" : ""}`,
			});
			const ic = row.createSpan({ cls: "p-sheet-item-icon" });
			const glyph = item.icon || (item.active ? "check" : "");
			if (glyph) setIcon(ic, glyph);
			const text = row.createDiv({ cls: "p-sheet-item-text" });
			text.createSpan({ cls: "p-sheet-item-label", text: item.label });
			if (item.detail) text.createSpan({ cls: "p-sheet-item-detail", text: item.detail });
			if (item.disabled) continue;
			if (item.trailing) {
				const tr = item.trailing;
				const btn = row.createEl("button", {
					cls: "p-sheet-item-trailing",
					attr: { "aria-label": tr.label, title: tr.label },
				});
				setIcon(btn, tr.icon);
				btn.addEventListener("pointerup", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.close();
					tr.onSelect();
				});
			}
			// pointerup fires for both touch and mouse and, unlike mousedown, lets a
			// tap complete without stealing focus mid-gesture; preventDefault keeps a
			// synthetic click from also reaching the element behind the scrim.
			row.addEventListener("pointerup", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const run = item.onSelect;
				this.close();
				run();
			});
		}

		// Animate in on the next frame (starts from the CSS `.p-sheet` off-screen
		// transform; adding the class transitions it up).
		requestAnimationFrame(() => {
			scrim.addClass("is-open");
			sheet.addClass("is-open");
		});

		// ── Dismissal wiring ──
		const onScrimDown = (e: Event) => {
			// Only when the scrim itself (not the sheet) is pressed.
			if (e.target === scrim) this.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.close();
		};
		scrim.addEventListener("pointerdown", onScrimDown);
		document.addEventListener("keydown", onKey);

		// Swipe-down-to-dismiss on the sheet.
		const detachSwipe = this.attachSwipe(sheet);

		this.scrim = scrim;
		this.cleanup = () => {
			scrim.removeEventListener("pointerdown", onScrimDown);
			document.removeEventListener("keydown", onKey);
			detachSwipe();
			scrim.remove();
		};
	}

	close(): void {
		if (!this.cleanup) return;
		const done = this.cleanup;
		this.cleanup = null;
		this.scrim = null;
		done();
	}

	/** Vertical drag on the sheet: follow the finger, and dismiss past a
	 *  threshold (or on a fast flick), otherwise snap back. Returns a detacher. */
	private attachSwipe(sheet: HTMLElement): () => void {
		let startY = 0;
		let dy = 0;
		let dragging = false;

		const onDown = (e: PointerEvent) => {
			// Ignore drags starting on an item so a tap still registers cleanly;
			// the handle area and title are the drag zone.
			if ((e.target as HTMLElement).closest(".p-sheet-item")) return;
			dragging = true;
			startY = e.clientY;
			dy = 0;
			sheet.addClass("is-dragging");
		};
		const onMove = (e: PointerEvent) => {
			if (!dragging) return;
			dy = Math.max(0, e.clientY - startY);
			sheet.style.transform = `translateY(${dy}px)`;
		};
		const onUp = () => {
			if (!dragging) return;
			dragging = false;
			sheet.removeClass("is-dragging");
			sheet.style.transform = "";
			if (dy > 80) this.close();
		};

		sheet.addEventListener("pointerdown", onDown);
		sheet.addEventListener("pointermove", onMove);
		sheet.addEventListener("pointerup", onUp);
		sheet.addEventListener("pointercancel", onUp);

		return () => {
			sheet.removeEventListener("pointerdown", onDown);
			sheet.removeEventListener("pointermove", onMove);
			sheet.removeEventListener("pointerup", onUp);
			sheet.removeEventListener("pointercancel", onUp);
		};
	}
}
