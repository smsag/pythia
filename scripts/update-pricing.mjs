#!/usr/bin/env node
// Rewrites the GENERATED block of models/modelPricing.ts from models.dev
// (ADR-163). Run by `npm run update:pricing` — locally before a release, or by
// .github/workflows/update-pricing.yml, which opens a pull request when the
// table changed. Prices never reach users through a fetch at build or run
// time: every change is a diff a human reads.
//
// Fails loudly (exit 1) on anything it cannot prove: an unexpected upstream
// schema, or a catalog model with no upstream row. It never drops a row
// silently — fix the mapping in UPSTREAM_IDS (scripts/modelsDev.mjs) instead.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { SOURCE_URL, UPSTREAM_PROVIDERS, UPSTREAM_IDS, NO_UPSTREAM, readCatalog, upstreamModels, upstreamId, nearbyIds, fetchUpstream } from "./modelsDev.mjs";

// Shared with update-models.mjs (ADR-179); re-exported so the tests and any
// caller that knew them here keep working.
export { SOURCE_URL, UPSTREAM_PROVIDERS, UPSTREAM_IDS, NO_UPSTREAM, readCatalog };

/** Pull `{ input, output, cacheRead?, cacheWrite? }` per catalog model from
 *  the upstream document. Throws with every unmapped model listed, plus
 *  nearby upstream ids as a hint, so one run tells you the whole fix. */
export function buildTable(upstream, catalog, ids = UPSTREAM_IDS, noUpstream = NO_UPSTREAM) {
	const table = {};
	const missing = [];
	for (const { id, provider } of catalog) {
		if (noUpstream.has(id)) continue;
		const models = upstreamModels(upstream, provider);
		const row = models[upstreamId(id, ids)];
		const cost = row?.cost;
		if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
			const near = nearbyIds(models, id);
			missing.push(`${id} (${provider})${near.length ? ` — upstream has: ${near.join(", ")}` : ""}`);
			continue;
		}
		const entry = { input: cost.input, output: cost.output };
		if (typeof cost.cache_read === "number") entry.cacheRead = cost.cache_read;
		if (typeof cost.cache_write === "number") entry.cacheWrite = cost.cache_write;
		table[id] = entry;
	}
	if (missing.length) {
		throw new Error(`No upstream price for ${missing.length} catalog model(s). Add a mapping to UPSTREAM_IDS in scripts/modelsDev.mjs:\n  ${missing.join("\n  ")}`);
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
	const upstream = await fetchUpstream();
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
