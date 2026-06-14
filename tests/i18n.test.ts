import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import en from "../locales/en";
import de from "../locales/de";

const ROOT = resolve(__dirname, "..");

/** All source files where t("key") calls can appear. */
const SOURCE_FILES = [
	"sidebar.ts",
	"main.ts",
	"settings.ts",
	...readdirSync(join(ROOT, "suggest")).map(f => `suggest/${f}`),
	...readdirSync(join(ROOT, "services")).map(f => `services/${f}`),
	...readdirSync(join(ROOT, "ui")).map(f => `ui/${f}`),
].map(f => join(ROOT, f));

function collectUsedKeys(): Set<string> {
	const used = new Set<string>();
	for (const file of SOURCE_FILES) {
		try {
			const src = readFileSync(file, "utf8");
			for (const m of src.matchAll(/\bt\("([a-zA-Z]+)"/g)) {
				used.add(m[1]);
			}
		} catch {
			// file may not exist (optional)
		}
	}
	return used;
}

// ── Locale key parity ─────────────────────────────────────────────────────────

describe("locale parity", () => {
	const enKeys = Object.keys(en).sort();
	const deKeys = Object.keys(de).sort();

	it("de has the same keys as en", () => {
		const missing = enKeys.filter(k => !deKeys.includes(k));
		expect(missing, `Keys in en but missing in de: ${missing.join(", ")}`).toHaveLength(0);
	});

	it("en has no extra keys compared to de", () => {
		const extra = deKeys.filter(k => !enKeys.includes(k));
		expect(extra, `Keys in de but missing in en: ${extra.join(", ")}`).toHaveLength(0);
	});
});

// ── Dead key detection ────────────────────────────────────────────────────────

describe("dead i18n keys", () => {
	it("every key defined in en is called somewhere in source code", () => {
		const used = collectUsedKeys();
		const dead = Object.keys(en).filter(k => !used.has(k)).sort();
		expect(
			dead,
			`Keys defined in en but never called via t("key"): ${dead.join(", ")}`
		).toHaveLength(0);
	});
});

// ── Missing key detection ─────────────────────────────────────────────────────

describe("missing i18n keys", () => {
	it("every t() call in source code refers to a defined key", () => {
		const defined = new Set(Object.keys(en));
		const used = collectUsedKeys();
		const missing = [...used].filter(k => !defined.has(k)).sort();
		expect(
			missing,
			`Keys called via t() but not defined in en: ${missing.join(", ")}`
		).toHaveLength(0);
	});
});
