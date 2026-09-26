import { describe, it, expect, vi } from "vitest";
import { TFile, type App } from "obsidian";
import type { Conversation } from "../models/types";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";
import { contextScope, isIndexingOptedOut, isPathInScope, retrievalQuery } from "../services/vaultContext";
import { VaultContextService } from "../services/VaultContextService";
import type { SchreibstubeLink } from "../services/schreibstubeLink";

describe("retrievalQuery (ADR-183)", () => {
	it("carries the head of the previous answer into a short follow-up", () => {
		expect(retrievalQuery("and the second one?", "The two leases are Seestraße and Bergweg.")).toBe(
			"and the second one?\n\nThe two leases are Seestraße and Bergweg."
		);
	});

	it("leaves a message long enough to stand on its own", () => {
		const long = "x".repeat(200);
		expect(retrievalQuery(long, "previous")).toBe(long);
	});

	it("is empty for an empty message", () => {
		expect(retrievalQuery("   ", "previous")).toBe("");
	});
});

describe("isIndexingOptedOut (ADR-183)", () => {
	it("takes only an explicit false", () => {
		expect(isIndexingOptedOut({ pythia: false })).toBe(true);
		expect(isIndexingOptedOut({ pythia: "false" })).toBe(true);
		expect(isIndexingOptedOut({ pythia: "no" })).toBe(false);
		expect(isIndexingOptedOut({})).toBe(false);
		expect(isIndexingOptedOut(null)).toBe(false);
	});
});

describe("the scope a turn may draw from", () => {
	it("matches folders as prefixes of whole segments", () => {
		expect(isPathInScope("Insights/x.md", ["Insights"], [])).toBe(true);
		expect(isPathInScope("Insights-old/y.md", ["Insights"], [])).toBe(false);
		expect(isPathInScope("any.md", [], [])).toBe(true);
	});

	it("never draws from Pythia's own folders", () => {
		const scope = contextScope({ vaultContextFolders: ["Notes/"], conversationsFolder: "Pythia/Conversations/", scratchFolder: "" });
		expect(scope).toEqual({ include: ["Notes"], skip: ["Pythia/Conversations"] });
		expect(isPathInScope("Pythia/Conversations/a.md", [], scope.skip)).toBe(false);
	});
});

// ── The service: Schreibstube finds, Pythia filters ─────────────────────────────

function service(found: string[], over: Partial<PythiaSettings> = {}, frontmatter: Record<string, unknown> = {}) {
	const settings = { ...DEFAULT_SETTINGS, vaultContextEnabled: true, ...over } as PythiaSettings;
	const searchNotes = vi.fn(async () => found);
	const link = { searchNotes, available: () => true } as unknown as SchreibstubeLink;
	const app = {
		vault: { getAbstractFileByPath: (path: string) => Object.assign(new TFile(), { path }) },
		metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: frontmatter[f.path] }) },
	} as unknown as App;
	return { svc: new VaultContextService(app, () => settings, link), searchNotes };
}

const conv = (over: Partial<Conversation> = {}): Conversation =>
	({ id: "c1", messages: [{ role: "assistant", content: "Die Küche ist hell." }], ...over }) as Conversation;

describe("VaultContextService (ADR-224)", () => {
	it("asks Schreibstube with the carried-over query, and keeps the limit", async () => {
		const { svc, searchNotes } = service(["a.md", "b.md", "c.md"], { vaultContextMaxNotes: 2 });
		expect(await svc.getRelevantNotes(conv(), "und das Bad?", ["x.md"])).toEqual(["a.md", "b.md"]);
		expect(searchNotes).toHaveBeenCalledWith("und das Bad?\n\nDie Küche ist hell.", 6, ["x.md"]);
	});

	it("drops what the scope and the opt-out exclude, and fills from further down", async () => {
		const { svc } = service(
			["Pythia/Conversations/c.md", "Notes/secret.md", "Other/a.md", "Notes/a.md", "Notes/b.md"],
			{ vaultContextFolders: ["Notes"], vaultContextMaxNotes: 2 },
			{ "Notes/secret.md": { pythia: false } }
		);
		expect(await svc.getRelevantNotes(conv(), "küche")).toEqual(["Notes/a.md", "Notes/b.md"]);
	});

	it("does nothing when vault context is off for the conversation", async () => {
		const { svc, searchNotes } = service(["a.md"]);
		expect(await svc.getRelevantNotes(conv({ vaultContext: false }), "küche")).toEqual([]);
		expect(searchNotes).not.toHaveBeenCalled();
	});

	it("remembers each conversation's last notes for the reference row", async () => {
		const { svc } = service(["a.md"]);
		await svc.getRelevantNotes(conv(), "küche");
		expect(svc.getAutoContext("c1")).toEqual(["a.md"]);
		expect(svc.getAutoContext("other")).toEqual([]);
	});
});
