#!/usr/bin/env node
//
// What a vault rename costs the stored paths (ADR-218 addendum).
//
// Obsidian reports a folder rename for the folder AND (assumed, not measured
// here) for every file inside it. ADR-218 scanned every conversation per
// event; the addendum batches a burst into one scan. This measures both
// shapes on a synthetic corpus: one event per file (the old behaviour, one
// scan each) and the whole burst at once (the batch).
//
// Same honesty rule as bench-store.mjs: the real functions, bundled from the
// TypeScript sources. Node on a development machine — Obsidian mobile is a
// webview on a phone CPU, several times slower.
//
// Usage: node scripts/bench-rename.mjs [--conversations=5000] [--messages=30] [--files=500]

import { build } from "esbuild";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
	const a = process.argv.find((x) => x.startsWith(`--${name}=`));
	return a ? Number(a.split("=")[1]) : fallback;
};
const CONVERSATIONS = arg("conversations", 5000);
const MESSAGES = arg("messages", 30);
const FILES = arg("files", 500);

const outfile = path.join(tmpdir(), `pythia-rename-bench-${process.pid}.mjs`);
await build({
	stdin: { contents: `export * from "./services/renameVaultPath";`, resolveDir: repoRoot, loader: "ts" },
	bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const { renameVaultPaths } = await import(pathToFileURL(outfile).href);

function corpus() {
	const convs = [];
	for (let i = 0; i < CONVERSATIONS; i++) {
		const messages = [];
		for (let j = 0; j < MESSAGES; j++) {
			messages.push({
				id: `${i}-${j}`, role: j % 2 ? "assistant" : "user", content: "x", timestamp: "t",
				attachedNotes: [`Notes/n${j}.md`],
				sources: [{ n: 1, kind: "vault", ref: `Notes/n${j}.md`, title: `n${j}` }],
			});
		}
		convs.push({ id: `c${i}`, contextNotes: [`Projects/Q3/f${i % FILES}.md`, `Notes/b${i}.md`], messages, templateId: "T/t.md" });
	}
	return convs;
}

const burst = [{ from: "Projects/Q3", to: "Projects/2026-Q3" }];
for (let f = 0; f < FILES; f++) burst.push({ from: `Projects/Q3/f${f}.md`, to: `Projects/2026-Q3/f${f}.md` });

let convs = corpus();
let t0 = performance.now();
for (const pair of burst) renameVaultPaths(convs, [pair]);
const perEvent = performance.now() - t0;

convs = corpus();
t0 = performance.now();
renameVaultPaths(convs, burst);
const batched = performance.now() - t0;

console.log(`corpus: ${CONVERSATIONS} conversations x ${MESSAGES} messages; folder of ${FILES} files (${burst.length} events)`);
console.log(`one scan per event (ADR-218):     ${perEvent.toFixed(0)} ms`);
console.log(`one scan per burst (addendum):    ${batched.toFixed(1)} ms`);

// The everyday case: one note renamed, nothing else in the burst.
convs = corpus();
t0 = performance.now();
for (let k = 0; k < 20; k++) renameVaultPaths(convs, [{ from: `Other/x${k}.md`, to: `Other/y${k}.md` }]);
console.log(`one note renamed (no match):      ${((performance.now() - t0) / 20).toFixed(1)} ms`);
