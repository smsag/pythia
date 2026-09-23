/**
 * The one copy-to-clipboard control (principle 4).
 *
 * `copyWithFeedback` lived privately inside `ui/CodeBlockDecorator.ts` while
 * CLAUDE.md described it as the shared helper, so four other surfaces went and
 * hand-rolled their own. ADR-210 needed a second flavour — an image — and a
 * second flavour of a helper that is already duplicated five ways is how the
 * sixth copy gets written. It lives here now.
 *
 * `tests/chartRules.test.ts` holds the line: `navigator.clipboard` may appear
 * only in this file, plus a named list of the four legacy sites that may shrink
 * and never grow.
 */

import { Notice, setIcon } from "obsidian";
import { t } from "../i18n";

const FLASH_MS = 1500;

/** Flash the button to a check mark and back. */
export function flashCopied(btn: HTMLElement, restoreIcon = "copy"): void {
	setIcon(btn, "check");
	btn.addClass("copied");
	setTimeout(() => { setIcon(btn, restoreIcon); btn.removeClass("copied"); }, FLASH_MS);
}

/** Copy `text`; a denied clipboard says so rather than surfacing as an unhandled
 *  rejection or, worse, as nothing at all. */
export async function copyTextWithFeedback(
	btn: HTMLElement, text: string, restoreIcon = "copy",
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		new Notice(t("copyFailed"));
		return;
	}
	flashCopied(btn, restoreIcon);
}

export interface BlobCopyOptions {
	/** Copied instead when the image write is refused — never nothing. */
	fallbackText: string;
	/** Said when that happens, so a fallback is never mistaken for the real thing. */
	fallbackNotice: string;
	restoreIcon?: string;
}

/**
 * Copy a blob, falling back to text.
 *
 * `blob` is a PROMISE and is passed into `ClipboardItem` unresolved on purpose.
 * Safari requires `clipboard.write` to be reached inside the user gesture that
 * started it, and awaiting the rasterisation first spends that gesture — the
 * write then fails on iOS and succeeds everywhere else, which is the worst kind
 * of bug to find. `ClipboardItem` has accepted a promise for exactly this reason
 * since it shipped.
 *
 * The fallback is not optional and is not hidden on mobile: a control that
 * quietly does nothing is worse than one that says what it did instead.
 */
export async function copyBlobWithFeedback(
	btn: HTMLElement, mime: string, blob: Promise<Blob>, opts: BlobCopyOptions,
): Promise<void> {
	const restore = opts.restoreIcon ?? "copy";
	const Item = (window as unknown as { ClipboardItem?: new (i: Record<string, Promise<Blob>>) => ClipboardItem })
		.ClipboardItem;
	if (Item && typeof navigator.clipboard?.write === "function") {
		try {
			await navigator.clipboard.write([new Item({ [mime]: blob })]);
			flashCopied(btn, restore);
			return;
		} catch {
			// An image the clipboard would not take is a reason to offer the text,
			// not a reason to stop.
		}
	}
	try {
		await navigator.clipboard.writeText(opts.fallbackText);
	} catch {
		new Notice(t("copyFailed"));
		return;
	}
	new Notice(opts.fallbackNotice);
	flashCopied(btn, restore);
}
