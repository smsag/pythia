import type noteAnchorsEn from "./noteAnchors.en";

// See noteAnchors.en.ts (ADR-249).
const noteAnchorsDe: typeof noteAnchorsEn = {
	chapterNotFound:              "Pythia: Dieses Kapitel ist nicht mehr in der Unterhaltung – sie wurde stattdessen oben geöffnet.",
	copyChapterLink:              "Link zu diesem Kapitel kopieren",
	chapterLinkCopied:            "Kapitel-Link kopiert. In eine Notiz einfügen, oder dort Text markieren und „Markierung mit {{name}} verknüpfen“ wählen.",
	cmdLinkSelectionToChapter:    "Markierung mit dem kopierten Kapitel verknüpfen",
	linkSelectionToNamed:         "Markierung mit {{name}} verknüpfen",
	noChapterCopied:              "Kopiere zuerst in Pythia einen Kapitel-Link – das Link-Symbol über einer Nachricht oder ein Kapitel im #-Navigator.",
	cmdStartLinkedConversation:   "Verknüpfte Unterhaltung aus Markierung starten",
	anchorSelectionEmpty:         "Markiere zuerst den Text, auf dem der Link sitzen soll.",
	anchorSelectionMultiline:     "Ein Link kann nur auf Text innerhalb einer Zeile sitzen – markiere weniger.",
	anchorSelectionMarkup:        "Die Markierung enthält schon einen Link, Code, eine Hervorhebung, eine Fußnote oder einen Teil einer Formatierung – markiere reinen Text.",
	anchorSelectionChanged:       "Die Notiz hat sich geändert, bevor der Link geschrieben wurde – nichts wurde geändert.",
	anchorLinked:                 "Mit {{name}} verknüpft.",
	cmdUpdateFootnotes:           "Pythia-Fußnoten in dieser Notiz aktualisieren",
	footnotesNoAnchors:           "Diese Notiz enthält keine Links zu Pythia-Unterhaltungen.",
	footnotesUpdated:             "Pythia-Fußnoten aktualisiert ({{count}} Zusammenfassungen neu geschrieben).",
	footnotesRefreshFailed:       "{{count}} Zusammenfassungen konnten nicht geschrieben werden: {{reasons}}",
	footnotesRefreshLimit:        "mehr als {{max}} auf einmal",
	footnotesRefreshEmpty:        "das Modell hat keinen Text geschickt",
	footnotesRefreshGone:         "das Kapitel hat sich während der Zusammenfassung geändert",
	footnotesRefreshError:        "die Anfrage ist fehlgeschlagen (Details in der Konsole bei eingeschaltetem Debug-Modus)",
	refreshingForExport:          "Pythia: {{count}} Zusammenfassungen für den Druck werden aktualisiert …",
	noteAnchorLabel:              "NOTIZANKER",
	noteAnchorNoSummary:          "Noch keine Zusammenfassung – ↻ schreibt eine.",
	noteAnchorUnanswered:         "Noch keine Antwort, also nichts zusammenzufassen.",
	noteAnchorDeleted:            "Diese Unterhaltung wurde gelöscht.",
	noteAnchorRefresh:            "Zusammenfassung neu schreiben",
	deleteConvLinkedNotes:        "{{count}} Notiz(en) verlinken auf diese Unterhaltung – ihre Links funktionieren danach nicht mehr: {{notes}}. Archivieren behält eine Kopie.",
	deleteExchangeCited:          "Eine Notiz zitiert diese Antwort – entferne das Zitat dort zuerst, sonst funktioniert ihr Link nicht mehr.",
	anchorFootnotesName:          "Zusammenfassungs-Fußnoten an Notizankern",
	anchorFootnotesDesc:          "Kommt in einem Kapitel, auf das ein Notizanker zeigt, eine Antwort an, wird die Zusammenfassung des Kapitels als Fußnote in diese Notiz geschrieben – so übersteht sie den Druck. Die Zusammenfassung wandert dann mit der Notiz: synchronisiert, geteilt oder veröffentlicht. Aus: Fußnoten entstehen nur mit „Pythia-Fußnoten in dieser Notiz aktualisieren“, und beim Drucken über Schreibstube stehen sie nur im Ausdruck.",
};

export default noteAnchorsDe;
