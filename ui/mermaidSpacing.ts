/**
 * Mermaid lays a diagram out sparsely (50px between nodes and ranks), and in
 * a sidebar at a readable size that spacing is most of what shows. Tighter
 * spacing shrinks the drawing without shrinking its text: the reported
 * flowchart 1051 × 770 → 783 × 611, a sequence diagram 878 → 708 wide
 * (Mermaid 11, measured — ADR-245).
 *
 * Display only: applied on the way into the renderer, never to the stored
 * message, so a copy, a saved note and the archive keep the source as written.
 * A block that already configures itself (`%%{init…}%%` or frontmatter) is
 * left as it is — the author's spacing wins.
 */
export const COMPACT_MERMAID_INIT =
	'%%{init: {"flowchart": {"nodeSpacing": 30, "rankSpacing": 35, "padding": 8}, '
	+ '"sequence": {"actorMargin": 20, "messageMargin": 20, "boxMargin": 5, "diagramMarginX": 10, "diagramMarginY": 5}}}%%';

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})\s*mermaid\s*$/i;

export function compactMermaid(md: string): string {
	if (!/mermaid/i.test(md)) return md; // the common case: nothing to do
	const lines = md.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i]);
		const open = FENCE_OPEN.exec(lines[i]);
		if (!open) continue;
		const first = lines.slice(i + 1).find((l) => l.trim() !== "")?.trim() ?? "";
		if (first.startsWith("%%{") || first === "---") continue;
		out.push(open[1] + COMPACT_MERMAID_INIT);
	}
	return out.join("\n");
}
