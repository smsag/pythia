import type { Provider } from "../models/types";
import { KNOWN_MODELS, getContextWindow } from "../models/knownModels";
import { MODEL_PROFILE } from "../models/modelGuidance";
import { MODEL_PRICING } from "../models/modelPricing";

/**
 * The prompt optimizer's model suggestion (ADR-181).
 *
 * The model judges how hard the task is; Pythia chooses the model. A model
 * asked to name a model does not know this catalog, these prices or which
 * keys the user has, and invents ids. So the optimizer reply carries one
 * extra line — `DIFFICULTY: light | standard | deep` — and everything after
 * that is these pure rules over `MODEL_PROFILE` and `MODEL_PRICING`.
 */

export type Difficulty = "light" | "standard" | "deep";
const DIFFICULTIES: readonly Difficulty[] = ["light", "standard", "deep"];

/** Appended to the optimizer request after OUTPUT_ONLY_INSTRUCTION, only when
 *  the setting is on. The line is parsed off before the prompt is shown. */
export const DIFFICULTY_INSTRUCTION =
	"After the rewritten prompt, add ONE final line of the form `DIFFICULTY: <level>` rating how demanding " +
	"the task is for an AI model. <level> is exactly one of: " +
	"light (a quick fact, a short rewrite, a simple lookup or format change), " +
	"standard (explaining a topic, drafting or summarizing text, everyday analysis), " +
	"deep (multi-step reasoning, careful comparison, long or dense material, subtle math or code). " +
	"This line is removed before the prompt is shown; it is the only exception to returning the prompt alone.";

/**
 * Split the optimizer reply into the prompt and the rating. The rating must be
 * the LAST non-empty line; anything else is prompt text, so a prompt that
 * happens to mention "difficulty:" is never cut. `difficulty` is null when the
 * line is missing or names no known level — the prompt is still returned whole.
 */
export function parseDifficulty(reply: string): { prompt: string; difficulty: Difficulty | null } {
	const text = (reply ?? "").replace(/\s+$/, "");
	const lastBreak = text.lastIndexOf("\n");
	const lastLine = text.slice(lastBreak + 1);
	const m = /^\s*[*_`]*DIFFICULTY[*_`]*\s*:\s*[*_`]*\s*([a-z]+)[*_`.]*\s*$/i.exec(lastLine);
	if (!m) return { prompt: text, difficulty: null };
	const level = m[1].toLowerCase() as Difficulty;
	const prompt = lastBreak === -1 ? "" : text.slice(0, lastBreak).replace(/\s+$/, "");
	return { prompt, difficulty: DIFFICULTIES.includes(level) ? level : null };
}

export interface RecommendationInput {
	difficulty: Difficulty;
	/** The user's preferred provider (`settings.defaultProvider`). */
	provider: Provider;
	/** What the conversation would be sent with otherwise. */
	currentProvider: Provider;
	currentModel: string;
	/** Estimated tokens of the history the next send carries. */
	historyTokens: number;
	/** Attached + template notes for the next send. */
	contextNoteCount: number;
	researchMode: boolean;
	hasPdf: boolean;
	/** A template armed for the next send names a model: it wins (ADR-177). */
	templatePinsModel: boolean;
}

/** Notes or research push a task up one level: the prompt alone does not show
 *  the material the model will have to read. */
export const NOTES_BUMP_AT = 3;

const DEPTH: Record<Difficulty, 1 | 2 | 3> = { light: 1, standard: 2, deep: 3 };

/** The depth tier a task needs once the context Pythia knows about is counted. */
export function requiredDepth(input: Pick<RecommendationInput, "difficulty" | "contextNoteCount" | "researchMode">): 1 | 2 | 3 {
	const base = DEPTH[input.difficulty];
	const bump = input.researchMode || input.contextNoteCount >= NOTES_BUMP_AT ? 1 : 0;
	return Math.min(3, base + bump) as 1 | 2 | 3;
}

function rank(model: string): number {
	return MODEL_PROFILE[model]?.cost ?? 3;
}

/** USD per million tokens, input and output together — the tie-breaker within
 *  a cost tier. Infinity for a model with no price row, so it sorts last. */
function listPrice(model: string): number {
	const p = MODEL_PRICING[model];
	return p ? p.input + p.output : Infinity;
}

/** The answer length the send-cost comparison assumes. A guess, but the same
 *  guess on both sides; it only has to be the right order of magnitude. */
export const TYPICAL_ANSWER_TOKENS = 1_000;

/** Estimated USD for one send on `model`: the history re-read plus a typical
 *  answer. `cached` prices the history at the cache-read rate where the table
 *  has one — staying on the current model keeps its prompt cache; switching
 *  starts cold. Null for a model with no price row. */
export function sendCost(model: string, historyTokens: number, cached: boolean): number | null {
	const p = MODEL_PRICING[model];
	if (!p) return null;
	const rate = cached && p.cacheRead !== undefined ? p.cacheRead : p.input;
	return (historyTokens * rate + TYPICAL_ANSWER_TOKENS * p.output) / 1_000_000;
}

/**
 * The cheapest selectable model of the preferred provider that is deep enough,
 * or null when there is nothing worth suggesting. Null covers: a template
 * already chose the model; a PDF on a provider without PDF input; no model
 * both deep enough and wide enough for the history; the pick is what the send
 * would use anyway; and a downgrade whose cold send costs more than staying
 * on the cached current model.
 */
export function recommendModel(input: RecommendationInput): string | null {
	if (input.templatePinsModel) return null;
	if (input.hasPdf && input.provider === "mistral") return null;

	const depth = requiredDepth(input);
	const candidates = KNOWN_MODELS[input.provider]
		.filter((id) => {
			const profile = MODEL_PROFILE[id];
			// Room for the history plus a fifth again for prompt, notes and answer.
			return profile !== undefined && profile.depth >= depth && getContextWindow(id) > input.historyTokens * 1.2;
		})
		// Stable sort: equal cost and price keep catalog order, which lists the
		// newest model of a family first — Opus 5 before Opus 4.6 at one price.
		.sort((a, b) => rank(a) - rank(b) || listPrice(a) - listPrice(b));

	const pick = candidates[0];
	if (!pick) return null;
	// The current model is already good enough and no dearer: nothing to say.
	if (input.provider === input.currentProvider && candidates.includes(input.currentModel)
		&& !(rank(pick) < rank(input.currentModel) || listPrice(pick) < listPrice(input.currentModel))) {
		return null;
	}

	// A long conversation re-sent cold on a cheaper model can cost more than it
	// saves: the current model reads its history from the prompt cache. Only a
	// downgrade is checked — an upgrade is suggested for quality, not price.
	const cheaper = rank(pick) < rank(input.currentModel) || listPrice(pick) < listPrice(input.currentModel);
	if (cheaper) {
		const stay = sendCost(input.currentModel, input.historyTokens, true);
		const move = sendCost(pick, input.historyTokens, false);
		if (stay !== null && move !== null && move >= stay) return null;
	}
	return pick;
}
