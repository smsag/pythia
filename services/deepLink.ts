import { t } from "../i18n";

/**
 * The `obsidian://pythia` protocol handler (engineering-review #358), lifted out
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
 *  • **`text` is used as delivered.** Obsidian already decodes protocol-handler
 *    params, and decoding again throws on any text containing a bare "%"
 *    ("50% off"). Never add a `decodeURIComponent` on this path.
 */

/** The actions a deep link can trigger. `false` means "the thing it named is not
 *  there" — the router owns the message, the host owns the doing. */
export interface DeepLinkHost {
	/** `cmd=open` — activate the sidebar view. */
	open(): Promise<void>;
	/** `cmd=new` — create a conversation and show it. */
	create(): Promise<void>;
	/** `cmd=resume&id=…` — false when no conversation has that id. */
	resume(id: string): Promise<boolean>;
	/** `cmd=template&name=…` — false when no template has that name. */
	template(name: string): Promise<boolean>;
	/** `cmd=inject&text=…` — pick a template, then auto-prompt with `text`.
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
		// "show me Pythia" — the most useful thing a link with no verb can do.
		const action = params.cmd ?? "open";

		if (action === "open") return void (await host.open());

		if (action === "new") return void (await host.create());

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
			// Used verbatim: Obsidian already decoded it (see the class comment).
			const text = params.text ?? "";
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
