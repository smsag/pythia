import { describe, it, expect } from "vitest";
import { renameSettingsPaths, renameVaultPaths, SETTINGS_PATH_KEYS, SETTINGS_PATH_LIST_KEYS } from "../services/renameVaultPath";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";
import type { Comparison, ComparisonCandidate, Conversation, Message, NoteWrite, PendingTemplate, RewriteTarget } from "../models/types";

/**
 * Every field of every stored record, classified (ADR-218 addendum, principle 3).
 *
 * `path` / `paths` hold vault paths and must follow a rename; `nested` holds a
 * record classified below; `other` holds nothing that names a place in the
 * vault. The `Record<keyof …>` types are the guard: add a field to one of these
 * interfaces without classifying it here and THE COMPILER refuses the build —
 * which is how `promptOptimizerTemplateId`, a template path, was found when this
 * test was written.
 */
type Kind = "path" | "paths" | "nested" | "other";

const CONVERSATION: Record<keyof Conversation, Kind> = {
	id: "other", name: "other", createdAt: "other", updatedAt: "other",
	templateId: "path", systemPrompt: "other", contextNotes: "paths", resumeMode: "other",
	provider: "other", model: "other", maxTokens: "other", temperature: "other", effort: "other",
	summaryText: "other", summaryUpdatedAt: "other", summaryNote: "path", favoritesSummary: "other",
	messages: "nested", favorites: "other", savedNotePath: "path", lastSavedMessageCount: "other",
	merges: "other", pins: "other",
	forkedFromId: "other", forkedFromMessageId: "other", forkedFromSelection: "other",
	forkedFromOccurrenceIndex: "other", forkedFromSummary: "other",
	outputFolder: "path", writeMode: "other",
	theme: "other",        // a theme note's NAME; the glossary moves it by name (ADR-150)
	glossaryTerm: "other", // a term, not a path
	outputLanguage: "other", researchMode: "other", vaultContext: "other",
	comparison: "nested", pendingRewrite: "nested", pendingTemplate: "nested",
};

const MESSAGE: Record<keyof Message, Kind> = {
	id: "other", role: "other",
	content: "other", // what was said is history, never rewritten (D-58)
	timestamp: "other", model: "other", attachedNotes: "paths", tokenUsage: "other",
	sources: "nested", chapterName: "other", templateId: "path", rewriteTarget: "nested",
	truncated: "other", cost: "other", noteWrites: "nested",
	alternatives: "nested", // other answers kept as tabs (ADR-219)
};

const PENDING_TEMPLATE: Record<keyof PendingTemplate, Kind> = {
	id: "path", name: "other", systemPrompt: "other", provider: "other", model: "other",
	maxTokens: "other", temperature: "other", effort: "other", writeMode: "other",
	outputFolder: "path", contextNotes: "paths",
};

const REWRITE_TARGET: Record<keyof RewriteTarget, Kind> = { path: "path", from: "other", to: "other", text: "other" };
const NOTE_WRITE: Record<keyof NoteWrite, Kind> = { path: "path", action: "other" };
const COMPARISON: Record<keyof Comparison, Kind> = { id: "other", userMessageId: "other", candidates: "nested", createdAt: "other", priorAlternativeIds: "other" };
const CANDIDATE: Record<keyof ComparisonCandidate, Kind> = {
	id: "other", provider: "other", model: "other", content: "other", timestamp: "other",
	tokenUsage: "other", sources: "nested", templateId: "path",
	cost: "other", noteWrites: "nested",
};

const SETTINGS: Record<keyof PythiaSettings, Kind> = {
	anthropicSecretName: "other", openaiSecretName: "other", mistralSecretName: "other", searchSecretName: "other",
	defaultProvider: "other", defaultAnthropicModel: "other", defaultOpenAIModel: "other", defaultMistralModel: "other",
	templatesFolder: "path", conversationsFolder: "path", scratchFolder: "path",
	defaultResumeMode: "other", maxMessagesPerSession: "other", maxConversations: "other",
	archiveBeforeEviction: "other", archiveFolder: "path", injectActiveNoteOnTemplate: "other",
	inboxNote: "path", glossaryNote: "path", glossaryFolder: "path",
	outputLanguage: "other", debugMode: "other", showCost: "other",
	promptOptimizerTemplateId: "path", defaultPromptFramework: "other", optimizerSuggestsModel: "other",
	maxTokens: "other", temperature: "other", effort: "other", maxAttachedNotesTokens: "other",
	customInstructions: "other", webSearchDefault: "other", webSearchAutoArm: "other", webSearchMaxResults: "other",
	embeddingModelId: "other", relatedSimilarity: "other",
	vaultContextEnabled: "other", vaultContextMaxNotes: "other", vaultContextSimilarity: "other",
	vaultContextFolders: "paths", vaultContextMaxIndexedNotes: "other",
};

const pathKeys = <T,>(table: Record<keyof T & string, Kind>, kind: "path" | "paths"): string[] =>
	Object.entries(table).filter(([, k]) => k === kind).map(([key]) => key);

const P = "Old";
const at = (leaf: string): string => `${P}/${leaf}`;

/** A conversation with an old path in EVERY field classified as a path — built
 *  from the tables, so a newly classified field is exercised automatically. */
function fixture(): Conversation {
	const put = <T extends object>(obj: T, table: Record<string, Kind>, tag: string): T => {
		for (const [key, kind] of Object.entries(table)) {
			if (kind === "path") (obj as Record<string, unknown>)[key] = at(`${tag}.${key}.md`);
			if (kind === "paths") (obj as Record<string, unknown>)[key] = [at(`${tag}.${key}.md`)];
		}
		return obj;
	};
	const makeCandidate = (tag: string): ComparisonCandidate => put({
		id: tag, provider: "anthropic", model: "m", content: "", timestamp: "t",
		sources: [{ n: 1, kind: "vault", ref: at(`${tag}.source.md`), title: `${tag}.source` }],
		noteWrites: [put({ action: "created" } as unknown as NoteWrite, NOTE_WRITE, `${tag}.write`)],
	} as unknown as ComparisonCandidate, CANDIDATE, tag);
	const candidate = makeCandidate("cand");
	const message = put({
		id: "m", role: "assistant", content: `[[${at("said.md")}]]`, timestamp: "t",
		sources: [{ n: 1, kind: "vault", ref: at("msg.source.md"), title: "msg.source" }],
		rewriteTarget: put({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, text: "x" } as unknown as RewriteTarget, REWRITE_TARGET, "msg.rewrite"),
		noteWrites: [put({ action: "created" } as unknown as NoteWrite, NOTE_WRITE, "msg.write")],
		alternatives: [makeCandidate("alt")],
	} as unknown as Message, MESSAGE, "msg");
	return put({
		id: "c", name: "C", messages: [message],
		comparison: put({ id: "q", userMessageId: "m", createdAt: "t", candidates: [candidate] } as Comparison, COMPARISON, "cmp"),
		pendingRewrite: put({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, text: "x" } as unknown as RewriteTarget, REWRITE_TARGET, "conv.rewrite"),
		pendingTemplate: put({ name: "T", systemPrompt: "" } as unknown as PendingTemplate, PENDING_TEMPLATE, "conv.template"),
	} as unknown as Conversation, CONVERSATION, "conv");
}

/** Every string under `value` that still names the old folder. */
function stale(value: unknown, trail = "$"): string[] {
	if (typeof value === "string") return value.startsWith(`${P}/`) ? [trail] : [];
	if (Array.isArray(value)) return value.flatMap((v, i) => stale(v, `${trail}[${i}]`));
	if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stale(v, `${trail}.${k}`));
	return [];
}

describe("every stored vault path follows a rename (ADR-218 addendum)", () => {
	it("in a conversation — nothing names the old folder afterwards but what was said", () => {
		const conv = fixture();
		expect(renameVaultPaths([conv], [{ from: P, to: "New" }])).toEqual(["c"]);
		expect(stale(conv)).toEqual([]);
		expect(conv.messages[0].content).toBe(`[[${at("said.md")}]]`); // D-58
	});

	it("in the settings — the renamer's key lists are exactly the classified ones", () => {
		expect([...SETTINGS_PATH_KEYS].sort()).toEqual(pathKeys<PythiaSettings>(SETTINGS, "path").sort());
		expect([...SETTINGS_PATH_LIST_KEYS].sort()).toEqual(pathKeys<PythiaSettings>(SETTINGS, "paths").sort());

		const settings = { ...DEFAULT_SETTINGS } as PythiaSettings;
		for (const key of SETTINGS_PATH_KEYS) (settings as unknown as Record<string, unknown>)[key] = at(`${key}`);
		for (const key of SETTINGS_PATH_LIST_KEYS) (settings as unknown as Record<string, unknown>)[key] = [at(`${key}`)];
		renameSettingsPaths(settings, [{ from: P, to: "New" }]);
		const leftovers = [...SETTINGS_PATH_KEYS, ...SETTINGS_PATH_LIST_KEYS].filter((k) => stale(settings[k]).length > 0);
		expect(leftovers).toEqual([]);
	});
});
