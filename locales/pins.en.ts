// Pinned answer content (ADR-216). Split per feature, as locales/chart.*.ts is —
// merged into the table by `en.ts`, so `t()` and the `Strings` type are
// unchanged. `pins.de.ts` must name the same keys.

const pinsEn = {
	pinBtn:            "Pin",
	pinTooltip:        "Pin to the top of the conversation",
	pinNotYet:         "The answer is still being written — pin it once it is finished.",
	pinLimit:          "{{limit}} pins is the most a conversation keeps — unpin one first.",
	pinTooLong:        "Too long to pin: {{chars}} characters, at most {{max}}.",
	pinGone:           "The pinned passage is no longer in this conversation.",
	pinKindText:       "Text",
	pinKindCode:       "Code",
	pinKindDiagram:    "Diagram",
	pinKindChart:      "Chart",
	pinKindTable:      "Table",
	pinPrevTooltip:    "Previous pin",
	pinNextTooltip:    "Next pin",
	pinCount:          "{{n}}/{{m}}",
	pinCopyTooltip:    "Copy",
	pinJumpTooltip:    "Go to the source in the conversation",
	pinRemoveTooltip:  "Unpin",
	tableCopyTooltip:  "Copy the table as Markdown",
};

export default pinsEn;
