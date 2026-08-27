// File-size budget guard (ADR-097).
//
// Keeps the codebase's structural discipline from silently regressing: every
// TypeScript source file must stay under DEFAULT_MAX lines, and the two known
// monoliths are grandfathered with explicit ceilings that act as a RATCHET —
// each controller extraction (see engineering-review #119/#120) must LOWER the
// matching number here, never raise it. A new file over the default, or an old
// file grown past its ceiling, fails CI.
//
// Line counts use `wc -l` semantics (number of newline characters).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DEFAULT_MAX = 600;

// Grandfathered ceilings for files that already exceed DEFAULT_MAX. Ratchet these
// DOWN as ADR-097 extractions land; delete an entry once the file drops under
// DEFAULT_MAX on its own.
const CEILINGS = {
	"sidebar.ts": 3735,
	"main.ts": 951,
};

const IGNORE_DIRS = new Set(["node_modules", "coverage", ".git", "scripts"]);

function* walkTsFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (IGNORE_DIRS.has(entry.name)) continue;
			yield* walkTsFiles(join(dir, entry.name));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			yield join(dir, entry.name);
		}
	}
}

function countLines(content) {
	if (content.length === 0) return 0;
	const newlines = content.split("\n").length - 1;
	return content.endsWith("\n") ? newlines : newlines + 1;
}

const violations = [];
for (const file of walkTsFiles(ROOT)) {
	const rel = relative(ROOT, file).split(sep).join("/");
	const lines = countLines(readFileSync(file, "utf8"));
	const ceiling = CEILINGS[rel] ?? DEFAULT_MAX;
	if (lines > ceiling) {
		violations.push({ rel, lines, ceiling, grandfathered: rel in CEILINGS });
	}
}

if (violations.length > 0) {
	console.error("File-size budget exceeded (ADR-097):\n");
	for (const v of violations) {
		const how = v.grandfathered
			? `${v.lines} lines > ratchet ceiling ${v.ceiling} — this file must only shrink`
			: `${v.lines} lines > ${DEFAULT_MAX} — split it, or (last resort) grandfather it in scripts/check-file-size.mjs`;
		console.error(`  ${v.rel}: ${how}`);
	}
	console.error("");
	process.exit(1);
}

console.log("File-size budget OK.");
