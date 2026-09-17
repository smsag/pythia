#!/usr/bin/env node
//
// Per-keystroke cost of the conversation search panel (ADR-170).
//
// The panel re-scores the corpus and re-renders on every keystroke, so its cost
// is the thing a user feels while typing. This measures it on a synthetic corpus
// at three vault sizes, with the REAL search functions (bundled from the
// TypeScript sources by esbuild) — the same honesty rule as
// scripts/measure-related.mjs: a reimplementation would measure something else.
//
// Numbers that motivated ADR-170, before the fix, on 500 conversations:
//   rank 0.8ms | snippets 398.1ms  →  snippets were 99% of a keystroke.
// After: snippets are bounded by SEARCH_RESULT_LIMIT and their line tokens are
// cached on the fields, so a keystroke is ~1ms.
//
// Usage: node scripts/bench-search.mjs [--sizes=24,200,500]

import { build } from "esbuild";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sizesArg = process.argv.find((a) => a.startsWith("--sizes="));
const SIZES = (sizesArg ? sizesArg.slice(8).split(",") : ["24", "200", "500"]).map(Number);

const outfile = path.join(tmpdir(), `pythia-search-bench-${process.pid}.mjs`);
await build({
	stdin: { contents: `export * from "./services/conversationSearch";`, resolveDir: repoRoot, loader: "ts" },
	bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const core = await import(pathToFileURL(outfile).href);

const WORDS = "vertrag miete wohnung kündigung frist nebenkosten budget planung projekt team review analyse bericht kunde termin".split(" ");
const word = (n) => WORDS[n % WORDS.length];

/** A conversation of roughly the shape a real one has: ~23 chunks' worth of
 *  prose across 40 turns, one attached note, a summary. */
function makeConversation(i, messages = 40, wordsPerMessage = 60) {
	return {
		id: `c${i}`,
		name: `Conversation ${word(i)} ${i}`,
		summaryText: `A conversation about ${word(i + 3)}.`,
		updatedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
		messages: Array.from({ length: messages }, (_, m) => ({
			id: `m${i}-${m}`,
			role: m % 2 ? "assistant" : "user",
			content: Array.from({ length: wordsPerMessage }, (_, w) => word(i * 7 + m * 13 + w))
				.join(" ")
				.replace(/((?:\S+ ){8})/g, "$1\n"),
			attachedNotes: m === 0 ? [`Recht/${word(i)}.md`] : undefined,
		})),
	};
}

const QUERIES = ["v", "ve", "ver", "vert", "vertrag"];

console.log("\nConversation search — cost of one keystroke\n");
console.log("  vault    fields(once)   rank    snippets    rows    TOTAL/keystroke");
console.log("  " + "─".repeat(68));

for (const n of SIZES) {
	const conversations = Array.from({ length: n }, (_, i) => makeConversation(i));

	let t = performance.now();
	const fields = conversations.map(core.buildConversationFields);
	const buildMs = performance.now() - t;

	// Type the query one character at a time, as the panel does, and take the
	// worst keystroke — the average hides the one that drops a frame.
	let worst = { rank: 0, snippet: 0, rows: 0, total: 0 };
	for (const q of QUERIES) {
		t = performance.now();
		const outcome = core.searchConversations(q, conversations, fields);
		const rank = performance.now() - t;

		const rows = [...outcome.primary, ...outcome.widened];
		t = performance.now();
		for (const r of rows) {
			core.bestMatchSnippet(outcome.queryTokens, r.conversation, fields[conversations.indexOf(r.conversation)]);
		}
		const snippet = performance.now() - t;
		if (rank + snippet > worst.total) worst = { rank, snippet, rows: rows.length, total: rank + snippet };
	}

	const ms = (v) => `${v.toFixed(1)}ms`.padStart(8);
	console.log(
		`  ${String(n).padStart(5)}  ${ms(buildMs)}     ${ms(worst.rank)}  ${ms(worst.snippet)}  ${String(worst.rows).padStart(6)}  ${ms(worst.total)}`
	);
}

console.log("\n  fields(once) is paid on panel open; the rest on every keystroke.");
console.log("  A keystroke over ~16ms drops a frame on a 60Hz display.\n");
