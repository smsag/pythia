// Charts in an answer (ADR-210). Split per feature, as locales/embedding.*.ts
// and locales/settings.*.ts are — merged into the table by `en.ts`, so `t()` and
// the `Strings` type are unchanged. `chart.de.ts` must name the same keys.
//
// One deliberate absence: the chart PARSER's error strings are not here. They go
// back to the model in a tool result and into bug reports, exactly like every
// other "Error: …" in ToolHandler.ts, so they stay English and canonical. The
// error card shows `chartInvalidTitle` above them in the user's language.

const chartEn = {
	chartTypeBar:            "Bar chart",
	chartTypeLine:           "Line chart",
	chartTypePie:            "Pie chart",
	chartSourcesLabel:       "Sources:",
	chartCopyImageTooltip:   "Copy the chart as an image — paste it into a document",
	chartCopySourceTooltip:  "Copy the chart's source block",
	chartImageCopyFallback:  "This device would not take an image. The chart's source block was copied instead.",
	chartInvalidTitle:       "This chart could not be drawn",
};

export default chartEn;
