import en from "./locales/en";
import de from "./locales/de";
import type { Strings } from "./locales/en";

const locales: Record<string, Strings> = { en, de };

let locale: Strings | null = null;

function getLocale(): Strings {
	if (!locale) {
		const lang = ((window as unknown as { moment?: { locale?: () => string } })
			.moment?.locale?.() ?? "en")
			.split("-")[0];
		locale = locales[lang] ?? en;
	}
	return locale;
}

/** Obsidian's own UI locale, verbatim and lowercased (e.g. "de", "pt-br").
 *  Unlike `getLang` this does NOT clamp to the two languages Pythia's UI is
 *  translated into: the "Follow Obsidian" language setting (ADR-148) instructs
 *  the model in whatever language Obsidian is running in. Guarded for the
 *  headless test environment, where there is no `window`. */
export function getObsidianLocale(): string {
	if (typeof window === "undefined") return "en";
	return ((window as unknown as { moment?: { locale?: () => string } })
		.moment?.locale?.() ?? "en")
		.toLowerCase();
}

/** Active UI language as a 2-letter code, for content localized outside the
 *  `t()` string table (e.g. per-model guidance keyed by model id). */
export function getLang(): "en" | "de" {
	const code = getObsidianLocale().split("-")[0];
	return code === "de" ? "de" : "en";
}

export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
	// English, then the key itself: a string missing from one locale must never
	// throw inside a render path, and the bare key is at least searchable.
	let str: string = getLocale()[key] ?? en[key] ?? key;
	if (vars) {
		str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
	}
	return str;
}
