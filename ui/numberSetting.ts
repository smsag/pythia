import type { TextComponent } from "obsidian";

/**
 * Numeric settings fields commit on blur or Enter — never per keystroke (ADR-171).
 *
 * `TextComponent.onChange` fires on every character, so lowering a field from
 * "200" to "0" stores 20 and then 2 on the way down. For most settings that is
 * only noise; for the conversation cap the debounced save behind it deleted
 * every conversation past the transient number. A field holds a value the user
 * is still *composing*; only the finished value is a setting.
 */
export interface NumberRule {
	/** Smallest accepted value, inclusive. */
	min: number;
	/** Largest accepted value, inclusive. Omitted means unbounded. */
	max?: number;
	/** Parse with `parseFloat` instead of `parseInt` (temperature). */
	decimal?: boolean;
	/** An empty field means "unset" (`undefined`), not "invalid". */
	allowEmpty?: boolean;
}

/** `ok: false` is "the user typed something this field cannot hold" — the caller
 *  puts the stored value back rather than guessing at an intent. */
export type NumberCommit = { ok: true; value: number | undefined } | { ok: false };

/** Pure: what a finished field means. Every numeric settings field parses here. */
export function parseNumberSetting(raw: string, rule: NumberRule): NumberCommit {
	const trimmed = raw.trim();
	if (trimmed === "") return rule.allowEmpty === true ? { ok: true, value: undefined } : { ok: false };
	const n = rule.decimal === true ? parseFloat(trimmed) : parseInt(trimmed, 10);
	if (!Number.isFinite(n)) return { ok: false };
	if (n < rule.min) return { ok: false };
	if (rule.max !== undefined && n > rule.max) return { ok: false };
	return { ok: true, value: n };
}

interface BindOptions<T extends number | undefined> {
	rule: NumberRule;
	/** The stored value: shown on open, and restored when an entry is rejected. */
	read: () => T;
	/** Called only with a finished, valid value that differs from `read()`. */
	write: (value: T) => void;
}

export function bindNumberSetting(
	text: TextComponent,
	opts: BindOptions<number> & { rule: NumberRule & { allowEmpty?: false } },
): () => void;
export function bindNumberSetting(
	text: TextComponent,
	opts: BindOptions<number | undefined> & { rule: NumberRule & { allowEmpty: true } },
): () => void;
/**
 * Show the stored value, and commit what the user typed when they leave the
 * field or press Enter. Returns the commit function: closing the settings tab
 * destroys the input before `blur` can fire, so the tab flushes its fields
 * itself (`PythiaSettingTab.hide`).
 *
 * The listeners are raw because a `PluginSettingTab` is not a `Component` and
 * has no `registerDomEvent`; they die with the input, which `display()` rebuilds.
 */
export function bindNumberSetting(
	text: TextComponent,
	// `any` here, not `number | undefined`: the two overloads above are the contract,
	// and `write: (n: number) => void` cannot satisfy one implementation signature
	// taking `number | undefined` under strictFunctionTypes.
	opts: BindOptions<any>,
): () => void {
	const read: () => number | undefined = opts.read;
	const write: (value: number | undefined) => void = opts.write;
	const show = (): void => { text.setValue(read()?.toString() ?? ""); };
	show();

	const commit = (): void => {
		const parsed = parseNumberSetting(text.getValue(), opts.rule);
		if (!parsed.ok) { show(); return; }
		if (parsed.value === read()) return;
		write(parsed.value);
	};

	text.inputEl.addEventListener("blur", commit);
	text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		commit();
	});
	return commit;
}
