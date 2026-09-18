// What both models.dev scripts share (ADR-163, ADR-179): the source, how a
// catalog model is found upstream, and the list of models that are not there.
// One copy, so a renamed upstream id is fixed once for prices and catalog alike.

export const SOURCE_URL = "https://models.dev/api.json";

/** Pythia provider key → models.dev provider id. */
export const UPSTREAM_PROVIDERS = { anthropic: "anthropic", openai: "openai", mistral: "mistral" };

/** Catalog model id → models.dev model id, where they differ. A model that is
 *  not listed here is looked up under its own id. */
export const UPSTREAM_IDS = {
	"magistral-small-latest": "magistral-small",
};

/** Catalog models models.dev does not list. Their committed values are kept as
 *  they are and the run says so — the built-in value is an assumption (Opus-tier
 *  for the hidden Mythos entry), which the disclaimer already covers. A model
 *  belongs here only after a run has shown it missing upstream; it is never
 *  a way to silence a renamed id. */
export const NO_UPSTREAM = new Set(["claude-mythos-5"]);

/** The catalog: `{ id, provider }` per model — hidden ones included, since a
 *  conversation can still be on one — read from the source of truth so the
 *  scripts cannot drift from it. */
export function readCatalog(source) {
	const rows = [];
	const re = /\{\s*id:\s*"([^"]+)",\s*provider:\s*"([^"]+)"/g;
	for (const m of source.matchAll(re)) rows.push({ id: m[1], provider: m[2] });
	if (rows.length === 0) throw new Error("readCatalog: no models found in knownModels.ts");
	return rows;
}

/** The models.dev model map for one Pythia provider. Throws when it is not
 *  there — that is a schema change, never "no models". */
export function upstreamModels(upstream, provider) {
	if (!upstream || typeof upstream !== "object") throw new Error("upstream is not an object");
	const models = upstream[UPSTREAM_PROVIDERS[provider]]?.models;
	if (!models || typeof models !== "object") {
		throw new Error(`upstream has no models for provider "${UPSTREAM_PROVIDERS[provider]}" — schema changed?`);
	}
	return models;
}

/** The models.dev id a catalog model is filed under. */
export function upstreamId(id, ids = UPSTREAM_IDS) {
	return ids[id] ?? id;
}

/** A few upstream ids that look like the missing one, for the error message:
 *  one run should tell you the whole fix. */
export function nearbyIds(models, id) {
	const stem = id.split(/[-.]/).filter((t) => t.length > 2)[0] ?? id;
	return Object.keys(models).filter((k) => k.includes(stem)).slice(0, 6);
}

export async function fetchUpstream() {
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`${SOURCE_URL} → HTTP ${res.status}`);
	return res.json();
}
