import { t } from "../i18n";

/**
 * The `obsidian://pythia` protocol handler (engineering-review #366), lifted out
 * of `main.ts` so its routing and validation can be tested.
 *
 * Everything here is a rule about *parameters*, not about Obsidian: which `cmd`
 * values exist, which of them require which parameter, and what the user is told
 * when one is missing or names something that does not exist. The side effects —
 * opening the view, creating conversations, listing templates — go through
 * `DeepLinkHost`, whose methods answer with a boolean when the thing might not be
 * there, so the "not found" message stays a rule of this router and not a second
 * copy inside each action.
 *
 * Three behaviours are load-bearing and each has a test:
 *
 *  • **Every failure speaks** (principle 2). A deep link is fired from outside
 *    Obsidian, often from a script, so a silent no-op is unreportable.
 *  • **Errors cannot escape.** Obsidian does not await async protocol handlers, so
 *    a rejection here would be swallowed by the platform; the `catch` turns it
 *    into a `Notice` plus a console entry.
 *  • **`text` is never decoded again.** Obsidian already decodes protocol-handler
 *    params, and decoding again throws on any text containing a bare "%"
 *    ("50% off"). Never add a `decodeURIComponent` on this path.
 *
 * Two more from the shortcut link (ADR-241), for macOS / iOS Shortcuts:
 *
 *  • **It waits for the workspace.** A link can be what launches Obsidian, and a
 *    view opened before the layout is ready lands in a workspace that is about
 *    to be replaced. `host.ready()` is awaited before any action.
 *  • **Text from a link is untrusted and bounded.** Any web page can open an
 *    `obsidian://` link, so `text` goes through `linkText` — invisible control
 *    characters removed, at most `MAX_LINK_TEXT_CHARS`, refused whole beyond that
 *    (never cut: a truncated prompt is a different prompt) — and it is only ever
 *    PREFILLED. Nothing a link carries is sent, and nothing that costs money or
 *    sends data starts until the user presses Send.
 */

/** The longest `text` a link may carry. A question typed into a Shortcut fits
 *  many times over; a page stuffing the composer does not. */
export const MAX_LINK_TEXT_CHARS = 4000;

/** Control and bidi/zero-width characters other than tab and line breaks:
 *  invisible in the composer, so a link could hide text the user never sees
 *  before pressing Send. */
const HIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g;

/** The ONE check of a link's `text`: `""` for none, `null` when too long. */
export function linkText(raw: string | undefined): string | null {
	const text = (raw ?? "").replace(HIDDEN_CHARS, "").trim();
	return text.length > MAX_LINK_TEXT_CHARS ? null : text;
}

/** `&new`, `&new=1`, `&new=true` start a conversation; `new=0` / `false` / `no`
 *  are the explicit "just open". Obsidian may deliver a bare flag as an empty or
 *  a `"true"` value, so presence is what counts. */
export function wantsNewConversation(params: DeepLinkParams): boolean {
	const v = params.new;
	if (v === undefined) return false;
	return !["0", "false", "no"].includes(v.trim().toLowerCase());
}

/** The actions a deep link can trigger. `false` means "the thing it named is not
 *  there" — the router owns the message, the host owns the doing. */
export interface DeepLinkHost {
	/** Resolves once the workspace layout is ready (at once when it already is). */
	ready(): Promise<void>;
	/** `cmd=open` — activate the sidebar view. */
	open(): Promise<void>;
	/** `cmd=new` or `new` — create a conversation and show it; a non-empty `text`
	 *  is PREFILLED in the composer, never sent. */
	create(text: string): Promise<void>;
	/** `cmd=resume&id=…` — false when no conversation has that id. */
	resume(id: string): Promise<boolean>;
	/** `cmd=template&name=…` — false when no template has that name. */
	template(name: string): Promise<boolean>;
	/** `cmd=inject&text=…` — pick a template, then PREFILL the composer with `text`
	 *  (never auto-sent: the link's origin is untrusted).
	 *  False when the vault holds no templates to pick from. */
	inject(text: string): Promise<boolean>;
	/** Named in the "no templates" message, so the user knows where to look. */
	templatesFolder(): string;
	notice(message: string): void;
}

/** Deep-link parameters as Obsidian delivers them: already decoded, all optional. */
export type DeepLinkParams = Record<string, string | undefined>;

/**
 * Route one `obsidian://pythia` call. Never rejects — see the class comment.
 */
export async function handleDeepLink(params: DeepLinkParams, host: DeepLinkHost): Promise<void> {
	try {
		// No `cmd` at all is the bare `obsidian://pythia?vault=…` link, which means
		// "show me Pythia" — the most useful thing a link with no verb can do. The
		// `new` flag is the shortcut's one parameter: the same link, a new conversation.
		const action = params.cmd ?? (wantsNewConversation(params) ? "new" : "open");

		// Checked before waiting: a refused link should not open anything.
		const text = linkText(params.text);
		if (text === null) return host.notice(t("uriTextTooLong", { max: String(MAX_LINK_TEXT_CHARS) }));

		await host.ready();

		if (action === "open") return void (await host.open());

		if (action === "new") return void (await host.create(text));

		if (action === "resume") {
			if (!params.id) return host.notice(t("uriMissingId"));
			if (!(await host.resume(params.id))) host.notice(t("convNotFound", { id: params.id }));
			return;
		}

		if (action === "template") {
			if (!params.name) return host.notice(t("uriMissingName"));
			if (!(await host.template(params.name))) host.notice(t("templateNotFound", { name: params.name }));
			return;
		}

		if (action === "inject") {
			// Not decoded again: Obsidian already did (see the class comment).
			if (!text) return host.notice(t("uriMissingText"));
			if (!(await host.inject(text))) {
				host.notice(t("noTemplatesFound", { folder: host.templatesFolder() }));
			}
			return;
		}

		host.notice(t("unknownAction", { action }));
	} catch (err) {
		host.notice(t("deepLinkError", { error: err instanceof Error ? err.message : String(err) }));
		console.error("[Pythia] protocol handler error", err);
	}
}
