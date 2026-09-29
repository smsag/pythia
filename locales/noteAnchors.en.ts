// Note anchors: a passage in a note linked to a conversation or one chapter of
// it, its hover card, its footnote and the commands around it (ADR-249).
// Merged into the table by `en.ts`; `noteAnchors.de.ts` must name the same keys.
// The footnote's own words are NOT here: they are document text in the
// summary's language, not interface text (services/anchorFootnotes.ts).

const noteAnchorsEn = {
	chapterNotFound:              "Pythia: that chapter is no longer in the conversation — it opened at the top instead.",
	copyChapterLink:              "Copy link to this chapter",
	chapterLinkCopied:            "Chapter link copied. Paste it into a note, or select text there and choose “Link selection to {{name}}”.",
	cmdLinkSelectionToChapter:    "Link selection to the copied chapter",
	linkSelectionToNamed:         "Link selection to {{name}}",
	noChapterCopied:              "Copy a chapter link in Pythia first — the link icon above a message, or a chapter in the # navigator.",
	cmdStartLinkedConversation:   "Start a linked conversation from selection",
	anchorSelectionEmpty:         "Select the text the link should sit on first.",
	anchorSelectionMultiline:     "A link can sit on text within one line only — select less.",
	anchorSelectionMarkup:        "The selection already holds a link, code, a highlight, a footnote or part of a formatting mark — select plain text.",
	anchorSelectionChanged:       "The note changed before the link was written — nothing was changed.",
	anchorLinked:                 "Linked to {{name}}.",
	cmdUpdateFootnotes:           "Update Pythia footnotes in this note",
	footnotesNoAnchors:           "This note has no links to Pythia conversations.",
	footnotesUpdated:             "Pythia footnotes updated ({{count}} summaries refreshed).",
	footnotesRefreshFailed:       "{{count}} summaries could not be written: {{reasons}}",
	footnotesRefreshLimit:        "more than {{max}} at once",
	footnotesRefreshEmpty:        "the model sent no text",
	footnotesRefreshGone:         "the chapter changed while it was summarized",
	footnotesRefreshError:        "the request failed (details in the console with debug mode on)",
	refreshingForExport:          "Pythia: updating {{count}} summaries for printing…",
	noteAnchorLabel:              "NOTE ANCHOR",
	noteAnchorNoSummary:          "No summary yet — ↻ writes one.",
	noteAnchorUnanswered:         "No answer yet, so nothing to summarize.",
	noteAnchorDeleted:            "This conversation was deleted.",
	noteAnchorRefresh:            "Write the summary again",
	anchorFootnotesName:          "Summary footnotes on note anchors",
	anchorFootnotesDesc:          "When an answer arrives in a chapter a note anchor points at, write the chapter's summary into that note as a footnote, so it survives printing. The summary then travels with the note — synced, shared or published. Off: footnotes are written only when you run “Update Pythia footnotes in this note”, and printing through Schreibstube adds them to the printout alone.",
};

export default noteAnchorsEn;
