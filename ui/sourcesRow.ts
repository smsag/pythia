import { App, Notice, TFile } from "obsidian";
import type { MessageSource } from "../models/types";
import { t } from "../i18n";
import { safeHttpUrl } from "../services/urlSafety";
import { noteBasename } from "../services/pathUtils";

/**
 * The citation "sources" surface, extracted from `PythiaSidebarView` (ADR-103
 * decomposition). `openCitationSource` handles a click on a citation chip or a
 * sources-row entry: a web source opens in the browser (http(s) only, via
 * noopener,noreferrer — see urlSafety), a vault source opens the note.
 * `renderSourcesRow` paints the TEMPLATE / WEB / VAULT rows under an assistant
 * message. Free functions taking `app` so the view stays thin and both the
 * inline chips and the row share one code path.
 */
export async function openCitationSource(app: App, src: MessageSource): Promise<void> {
	if (src.kind === "web") {
		const url = safeHttpUrl(src.ref); // http(s) only; noopener,noreferrer stops leakage
		if (!url) { new Notice(t("invalidUrl", { url: src.ref })); return; }
		window.open(url, "_blank", "noopener,noreferrer");
		return;
	}
	const f = app.vault.getAbstractFileByPath(src.ref) ?? app.metadataCache.getFirstLinkpathDest(src.ref, "");
	if (f instanceof TFile) await app.workspace.getLeaf(false).openFile(f);
	else new Notice(t("fileNotFound", { path: src.ref }));
}

/** One vault reference as `[[Name]]`, the form Obsidian users read as "a note
 *  you can open". Shared by the vault citations and the template row. */
function renderWikilink(app: App, item: HTMLElement, src: MessageSource, title?: string): void {
	item.createSpan({ cls: "p-wikilink-bracket", text: "[[" });
	const name = item.createSpan({
		cls: "p-wikilink-name",
		text: src.title,
		attr: title ? { title } : {},
	});
	name.addEventListener("click", () => void openCitationSource(app, src));
	item.createSpan({ cls: "p-wikilink-bracket", text: "]]" });
}

/**
 * Sources row under an assistant message (ADR-140).
 *
 * Up to three labelled rows, in this order: the TEMPLATE that shaped the answer,
 * the WEB pages it cited, the VAULT notes it cited. A single QUELLEN row replaces
 * WEB/VAULT when every citation is a vault note.
 *
 * The template leads because it is the frame the answer was written in, not one
 * of the passages inside it — everything below it was read *through* it. It is
 * rendered as a wikilink for the same reason vault citations are: in Obsidian,
 * `[[…]]` is what "a note you can open" looks like.
 *
 * It carries no number. The numbers here are citation indices matching the
 * superscript chips in the prose, and nothing in the answer cites its template,
 * so a number would be an affordance leading nowhere.
 */
export function renderSourcesRow(
	app: App,
	row: HTMLElement,
	sources: MessageSource[],
	templatePath?: string,
): void {
	if (!sources.length && !templatePath) return;
	const web = sources.filter((s) => s.kind === "web");
	const vault = sources.filter((s) => s.kind === "vault");
	const container = row.createDiv({ cls: "p-sources" });

	const makeRow = (label: string, items: MessageSource[], numbered = true, tip?: (s: MessageSource) => string) => {
		const r = container.createDiv({ cls: "p-sources-row" });
		r.createSpan({ cls: "p-sources-label", text: label });
		for (const s of items) {
			const item = r.createSpan({ cls: "p-source" });
			if (numbered) item.createSpan({ cls: "p-source-num", text: String(s.n) });
			if (s.kind === "web") {
				const link = item.createSpan({ cls: "p-source-web", text: `${s.title} ↗` });
				link.addEventListener("click", () => void openCitationSource(app, s));
			} else {
				renderWikilink(app, item, s, tip?.(s));
			}
		}
	};

	if (templatePath) {
		// A synthetic vault source, so opening it goes through the same path as a
		// vault citation — including the "file not found" notice when the template
		// has since been renamed or deleted.
		makeRow(
			t("sourcesTemplate"),
			[{ n: 0, kind: "vault", ref: templatePath, title: noteBasename(templatePath) }],
			false,
			(s) => t("templateLabel", { name: s.title }),
		);
	}
	if (web.length) {
		makeRow(t("sourcesWeb"), web);
		if (vault.length) makeRow(t("sourcesVault"), vault);
	} else if (vault.length) {
		makeRow(t("sourcesLabel"), vault);
	}
}
