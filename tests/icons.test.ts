// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Notice } from "obsidian";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type { Conversation } from "../models/types";
import { REGENERATE_ICON } from "../ui/icons";
import { t } from "../i18n";

const root = process.cwd();
const sources = ["main.ts", "sidebar.ts", "settings.ts", ...["ui", "suggest", "services"].flatMap((d) =>
	readdirSync(resolve(root, d), { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)))];

describe("one glyph for regenerate (ADR-191)", () => {
	it("no reload glyph is written as a literal outside ui/icons.ts", () => {
		const offenders: string[] = [];
		for (const f of sources) {
			if (f === join("ui", "icons.ts")) continue;
			const src = readFileSync(resolve(root, f), "utf8");
			for (const glyph of ["refresh-cw", "refresh-ccw", "rotate-cw", "rotate-ccw"]) {
				if (src.includes(`"${glyph}"`)) offenders.push(`${f}: "${glyph}"`);
			}
		}
		expect(offenders).toEqual([]);
	});
	it("the five regenerate controls name REGENERATE_ICON", () => {
		const uses = sources.filter((f) => readFileSync(resolve(root, f), "utf8").includes("REGENERATE_ICON")).sort();
		expect(uses).toEqual(["ui/ForkController.ts", "ui/GlossaryController.ts", "ui/HeaderController.ts", "ui/MergeController.ts", "ui/SummaryController.ts", "ui/icons.ts"].sort());
		expect(REGENERATE_ICON).toBe("refresh-cw");
	});
});

describe("summary card flags an outdated summary, like the anchors (ADR-191)", () => {
	let plugin: Awaited<ReturnType<typeof makePlugin>>;
	beforeEach(async () => { document.body.innerHTML = ""; plugin = await makePlugin(); });

	async function open(over: Partial<Conversation>) {
		await seedConversation(plugin, { name: "C", ...over } as Partial<Conversation>);
		return (await mountView(plugin)).pane;
	}
	const at = (iso: string) => ({ ...userMsg("m1", "q"), timestamp: iso });

	it("a message newer than the summary: accent regenerate + 'outdated'", async () => {
		const pane = await open({ summaryText: "S.", summaryUpdatedAt: "2026-09-01T10:00:00.000Z", messages: [at("2026-09-02T10:00:00.000Z")] });
		const regen = pane().querySelector(".p-summary-card[data-kind=conversation] .p-summary-card-regen")!;
		expect(regen.classList.contains("is-stale")).toBe(true);
		expect(pane().querySelector(".p-summary-card[data-kind=conversation] .p-summary-ts")!.textContent).toContain(t("forkSummaryStale"));
	});
	it("nothing newer: plain regenerate, no 'outdated'", async () => {
		const pane = await open({ summaryText: "S.", summaryUpdatedAt: "2026-09-03T10:00:00.000Z", messages: [at("2026-09-02T10:00:00.000Z")] });
		expect(pane().querySelector(".p-summary-card-regen")!.classList.contains("is-stale")).toBe(false);
		expect(pane().querySelector(".p-summary-ts")!.textContent).not.toContain(t("forkSummaryStale"));
	});
	it("a favorite newer than the favorites summary marks that card", async () => {
		const pane = await open({
			messages: [aiMsg("a1", "answer")],
			favorites: [{ id: "f1", messageId: "a1", text: "answer", createdAt: "2026-09-05T10:00:00.000Z" }],
			favoritesSummary: { text: "K.", updatedAt: "2026-09-04T10:00:00.000Z" },
		} as Partial<Conversation>);
		expect(pane().querySelector(".p-summary-card[data-kind=favorites] .p-summary-card-regen")!.classList.contains("is-stale")).toBe(true);
	});
});

describe("an empty definition reply says so (ADR-158/191)", () => {
	it("term and person lookups report an empty reply instead of returning silently", async () => {
		const plugin = await makePlugin();
		(plugin.llmRouter as unknown as { defineTerm: () => Promise<string>; describePerson: () => Promise<string> }).defineTerm = async () => "";
		(plugin.llmRouter as unknown as { describePerson: () => Promise<string> }).describePerson = async () => "";
		(Notice as unknown as { shown: string[] }).shown = [];
		expect(await plugin.glossaryService.lookup("Zähler", "Der Zähler läuft.", true)).toBeNull();
		expect(await plugin.glossaryService.lookupPerson("Ada Lovelace", "Ada Lovelace schrieb.", true)).toBeNull();
		const shown = (Notice as unknown as { shown: string[] }).shown;
		expect(shown).toContain(t("lookupEmptyReply", { term: "Zähler" }));
		expect(shown).toContain(t("lookupEmptyReply", { term: "Ada Lovelace" }));
	});
});
