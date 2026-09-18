#!/usr/bin/env node
// Keeps models/knownModels.ts honest against models.dev (ADR-179). Run by
// `npm run update:models`, locally or by .github/workflows/update-models.yml.
//
// Two outputs, deliberately different in kind:
//
//   1. FACTS it rewrites: each catalog model's `contextWindow` (the input-side
//      limit where upstream gives one — see upstreamWindow). Upstream is the
//      provider's own number, nothing about it is a judgement, and the change
//      arrives as a pull request a human reads — the ADR-163 pattern.
//   2. DECISIONS it only reports (`--report <file>`, markdown for an issue):
//      new models upstream, and catalog models upstream marks deprecated. A
//      catalog row also carries an abbreviation, a MODEL_PROFILE, a localized
//      "good for" line and the provider-behaviour flags the code branches on.
//      None of that can be generated, so the script suggests a row and a human
//      writes it. It never adds, hides or removes a model.
//
// Fails loudly (exit 1) on anything it cannot prove, like update-pricing: a
// changed schema, a catalog model with no upstream row, a context size that is
// not a positive integer.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { UPSTREAM_IDS, UPSTREAM_PROVIDERS, NO_UPSTREAM, upstreamModels, upstreamId, nearbyIds, fetchUpstream } from "./modelsDev.mjs";

/** `{ id, provider, contextWindow, hidden }` per catalog line. */
export function readCatalogDetails(source) {
	const rows = [];
	for (const line of source.split("\n")) {
		const m = /^\s*\{\s*id:\s*"([^"]+)",\s*provider:\s*"([^"]+)"/.exec(line);
		if (!m) continue;
		const cw = /contextWindow:\s*([\d_]+)/.exec(line);
		if (!cw) throw new Error(`readCatalogDetails: ${m[1]} has no contextWindow on its line`);
		rows.push({ id: m[1], provider: m[2], contextWindow: Number(cw[1].replace(/_/g, "")), hidden: /hidden:\s*true/.test(line) });
	}
	if (rows.length === 0) throw new Error("readCatalogDetails: no models found in knownModels.ts");
	return rows;
}

/** A context size as the catalog writes it (`1_047_576`), and the gate between
 *  upstream and shipped source: anything but a positive safe integer is
 *  refused, never emitted — `contextWindow: NaN` compiles (principle 1). */
export function formatWindow(n) {
	if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) {
		throw new Error(`upstream context size is not a usable number: ${JSON.stringify(n)}`);
	}
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

/** The number `contextWindow` means: how much a request may SEND. models.dev
 *  gives `limit.context` (input + output together) and, where the provider caps
 *  the prompt separately, `limit.input` — GPT-5 is 272K of 400K. Trimming
 *  budgets history against `contextWindow`, so the smaller, input-side number is
 *  the one that cannot overshoot. */
export function upstreamWindow(row) {
	const limit = row?.limit;
	return limit && typeof limit === "object" && limit.input !== undefined ? limit.input : limit?.context;
}

/** Rewrite every catalog `contextWindow` that differs from upstream. Returns
 *  the new source and the list of changes; the source is untouched when the
 *  list is empty. */
export function syncContextWindows(source, upstream, catalog, ids = UPSTREAM_IDS, noUpstream = NO_UPSTREAM) {
	const changes = [];
	const missing = [];
	let out = source;
	for (const { id, provider, contextWindow } of catalog) {
		if (noUpstream.has(id)) continue;
		const models = upstreamModels(upstream, provider);
		const row = models[upstreamId(id, ids)];
		if (!row || typeof row !== "object" || !row.limit || typeof row.limit !== "object") {
			const near = nearbyIds(models, id);
			missing.push(`${id} (${provider})${near.length ? ` — upstream has: ${near.join(", ")}` : ""}`);
			continue;
		}
		const next = formatWindow(upstreamWindow(row));
		if (Number(next.replace(/_/g, "")) === contextWindow) continue;
		const lineRe = new RegExp(`^(\\s*\\{\\s*id:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",[^\\n]*?contextWindow:\\s*)[\\d_]+`, "m");
		if (!lineRe.test(out)) throw new Error(`syncContextWindows: could not find the catalog line for ${id}`);
		out = out.replace(lineRe, `$1${next}`);
		changes.push({ id, from: contextWindow, to: upstreamWindow(row) });
	}
	if (missing.length) {
		throw new Error(`No upstream row for ${missing.length} catalog model(s). Add a mapping to UPSTREAM_IDS in scripts/modelsDev.mjs:\n  ${missing.join("\n  ")}`);
	}
	return { source: out, changes };
}

// A model id reaches the issue body verbatim, so only a plain id does: letters,
// digits, dot, dash, underscore. Anything else is logged and left out.
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_DATE = /^\d{4}-\d{2}(-\d{2})?$/;
// A dated snapshot of an alias the list already shows (`claude-haiku-4-5-20251001`,
// `mistral-medium-2604`, `gpt-4o-2024-08-06`). Offering both is noise.
const SNAPSHOT = /-(\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/;

/** A model the chat can use: text in, text out only, with tool calls. */
function isChatModel(row) {
	const out = row.modalities?.output;
	const input = row.modalities?.input;
	return Array.isArray(out) && out.length === 1 && out[0] === "text"
		&& Array.isArray(input) && input.includes("text")
		&& row.tool_call === true;
}

/** Catalog models that upstream marks deprecated and that the picker still
 *  offers. A hidden one is already handled. */
export function findDeprecated(upstream, catalog, ids = UPSTREAM_IDS, noUpstream = NO_UPSTREAM) {
	const out = [];
	for (const { id, provider, hidden } of catalog) {
		if (hidden || noUpstream.has(id)) continue;
		const row = upstreamModels(upstream, provider)[upstreamId(id, ids)];
		if (row?.status === "deprecated") out.push({ id, provider });
	}
	return out;
}

/** The newest upstream release date among a provider's catalog models: the
 *  line above which an upstream model is news. */
function watermark(upstream, catalog, provider, ids, noUpstream) {
	let mark = "";
	for (const m of catalog) {
		if (m.provider !== provider || noUpstream.has(m.id)) continue;
		const date = upstreamModels(upstream, provider)[upstreamId(m.id, ids)]?.release_date;
		if (typeof date === "string" && SAFE_DATE.test(date) && date > mark) mark = date;
	}
	return mark;
}

/** Upstream chat models released on or after the newest one the catalog
 *  carries for their provider, and not in it. Same-day siblings count, since
 *  a family ships together. Adding the newest model therefore moves the line
 *  past the older candidates: the issue asks about them while it is open. */
export function findNewModels(upstream, catalog, ids = UPSTREAM_IDS, noUpstream = NO_UPSTREAM) {
	const known = new Set(catalog.map((m) => upstreamId(m.id, ids)));
	const out = [];
	for (const provider of Object.keys(UPSTREAM_PROVIDERS)) {
		const mark = watermark(upstream, catalog, provider, ids, noUpstream);
		for (const [key, row] of Object.entries(upstreamModels(upstream, provider))) {
			if (!row || typeof row !== "object" || known.has(key)) continue;
			if (row.status === "deprecated" || !isChatModel(row) || SNAPSHOT.test(key)) continue;
			const date = typeof row.release_date === "string" && SAFE_DATE.test(row.release_date) ? row.release_date : "";
			if (!date || date < mark) continue;
			if (!SAFE_ID.test(key)) { console.warn(`update-models: skipped an upstream id that is not a plain id: ${JSON.stringify(key).slice(0, 80)}`); continue; }
			out.push({ id: key, provider, releaseDate: date, row });
		}
	}
	return out.sort((a, b) => a.provider.localeCompare(b.provider) || b.releaseDate.localeCompare(a.releaseDate) || a.id.localeCompare(b.id));
}

/** A starting point for the catalog row, flags read from upstream the way
 *  knownModels.ts uses them. `abbreviation` is left for a human. */
export function suggestRow({ id, provider, row }) {
	let window;
	try { window = formatWindow(upstreamWindow(row)); } catch { window = "/* unknown */ 128_000"; }
	const fields = [`id: "${id}"`, `provider: "${provider}"`, `abbreviation: "TODO"`, `contextWindow: ${window}`];
	const effort = Array.isArray(row.reasoning_options) && row.reasoning_options.some((o) => o?.type === "effort");
	if (provider === "anthropic") {
		if (row.temperature === false) fields.push("noTemperature: true");
		if (effort) fields.push("supportsEffort: true");
	} else if (provider === "openai") {
		if (row.reasoning === true) fields.push("isReasoning: true");
	} else if (provider === "mistral") {
		if (row.reasoning === true) fields.push("isMistralReasoning: true");
	}
	return `{ ${fields.join(", ")} },`;
}

/** Markdown for the issue, or "" when there is nothing to decide. */
export function renderReport({ newModels, deprecated, asOf }) {
	if (!newModels.length && !deprecated.length) return "";
	const out = [`Generated by \`npm run update:models\` from https://models.dev on ${asOf} (ADR-179). The script never changes the catalog itself: every entry below is a decision. This issue is rewritten on every run and closed when nothing is left.`];
	if (newModels.length) {
		out.push("", `## New upstream models (${newModels.length})`, "", "Chat models (text in and out, tool calls) released on or after the newest model the catalog carries for their provider. Status and flags are models.dev's.", "", "| Provider | Model | Released | Input window | Note |", "|---|---|---|---|---|");
		for (const m of newModels) {
			const note = [m.row.status === "beta" ? "beta" : "", m.row.experimental === true ? "experimental" : ""].filter(Boolean).join(", ");
			let ctx; try { ctx = formatWindow(upstreamWindow(m.row)); } catch { ctx = "?"; }
			out.push(`| ${m.provider} | \`${m.id}\` | ${m.releaseDate} | ${ctx} | ${note} |`);
		}
		out.push("", "Suggested catalog rows — check every flag against the provider's docs before using one:", "", "```ts");
		for (const m of newModels) out.push(suggestRow(m));
		out.push("```", "", "Adding a model means, in one PR: the `MODEL_CATALOG` row in `models/knownModels.ts`, its `MODEL_PROFILE` and `MODEL_GOOD_FOR` (en + de) in `models/modelGuidance.ts`, then `npm run update:pricing` for its price row. The tests fail until all four exist.");
	}
	if (deprecated.length) {
		out.push("", `## Deprecated upstream, still offered (${deprecated.length})`, "", "The picker still lists these. Mark them `hidden: true` rather than deleting them: a conversation on one keeps working and keeps its label and price.", "");
		for (const m of deprecated) out.push(`- \`${m.id}\` (${m.provider})`);
	}
	return out.join("\n") + "\n";
}

async function main() {
	const argv = process.argv.slice(2);
	const reportAt = argv.indexOf("--report");
	const reportPath = reportAt === -1 ? null : argv[reportAt + 1];
	if (reportAt !== -1 && !reportPath) throw new Error("--report needs a file path");

	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const file = resolve(root, "models/knownModels.ts");
	const before = readFileSync(file, "utf8");
	const catalog = readCatalogDetails(before);
	const upstream = await fetchUpstream();
	for (const id of NO_UPSTREAM) console.warn(`update-models: ${id} is not listed on models.dev — committed values kept`);

	const { source, changes } = syncContextWindows(before, upstream, catalog);
	if (changes.length) {
		writeFileSync(file, source);
		for (const c of changes) console.log(`update-models: ${c.id} contextWindow ${c.from} → ${c.to}`);
	} else {
		console.log("update-models: no context window changed");
	}

	const newModels = findNewModels(upstream, catalog);
	const deprecated = findDeprecated(upstream, catalog);
	console.log(`update-models: ${newModels.length} new upstream model(s), ${deprecated.length} deprecated catalog model(s) still offered`);
	const report = renderReport({ newModels, deprecated, asOf: new Date().toISOString().slice(0, 10) });
	if (reportPath) writeFileSync(reportPath, report);
	else if (report) console.log("\n" + report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => { console.error(`update-models: ${err.message}`); process.exit(1); });
}
