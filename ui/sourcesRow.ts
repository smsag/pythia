import { App, Notice, TFile } from "obsidian";
import type { MessageSource } from "../models/types";
import { t } from "../i18n";
import { safeHttpUrl } from "../services/urlSafety";

/**
 * The citation "sources" surface, extracted from `PythiaSidebarView` (ADR-103
 * decomposition). `openCitationSource` handles a click on a citation chip or a
 * sources-row entry: a web source opens in the browser (http(s) only, via
 * noopener,noreferrer — see urlSafety), a vault source opens the note.
 * `renderSourcesRow` paints the QUELLEN / WEB+VAULT rows under an assistant
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

/** Sources row under an assistant message. A single QUELLEN row when all sources
 *  are vault notes; split WEB / VAULT rows when any are web. */
export function renderSourcesRow(app: App, row: HTMLElement, sources: MessageSource[]): void {
	if (!sources.length) return;
	const web = sources.filter((s) => s.kind === "web");
	const vault = sources.filter((s) => s.kind === "vault");
	const container = row.createDiv({ cls: "p-sources" });

	const makeRow = (label: string, items: MessageSource[]) => {
		const r = container.createDiv({ cls: "p-sources-row" });
		r.createSpan({ cls: "p-sources-label", text: label });
		for (const s of items) {
			const item = r.createSpan({ cls: "p-source" });
			item.createSpan({ cls: "p-source-num", text: String(s.n) });
			if (s.kind === "web") {
				const link = item.createSpan({ cls: "p-source-web", text: `${s.title} ↗` });
				link.addEventListener("click", () => void openCitationSource(app, s));
			} else {
				item.createSpan({ cls: "p-wikilink-bracket", text: " [[" });
				const name = item.createSpan({ cls: "p-wikilink-name", text: s.title });
				name.addEventListener("click", () => void openCitationSource(app, s));
				item.createSpan({ cls: "p-wikilink-bracket", text: "]]" });
			}
		}
	};

	if (web.length) {
		makeRow(t("sourcesWeb"), web);
		if (vault.length) makeRow(t("sourcesVault"), vault);
	} else {
		makeRow(t("sourcesLabel"), vault);
	}
}
