#!/usr/bin/env node
//
// What one conversation costs the single-file store (ADR-174).
//
// Pythia keeps every conversation in one data.json and rewrites the whole of it
// after every message, so the cost of a turn is a function of the WHOLE corpus.
// This measures that, plus the startup parse, at several vault sizes — the
// numbers behind `services/storageSize.ts`'s thresholds and behind the
// conversation cap's default.
//
// Same honesty rule as bench-search.mjs and measure-related.mjs: the real
// functions, bundled from the TypeScript sources, never a reimplementation.
// The synthetic conversation matches bench-search.mjs (40 messages x 60 words,
// ~22 KB); a vault of long research conversations weighs more per conversation,
// which is why the shipped thresholds are in BYTES, not conversation counts.
//
// Caveat worth repeating wherever these numbers are quoted: this is Node on a
// development machine. Obsidian desktop is Electron (same engine, some overhead)
// and Obsidian mobile is a webview on a phone CPU — several times slower.
//
// Usage: node scripts/bench-store.mjs [--sizes=200,500,1000,2000,5000]

import { build } from "esbuild";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sizesArg = process.argv.find((a) => a.startsWith("--sizes="));
const SIZES = (sizesArg ? sizesArg.slice(8).split(",") : ["200", "500", "1000", "2000", "5000"]).map(Number);

const outfile = path.join(tmpdir(), `pythia-store-bench-${process.pid}.mjs`);
await build({
	stdin: {
		contents: `export * from "./models/modelPricing";export * from "./services/storageSize";`,
		resolveDir: repoRoot,
		loader: "ts",
	},
	bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const core = await import(pathToFileURL(outfile).href);

const WORDS = "vertrag miete wohnung kündigung frist nebenkosten budget planung projekt team review analyse bericht kunde termin".split(" ");
const word = (n) => WORDS[n % WORDS.length];

function makeConversation(i, messages = 40, wordsPerMessage = 60) {
	return {
		id: `c${i}`,
		name: `Conversation ${word(i)} ${i}`,
		summaryText: `A conversation about ${word(i + 3)}.`,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
		systemPrompt: "",
		contextNotes: [],
		resumeMode: "full",
		provider: "anthropic",
		model: "claude-sonnet-5",
		favorites: [],
		forkedFromId: i % 5 === 0 && i > 0 ? `c${i - 1}` : undefined,
		messages: Array.from({ length: messages }, (_, m) => ({
			id: `m${i}-${m}`,
			role: m % 2 ? "assistant" : "user",
			timestamp: "2026-09-01T10:00:00.000Z",
			model: m % 2 ? "claude-sonnet-5" : undefined,
			tokenUsage: m % 2 ? { inputTokens: 1500, outputTokens: 420 } : undefined,
			content: Array.from({ length: wordsPerMessage }, (_, w) => word(i * 7 + m * 13 + w)).join(" "),
			attachedNotes: m === 0 ? [`Recht/${word(i)}.md`] : undefined,
		})),
	};
}

const median = (fn, runs = 5) => {
	fn(); // warm
	const ts = [];
	for (let r = 0; r < runs; r++) {
		const t0 = performance.now();
		fn();
		ts.push(performance.now() - t0);
	}
	return ts.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

console.log("\nThe single-file store, per vault size\n");
console.log("  vault   data.json   level   rewrite/turn   startup parse   forks+cost");
console.log("  " + "─".repeat(72));
for (const n of SIZES) {
	const convs = Array.from({ length: n }, (_, i) => makeConversation(i));
	const json = JSON.stringify({ settings: {}, conversations: convs });

	const write = median(() => JSON.stringify({ settings: {}, conversations: convs }));
	const read = median(() => JSON.parse(json));
	// What the browse listing does per open since ADR-174: one fork index, and
	// the per-row cost totals when `showCost` is on.
	const list = median(() => {
		const forks = new Map();
		for (const c of convs) {
			if (!c.forkedFromId) continue;
			const siblings = forks.get(c.forkedFromId);
			if (siblings) siblings.push(c);
			else forks.set(c.forkedFromId, [c]);
		}
		for (const c of convs) core.conversationCost(c.messages);
	});

	const level = core.storageLevel(json.length);
	console.log(
		`  ${String(n).padStart(5)}   ${core.formatBytes(json.length).padStart(8)}   ` +
		`${level.padEnd(5)}   ${write.toFixed(1).padStart(9)}ms   ${read.toFixed(1).padStart(11)}ms   ${list.toFixed(1).padStart(8)}ms`
	);
}
console.log("\n  rewrite/turn is paid after EVERY message (whole file), plus the disk write");
console.log("  and, on a synced vault, moving the whole file again.\n");
