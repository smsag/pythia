import { t } from "../i18n";

/**
 * Bound a rendered summary inside an inline anchor, with a control to open it
 * (ADR-141).
 *
 * The prompt asks for at most five sentences, but a prompt is a request, not a
 * guarantee: models disagree about "brief", and every summary already stored in
 * a conversation was written under the old, looser rules and will never be
 * regenerated unless the user asks. So the display carries its own ceiling —
 * that is the half of the fix that works on data already on disk.
 *
 * Five lines, not a scroll box. The summary bar at the top of a conversation
 * uses a fixed height with internal scrolling, which works because it is sticky
 * chrome; an inline block mid-transcript that eats the page scroll is a
 * different, worse thing on touch. Clamp and expand keeps one scroll surface.
 *
 * The control only appears when the content actually overflows, which can only
 * be known after layout — hence the rAF. A summary that fits shows no affordance
 * at all, because there is nothing behind it.
 */
const CLAMP_CLASS = "p-clamped";

export function clampSummary(body: HTMLElement, mount: HTMLElement): void {
	body.addClass(CLAMP_CLASS);
	requestAnimationFrame(() => {
		// The anchor can be torn down (conversation switch, re-render) between the
		// build and this frame; measuring a detached node reports 0 for both.
		if (!body.isConnected) return;
		if (body.scrollHeight <= body.clientHeight + 2) {
			body.removeClass(CLAMP_CLASS);
			return;
		}
		const btn = mount.createEl("button", { cls: "pb pb-link p-anchor-more", text: t("summaryMore") });
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const wasClamped = body.hasClass(CLAMP_CLASS);
			body.toggleClass(CLAMP_CLASS, !wasClamped);
			btn.textContent = wasClamped ? t("summaryLess") : t("summaryMore");
		});
	});
}
