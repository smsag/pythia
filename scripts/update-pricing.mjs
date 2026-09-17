#!/usr/bin/env node
// Rewrites the GENERATED block of models/modelPricing.ts from models.dev
// (ADR-163). Run by `npm run update:pricing` — locally before a release, or by
// .github/workflows/update-pricing.yml, which opens a pull request when the
// table changed. Prices never reach users through a fetch at build or run
// time: every change is a diff a human reads.
//
// Fails loudly (exit 1) on anything it cannot prove: an unexpected upstream
// schema, or a catalog model with no upstream row. It never drops a row
// silently — fix the mapping in UPSTREAM_IDS instead.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export const SOURCE_URL = "https://models.dev/api.json";

/** Pythia provider key → models.dev provider id. */
export const UPSTREAM_PROVIDERS = { anthropic: "anthropic", openai: "openai", mistral: "mistral" };

/** Catalog model id → models.dev model id, where they differ. A model that is
 *  not listed here is looked up under its own id. */
export const UPSTREAM_IDS = {
	"magistral-small-latest": "magistral-small",
};

/** Catalog models models.dev does not list. Their committed row is kept as
 *  is and the run says so — the built-in value is an assumption (Opus-tier
 *  for the hidden Mythos entry), which the disclaimer already covers. A model
 *  belongs here only after a run has shown it missing upstream; it is never
 *  a way to silence a renamed id. */
export const NO_UPSTREAM = new Set(["claude-mythos-5"]);

/** The catalog: `{ id, provider }` per model — hidden ones included, since a
 *  conversation can still be on one — read from the source of truth so this
 *  script cannot drift from it. */
export function readCatalog(source) {
	const rows = [];
	const re = /\{\s*id:\s*"([^"]+)",\s*provider:\s*"([^"]+)"/g;
	for (const m of source.matchAll(re)) rows.push({ id: m[1], provider: m[2] });
	if (rows.length === 0) throw new Error("readCatalog: no models found in knownModels.ts");
	return rows;
}

/** Pull `{ input, output, cacheRead?, cacheWrite? }` per catalog model from
 *  the upstream document. Throws with every unmapped model listed, plus
 *  nearby upstream ids as a hint, so one run tells you the whole fix. */
export function buildTable(upstream, catalog, ids = UPSTREAM_IDS, noUpstream = NO_UPSTREAM) {
	if (!upstream || typeof upstream !== "object") throw new Error("upstream is not an object");
	const table = {};
	const missing = [];
	for (const { id, provider } of catalog) {
		if (noUpstream.has(id)) continue;
		const upProvider = upstream[UPSTREAM_PROVIDERS[provider]];
		const models = upProvider?.models;
		if (!models || typeof models !== "object") {
			throw new Error(`upstream has no models for provider "${UPSTREAM_PROVIDERS[provider]}" — schema changed?`);
		}
		const upId = ids[id] ?? id;
		const row = models[upId];
		const cost = row?.cost;
		if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
			const stem = id.split(/[-.]/).filter((t) => t.length > 2)[0] ?? id;
			const near = Object.keys(models).filter((k) => k.includes(stem)).slice(0, 6);
			missing.push(`${id} (${provider})${near.length ? ` — upstream has: ${near.join(", ")}` : ""}`);
			continue;
		}
		const entry = { input: cost.input, output: cost.output };
		if (typeof cost.cache_read === "number") entry.cacheRead = cost.cache_read;
		if (typeof cost.cache_write === "number") entry.cacheWrite = cost.cache_write;
		table[id] = entry;
	}
	if (missing.length) {
		throw new Error(`No upstream price for ${missing.length} catalog model(s). Add a mapping to UPSTREAM_IDS in scripts/update-pricing.mjs:\n  ${missing.join("\n  ")}`);
	}
	return table;
}

/** The rows currently committed in modelPricing.ts — the source for models
 *  models.dev does not list, and the round-trip test's input. */
export function readCommittedTable(source) {
	const table = {};
	for (const m of source.matchAll(/^\t"([^"]+)":\s*\{([^}]*)\},/gm)) {
		const entry = {};
		for (const f of m[2].matchAll(/(\w+):\s*([\d.]+)/g)) entry[f[1]] = Number(f[2]);
		table[m[1]] = entry;
	}
	return table;
}

const PROVIDER_HEADINGS = { anthropic: "Anthropic", openai: "OpenAI", mistral: "Mistral" };

export function fmt(n) {
	// The last gate between models.dev and shipped source. The path above is
	// already narrow — model ids come from the LOCAL catalog, never upstream, and
	// `toFixed` throws on a string or an object, so a hostile payload cannot reach
	// this line as anything but a number. What it CAN reach as is NaN or Infinity,
	// and `fmt(NaN)` emits `input: NaN`, which is valid TypeScript, compiles, and
	// ships a price table nobody can read a number out of. Integrity rather than
	// execution, but the fix is the same shape as every other boundary in this
	// codebase: refuse, loudly, where the value enters (principle 1).
	if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
		throw new Error(`upstream price is not a usable number: ${JSON.stringify(n)}`);
	}
	// Up to 4 decimals, no trailing zeros, never exponent notation.
	return Number(n.toFixed(4)).toString();
}

/** The TypeScript text between the GENERATED markers. */
export function renderTable(table, catalog, asOf) {
	const lines = [`export const PRICING_AS_OF = "${asOf}";`, "", "export const MODEL_PRICING: Record<string, ModelPricing> = {"];
	let first = true;
	for (const provider of Object.keys(PROVIDER_HEADINGS)) {
		const rows = catalog.filter((m) => m.provider === provider && table[m.id]);
		if (!rows.length) continue;
		if (!first) lines.push("");
		first = false;
		lines.push(`\t// ── ${PROVIDER_HEADINGS[provider]} ${"─".repeat(Math.max(0, 70 - PROVIDER_HEADINGS[provider].length))}`);
		const width = Math.max(...rows.map((m) => m.id.length + 3));
		for (const m of rows) {
			const p = table[m.id];
			const fields = [`input: ${fmt(p.input)}`, `output: ${fmt(p.output)}`];
			if (p.cacheRead !== undefined) fields.push(`cacheRead: ${fmt(p.cacheRead)}`);
			if (p.cacheWrite !== undefined) fields.push(`cacheWrite: ${fmt(p.cacheWrite)}`);
			lines.push(`\t${`"${m.id}":`.padEnd(width)} { ${fields.join(", ")} },`);
		}
	}
	lines.push("};");
	return lines.join("\n");
}

const BEGIN = "// BEGIN GENERATED PRICES";
const END = "// END GENERATED PRICES";

/** Replace the block between the markers, keeping the marker lines. */
export function spliceGenerated(source, block) {
	const b = source.indexOf(BEGIN);
	const e = source.indexOf(END);
	if (b === -1 || e === -1 || e < b) throw new Error("GENERATED markers not found in modelPricing.ts");
	const beginLineEnd = source.indexOf("\n", b) + 1;
	return source.slice(0, beginLineEnd) + block + "\n" + source.slice(e);
}

async function main() {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const catalog = readCatalog(readFileSync(resolve(root, "models/knownModels.ts"), "utf8"));
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`${SOURCE_URL} → HTTP ${res.status}`);
	const upstream = await res.json();
	const table = buildTable(upstream, catalog);
	const asOf = new Date().toISOString().slice(0, 10);
	const file = resolve(root, "models/modelPricing.ts");
	const before = readFileSync(file, "utf8");
	const committed = readCommittedTable(before);
	for (const id of NO_UPSTREAM) {
		if (!committed[id]) throw new Error(`${id} is in NO_UPSTREAM but has no committed row to keep`);
		table[id] = committed[id];
		console.warn(`update-pricing: ${id} is not listed on models.dev — committed row kept (built-in assumption)`);
	}
	const after = spliceGenerated(before, renderTable(table, catalog, asOf));
	// Only the date changed → nothing to report; keep the old date so a
	// no-op run does not produce a diff.
	const sameTable = spliceGenerated(before, renderTable(table, catalog, /PRICING_AS_OF = "([^"]+)"/.exec(before)?.[1] ?? asOf)) === before;
	if (sameTable) { console.log("update-pricing: no price changed"); return; }
	writeFileSync(file, after);
	console.log(`update-pricing: table rewritten (${Object.keys(table).length} models, as of ${asOf})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => { console.error(`update-pricing: ${err.message}`); process.exit(1); });
}
