#!/usr/bin/env node
//
// Measure the cosine-similarity distribution behind "related conversations"
// (ADR-109), so the scoring constants can be chosen from data instead of taste.
//
// Answers five questions, per model:
//   1. Where do pair scores actually sit?          (percentiles)
//   2. What do 0.2 / 0.35 / 0.5 currently mean?    (counts + results per source)
//   3. Does a typical conversation HAVE a neighbour? (top-1 distribution)
//   4. What floor yields ~5 results per source?     (calibrated replacement)
//   5. Are matches decided by the title+summary lead chunk? (boilerplate check)
// Plus: max-pairwise vs mean-of-top-3, scored on the same pairs.
//
// Runs entirely outside Obsidian: it reads the plugin's data.json, embeds with
// @huggingface/transformers in Node, and imports the REAL chunker and vector
// maths out of the TypeScript sources (bundled on the fly with esbuild) — a
// reimplementation would measure a different system.
//
// Prints numbers only. Conversation text is never written to stdout unless you
// pass --samples.
//
// Usage:
//   node scripts/measure-related.mjs <path-to-data.json> [options]
// See --help.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Model registry (mirrors models/embeddingModels.ts) ───────────────────────
const MODELS = {
	multi: { key: "multi", label: "Multilingual (default)", repoId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2" },
	en: { key: "en", label: "English", repoId: "Xenova/all-MiniLM-L6-v2" },
};

/** The floors shipping today (services/embedding/relatedConversations.ts). */
const PRESETS = { loose: 0.2, balanced: 0.35, strict: 0.5 };

/** The calibration target: a floor is "right" when a typical conversation gets
 *  about this many neighbours. Five is a screenful without scrolling. */
const TARGET_RESULTS_PER_SOURCE = 5;

// ── Arguments ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
	const opts = { dataPath: null, models: ["multi", "en"], json: null, limit: null, maxChars: 500, samples: false };
	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") return { help: true };
		else if (arg === "--samples") opts.samples = true;
		else if (arg.startsWith("--models=")) {
			const v = arg.slice(9);
			opts.models = v === "both" ? ["multi", "en"] : v.split(",").map((s) => s.trim());
		} else if (arg.startsWith("--json=")) opts.json = arg.slice(7);
		else if (arg.startsWith("--limit=")) opts.limit = Number(arg.slice(8));
		else if (arg.startsWith("--max-chars=")) opts.maxChars = Number(arg.slice(12));
		else if (!arg.startsWith("-") && opts.dataPath === null) opts.dataPath = arg;
		else return { error: `unknown argument: ${arg}` };
	}
	for (const m of opts.models) if (!MODELS[m]) return { error: `unknown model '${m}' (use multi, en, or both)` };
	if (!opts.dataPath) return { error: "missing <path-to-data.json>" };
	return opts;
}

const HELP = `
Measure the related-conversations similarity distribution.

  node scripts/measure-related.mjs <path-to-data.json> [options]

  <path-to-data.json>   <vault>/.obsidian/plugins/pythia/data.json — use a COPY

Options
  --models=both|multi|en   Which model(s) to measure          (default: both)
  --limit=N                Use only the N most recent conversations
  --max-chars=N            Chunk size, must match the plugin  (default: 500)
  --json=FILE              Also write the raw numbers, for diffing runs
  --samples                Print the text of the top matches  (off by default)
  -h, --help               This text

First run downloads the model(s) from HuggingFace (~50-120 MB each), cached
afterwards under ~/.cache/huggingface.
`;

// ── Load the real chunker + vector maths from the TypeScript sources ─────────
async function loadCore(repoRoot) {
	let esbuild;
	try {
		esbuild = await import("esbuild");
	} catch {
		throw new Error("esbuild not found — run this from the pythia repo after `npm install`");
	}
	const outfile = path.join(tmpdir(), `pythia-embed-core-${process.pid}.mjs`);
	await esbuild.build({
		stdin: {
			contents: `
				export { conversationChunks } from "./services/embedding/conversationText";
				export { quantize, cosine } from "./services/embedding/vectorMath";
			`,
			resolveDir: repoRoot,
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		outfile,
		logLevel: "silent",
	});
	return import(pathToFileURL(outfile).href);
}

// ── Statistics ───────────────────────────────────────────────────────────────
/** Nearest-rank percentile of an ASCENDING-sorted array. */
function pct(sortedAsc, p) {
	if (sortedAsc.length === 0) return NaN;
	const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
	return sortedAsc[i];
}
const median = (sortedAsc) => pct(sortedAsc, 50);
const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

/** Median number of results a source gets at `floor`. */
function medianResultsPerSource(neighbours, floor) {
	const counts = neighbours.map((row) => row.reduce((n, s) => n + (s >= floor ? 1 : 0), 0)).sort((a, b) => a - b);
	return median(counts);
}

/** The floor whose median results-per-source is closest to the target, scanned
 *  over the plausible cosine range. Coarse on purpose: a floor that needs three
 *  decimals to be right is a floor that will not survive a different vault. */
function calibrateFloor(neighbours, target) {
	let best = null;
	for (let f = 0.05; f <= 0.95; f += 0.01) {
		const m = medianResultsPerSource(neighbours, f);
		const distance = Math.abs(m - target);
		if (best === null || distance < best.distance) best = { floor: Math.round(f * 100) / 100, median: m, distance };
	}
	return best;
}

// ── Embedding ────────────────────────────────────────────────────────────────
async function embedAll(repoId, texts, onProgress) {
	const { pipeline } = await import("@huggingface/transformers");
	const extract = await pipeline("feature-extraction", repoId);
	const vectors = [];
	const BATCH = 16;
	for (let i = 0; i < texts.length; i += BATCH) {
		const batch = texts.slice(i, i + BATCH);
		const out = await extract(batch, { pooling: "mean", normalize: false });
		const dim = out.dims[out.dims.length - 1];
		const data = out.data;
		for (let r = 0; r < batch.length; r++) {
			vectors.push(Float32Array.from(data.slice(r * dim, (r + 1) * dim)));
		}
		onProgress(Math.min(i + BATCH, texts.length), texts.length);
	}
	return vectors;
}

// ── One model's measurement ──────────────────────────────────────────────────
async function measureModel(model, docs, core, opts) {
	const flatTexts = docs.flatMap((d) => d.chunks);
	process.stderr.write(`\n${model.label} — ${model.repoId}\n`);
	process.stderr.write(`  embedding ${flatTexts.length} chunks from ${docs.length} conversations…\n`);

	const startedAt = Date.now();
	let lastPct = -1;
	const raw = await embedAll(model.repoId, flatTexts, (done, total) => {
		const p = Math.floor((done / total) * 100);
		if (p !== lastPct && p % 10 === 0) {
			process.stderr.write(`  ${p}%\r`);
			lastPct = p;
		}
	});
	const elapsedMs = Date.now() - startedAt;
	const dim = raw[0]?.length ?? 0;

	// Quantize with the plugin's own function so Int8 rounding is measured too.
	const quantized = raw.map((v) => core.quantize(v));
	let cursor = 0;
	const byDoc = docs.map((d) => {
		const vecs = quantized.slice(cursor, cursor + d.chunks.length);
		cursor += d.chunks.length;
		return { ...d, vecs };
	});

	// All pairs: max-pairwise, mean-of-top-3, and which chunks won.
	const pairScores = [];
	const neighbours = byDoc.map(() => []);       // per source: every score to others
	const neighboursTop3 = byDoc.map(() => []);
	const bestPerSource = byDoc.map(() => null);  // ranked by max
	const bestPerSourceTop3 = byDoc.map(() => null);
	let leadBoth = 0, leadEither = 0, winners = 0;

	for (let i = 0; i < byDoc.length; i++) {
		for (let j = i + 1; j < byDoc.length; j++) {
			const a = byDoc[i], b = byDoc[j];
			let max = -Infinity, ai = -1, bi = -1;
			const all = [];
			for (let x = 0; x < a.vecs.length; x++) {
				for (let y = 0; y < b.vecs.length; y++) {
					const s = core.cosine(a.vecs[x], b.vecs[y]);
					all.push(s);
					if (s > max) { max = s; ai = x; bi = y; }
				}
			}
			all.sort((p, q) => q - p);
			const top3 = all.slice(0, Math.min(3, all.length));
			const mean3 = top3.reduce((t, s) => t + s, 0) / top3.length;

			pairScores.push(max);
			neighbours[i].push(max); neighbours[j].push(max);
			neighboursTop3[i].push(mean3); neighboursTop3[j].push(mean3);

			// Chunk 0 is the lead chunk: title + LLM summary.
			winners++;
			if (ai === 0 && bi === 0) leadBoth++;
			if (ai === 0 || bi === 0) leadEither++;

			for (const [idx, other] of [[i, j], [j, i]]) {
				if (!bestPerSource[idx] || max > bestPerSource[idx].score) {
					bestPerSource[idx] = { score: max, otherIdx: other, aChunk: idx === i ? ai : bi, bChunk: idx === i ? bi : ai };
				}
				if (!bestPerSourceTop3[idx] || mean3 > bestPerSourceTop3[idx].score) {
					bestPerSourceTop3[idx] = { score: mean3, otherIdx: other };
				}
			}
		}
	}

	const sorted = [...pairScores].sort((a, b) => a - b);
	const top1 = bestPerSource.map((b) => (b ? b.score : -1)).filter((s) => s >= -1).sort((a, b) => a - b);

	// Does ranking by mean-of-top-3 change who the #1 neighbour is?
	let rankChanged = 0;
	for (let i = 0; i < byDoc.length; i++) {
		if (bestPerSource[i] && bestPerSourceTop3[i] && bestPerSource[i].otherIdx !== bestPerSourceTop3[i].otherIdx) rankChanged++;
	}

	const presetStats = Object.fromEntries(
		Object.entries(PRESETS).map(([name, floor]) => [
			name,
			{
				floor,
				pairsAbove: pairScores.reduce((n, s) => n + (s >= floor ? 1 : 0), 0),
				pairsAbovePct: r1((pairScores.filter((s) => s >= floor).length / Math.max(1, pairScores.length)) * 100),
				medianResultsPerSource: medianResultsPerSource(neighbours, floor),
				sourcesWithNoResults: neighbours.reduce((n, row) => n + (row.some((s) => s >= floor) ? 0 : 1), 0),
			},
		])
	);

	return {
		model: model.key,
		label: model.label,
		repoId: model.repoId,
		dim,
		conversations: byDoc.length,
		chunks: flatTexts.length,
		chunksPerConversation: r3(flatTexts.length / Math.max(1, byDoc.length)),
		embedSeconds: Math.round(elapsedMs / 100) / 10,
		pairs: pairScores.length,
		percentiles: { p50: r3(pct(sorted, 50)), p75: r3(pct(sorted, 75)), p90: r3(pct(sorted, 90)), p95: r3(pct(sorted, 95)), p99: r3(pct(sorted, 99)), max: r3(sorted[sorted.length - 1]) },
		top1: { p10: r3(pct(top1, 10)), p25: r3(pct(top1, 25)), p50: r3(pct(top1, 50)), p75: r3(pct(top1, 75)), p90: r3(pct(top1, 90)) },
		presets: presetStats,
		calibrated: calibrateFloor(neighbours, TARGET_RESULTS_PER_SOURCE),
		leadChunk: {
			bothLeadPct: r1((leadBoth / Math.max(1, winners)) * 100),
			eitherLeadPct: r1((leadEither / Math.max(1, winners)) * 100),
		},
		top3: {
			topNeighbourChanged: rankChanged,
			topNeighbourChangedPct: r1((rankChanged / Math.max(1, byDoc.length)) * 100),
		},
		_samples: opts.samples
			? bestPerSource.slice(0, 5).map((b, i) => b && {
				source: byDoc[i].name,
				match: byDoc[b.otherIdx].name,
				score: r3(b.score),
				sourceChunk: byDoc[i].chunks[b.aChunk]?.slice(0, 160),
				matchChunk: byDoc[b.otherIdx].chunks[b.bChunk]?.slice(0, 160),
			}).filter(Boolean)
			: undefined,
	};
}

// ── Report ───────────────────────────────────────────────────────────────────
function report(results) {
	const line = (s = "") => process.stdout.write(`${s}\n`);
	const f = (n) => (n === null || n === undefined || Number.isNaN(n) ? "  —  " : n.toFixed(3));

	line();
	line("═".repeat(72));
	line(" RELATED CONVERSATIONS — similarity distribution");
	line("═".repeat(72));

	for (const r of results) {
		line();
		line(`── ${r.label} · ${r.repoId}`);
		line(`   ${r.conversations} conversations · ${r.chunks} chunks (${r.chunksPerConversation}/conv) · ${r.dim}-dim · ${r.pairs} pairs · ${r.embedSeconds}s`);
		line();
		line("   Pair scores (max-pairwise cosine)");
		line(`     p50 ${f(r.percentiles.p50)}   p75 ${f(r.percentiles.p75)}   p90 ${f(r.percentiles.p90)}   p95 ${f(r.percentiles.p95)}   p99 ${f(r.percentiles.p99)}   max ${f(r.percentiles.max)}`);
		line();
		line("   Best neighbour per conversation");
		line(`     p10 ${f(r.top1.p10)}   p25 ${f(r.top1.p25)}   p50 ${f(r.top1.p50)}   p75 ${f(r.top1.p75)}   p90 ${f(r.top1.p90)}`);
		line();
		line("   What the shipping presets do here");
		line("     preset      floor   pairs above        median results/source   sources with none");
		for (const [name, p] of Object.entries(r.presets)) {
			line(`     ${name.padEnd(10)}  ${f(p.floor)}   ${String(p.pairsAbove).padStart(7)} (${String(p.pairsAbovePct).padStart(5)}%)   ${String(p.medianResultsPerSource).padStart(19)}   ${String(p.sourcesWithNoResults).padStart(15)}`);
		}
		line();
		const missed = Math.abs(r.calibrated.median - TARGET_RESULTS_PER_SOURCE) > 2;
		line(`   Calibrated floor for ~${TARGET_RESULTS_PER_SOURCE} results/source:  ${f(r.calibrated.floor)}  (median ${r.calibrated.median})`);
		if (missed) {
			line("     ⚠ the scan could not reach the target — scores are bunched, so NO floor");
			line("       separates related from unrelated here. Treat this run as inconclusive.");
		}
		line();
		line("   Boilerplate check — is the match decided by the title+summary lead chunk?");
		line(`     both sides lead chunk: ${r.leadChunk.bothLeadPct}%   either side: ${r.leadChunk.eitherLeadPct}%`);
		line();
		line("   Max-pairwise vs mean-of-top-3");
		line(`     #1 neighbour changes for ${r.top3.topNeighbourChanged} of ${r.conversations} conversations (${r.top3.topNeighbourChangedPct}%)`);
		if (r._samples?.length) {
			line();
			line("   Top matches (--samples)");
			for (const s of r._samples) {
				line(`     ${f(s.score)}  ${s.source}  ⟷  ${s.match}`);
				line(`            src: ${s.sourceChunk}`);
				line(`            hit: ${s.matchChunk}`);
			}
		}
	}

	if (results.length === 2) {
		const [a, b] = results;
		const gap = Math.abs(a.percentiles.p90 - b.percentiles.p90);
		line();
		line("═".repeat(72));
		line(" VERDICT");
		line("═".repeat(72));
		line(`  p90 gap between models: ${f(gap)}`);
		line(gap > 0.05
			? "  → PER-MODEL FLOORS ARE JUSTIFIED. One shared constant means two different"
			: "  → One shared constant is defensible on this vault (gap ≤ 0.05).");
		if (gap > 0.05) line("    things depending on which model the dropdown selects.");
		line(`  calibrated floors:  ${a.model} ${f(a.calibrated.floor)}   ${b.model} ${f(b.calibrated.floor)}   (shipping default: 0.350)`);
		const leadWorst = Math.max(a.leadChunk.bothLeadPct, b.leadChunk.bothLeadPct);
		line(`  lead-chunk-decided matches (worst model): ${leadWorst}%`);
		line(leadWorst > 30
			? "  → TOP-K MEAN IS JUSTIFIED. Generated summaries are matching each other's register."
			: "  → Max-pairwise is not obviously boilerplate-driven here.");
		line();
	}
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) { process.stdout.write(HELP); return; }
	if (opts.error) { process.stderr.write(`error: ${opts.error}\n${HELP}`); process.exitCode = 1; return; }
	if (!existsSync(opts.dataPath)) { process.stderr.write(`error: no such file: ${opts.dataPath}\n`); process.exitCode = 1; return; }

	// fileURLToPath, never `new URL(...).pathname`: the URL form is percent-encoded,
	// so a checkout under "Mobile Documents" resolves to a "Mobile%20Documents"
	// directory that does not exist and esbuild cannot resolve anything from it.
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const core = await loadCore(repoRoot);

	const parsed = JSON.parse(await readFile(opts.dataPath, "utf8"));
	let conversations = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
	if (conversations.length === 0) { process.stderr.write("error: data.json has no conversations\n"); process.exitCode = 1; return; }
	conversations.sort((a, b) => String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")));
	if (opts.limit) conversations = conversations.slice(0, opts.limit);
	if (conversations.length < 2) { process.stderr.write("error: need at least 2 conversations\n"); process.exitCode = 1; return; }

	const docs = conversations.map((c) => ({
		id: String(c?.id ?? ""),
		name: typeof c?.name === "string" ? c.name : "(unnamed)",
		chunks: core.conversationChunks(c, opts.maxChars),
	}));

	const results = [];
	for (const key of opts.models) results.push(await measureModel(MODELS[key], docs, core, opts));

	report(results);

	if (opts.json) {
		await writeFile(opts.json, `${JSON.stringify({ measuredAt: new Date().toISOString(), maxChars: opts.maxChars, results }, null, 2)}\n`);
		process.stderr.write(`\nwrote ${opts.json}\n`);
	}
}

main().catch((e) => {
	process.stderr.write(`\nfailed: ${e?.stack ?? e}\n`);
	process.exitCode = 1;
});
