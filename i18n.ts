import en from "./locales/en";
import de from "./locales/de";
import type { Strings } from "./locales/en";

const locales: Record<string, Strings> = { en, de };

export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
	const lang = ((window as unknown as { moment?: { locale?: () => string } })
		.moment?.locale?.() ?? "en")
		.split("-")[0];
	let str: string = (locales[lang] ?? en)[key];
	if (vars) {
		str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
	}
	return str;
}
