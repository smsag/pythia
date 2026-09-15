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
 * `renderSourcesRow` paints the Template / Vault / Web rows under an assistant
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

/**
 * One vault reference as a plain accent-coloured name. Shared by the vault
 * citations and the template row.
 *
 * **No `[[ ]]` brackets** (ADR-153). ADR-140 drew them because `[[…]]` is what
 * "a note you can open" looks like in Obsidian — sound reasoning for a surface
 * with nothing else to say what a name is. This row now says it out loud: the
 * run-in label reads `Vault:` or `Template:` before the name, so the brackets
 * repeat a fact already stated and spend four characters doing it, on a row that
 * was already too wide for a sidebar. The affordance survives in the accent
 * colour and the hover underline, which is what every other openable reference
 * in the panel uses.
 *
 * The context inspector keeps its brackets: its note list has no label column,
 * so there the brackets are the only thing marking a name as a note.
 */
function renderWikilink(app: App, item: HTMLElement, src: MessageSource, title?: string): void {
	const name = item.createSpan({
		cls: "p-wikilink-name",
		text: src.title,
		attr: title ? { title } : {},
	});
	name.addEventListener("click", () => void openCitationSource(app, src));
}

/**
 * Sources row under an assistant message (ADR-140).
 *
 * Up to three labelled rows, always in this order: the Template that shaped the
 * answer, the Vault notes it cited, the Web pages it cited.
 *
 * **Each row opens with a run-in `Label:`** (ADR-153), not a fixed label column.
 * The column ADR-140 specified could never hold: `.p-sources-row` wraps, and a
 * wrapped flex line starts at the container edge, not under the first item — so
 * the 54px only ever aligned the first line of each row. With nineteen web
 * citations it aligned one line in five and cost 54px of a ~300px sidebar on
 * every one of them.
 *
 * The order runs from the user outwards. The template is theirs and framed the
 * whole answer; the vault notes are their own knowledge, which they can correct;
 * the web is the outside, and the only part that can rot or mislead. Reading
 * top-down therefore moves from what the reader owns to what they do not, which
 * is also roughly the order of how much they should trust it.
 *
 * The template leads because it is the frame the answer was written in, not one
 * of the passages inside it — everything below it was read *through* it. It is
 * rendered exactly like a vault citation for the same reason: both are notes the
 * reader can open.
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
		// Run-in label, not a column (ADR-153): `Web:` sits in the flow ahead of the
		// first entry. The colon is added here rather than in the string tables so a
		// translator cannot drop it and leave the row reading as a heading.
		r.createSpan({ cls: "p-sources-label", text: `${label}:` });
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
	// One label per row type, unconditionally. The vault row used to be relabelled
	// "SOURCES" when no web row was present, which made the same row read two
	// different ways depending on what else was on screen — invisible in isolation
	// and confusing side by side.
	if (vault.length) makeRow(t("sourcesVault"), vault);
	if (web.length) makeRow(t("sourcesWeb"), web);
}
