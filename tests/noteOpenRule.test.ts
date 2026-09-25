import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * `workspace.openLinkText` on a name that does not resolve CREATES that note
 * (ADR-218): a tap meant to show what Pythia wrote made an empty page instead.
 * Notes are opened through `ui/noteLinks.ts` (`openNotePath`, `onNoteLinkClick`),
 * which open what resolves or say it is gone. This fails on a new call site.
 */
const ALLOWED = new Set([
	"ui/noteLinks.ts",          // resolves the link first, then opens it
	"ui/GlossaryController.ts", // opens pathFor(entry) of an entry it has just read from that note
]);

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", "tests", "coverage", ".git", "scripts", ".claude"]);

function* sources(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* sources(path);
		else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) yield path;
	}
}

describe("notes are opened by what resolves (ADR-218 addendum)", () => {
	it("nothing outside the allow-list calls openLinkText", () => {
		const offenders = [...sources(ROOT)]
			.map((path) => relative(ROOT, path).split(sep).join("/"))
			.filter((rel) => !ALLOWED.has(rel) && /\bopenLinkText\s*\(/.test(readFileSync(join(ROOT, rel), "utf8")));
		expect(offenders).toEqual([]);
	});
});
