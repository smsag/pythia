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

export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
	let str: string = getLocale()[key];
	if (vars) {
		str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
	}
	return str;
}
