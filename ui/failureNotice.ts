import { Notice } from "obsidian";
import { t } from "../i18n";
import type { Strings } from "../locales/en";
import { describeErrorForLog, redactSecrets } from "../services/redact";

type FailureKey = { [K in keyof Strings]: Strings[K] extends string ? K : never }[keyof Strings];

/**
 * An action that failed says so (principle 2, "silence is a bug"): a Notice the
 * user sees, naming the error with its secrets redacted, and a console line a
 * bug report can quote. For the async click handlers whose rejection would
 * otherwise vanish as an unhandled promise.
 */
export function noticeFailure(context: string, err: unknown, key: FailureKey = "commandFailed"): void {
	const message = err instanceof Error ? err.message : String(err);
	new Notice(t(key, { error: redactSecrets(message) }));
	console.warn(`[Pythia] ${context}`, describeErrorForLog(err));
}
