import en from "./locales/en";
import de from "./locales/de";
import type { Strings } from "./locales/en";

const locales: Record<string, Strings> = { en, de };

// Obsidian's locale is set once at startup and never changes at runtime.
const LANG = ((window as unknown as { moment?: { locale?: () => string } })
	.moment?.locale?.() ?? "en")
	.split("-")[0];

const locale: Strings = locales[LANG] ?? en;

export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
	let str: string = locale[key];
	if (vars) {
		str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
	}
	return str;
}
