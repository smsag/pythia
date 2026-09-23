// @vitest-environment happy-dom
//
// The settings tab's information architecture (ADR-209), in the forbidden
// direction: every rule the tab is organised by has a test that fails when a new
// setting breaks it, because the previous arrangement drifted exactly by rows
// being added where nobody had decided they belonged (principle 3).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Obsidian's Element.prototype helpers, the subset the settings tab calls ────
function installDomHelpers(): void {
	type Opts = { cls?: string | string[]; text?: string; type?: string; placeholder?: string; href?: string };
	const p = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	function apply(el: Element, o?: Opts): void {
		if (!o) return;
		if (o.cls) (el as HTMLElement).className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
		if (o.text != null) el.textContent = o.text;
		for (const k of ["type", "placeholder", "href"] as const) if (o[k] != null) el.setAttribute(k, o[k] as string);
	}
	p.createEl = function (this: Element, tag: string, o?: Opts): Element {
		const e = document.createElement(tag); apply(e, o); this.appendChild(e); return e;
	};
	p.createDiv = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("div", o);
	};
	p.empty = function (this: Element): void { while (this.firstChild) this.removeChild(this.firstChild); };
	p.setText = function (this: Element, s: string): void { this.textContent = s; };
	p.appendText = function (this: Element, s: string): void { this.appendChild(document.createTextNode(s)); };
	p.addClass = function (this: Element, ...c: string[]): void { this.classList.add(...c); };
}
installDomHelpers();

/** One rendered row, in creation order. */
interface Row { name: string; desc: string; heading: boolean; cls: string[]; disabled: boolean }
const rows: Row[] = [];

vi.mock("obsidian", () => {
	class TextComponent {
		inputEl: HTMLInputElement;
		constructor(parent: HTMLElement) { this.inputEl = document.createElement("input"); parent.appendChild(this.inputEl); }
		setPlaceholder(): this { return this; }
		setValue(v: string): this { this.inputEl.value = v; return this; }
		getValue(): string { return this.inputEl.value; }
		onChange(): this { return this; }
	}
	class Setting {
		readonly settingEl: HTMLElement;
		readonly controlEl: HTMLElement;
		readonly descEl: HTMLElement;
		private readonly row: Row;
		constructor(parent: HTMLElement) {
			this.settingEl = document.createElement("div");
			this.controlEl = document.createElement("div");
			this.descEl = document.createElement("div");
			this.settingEl.append(this.descEl, this.controlEl);
			parent.appendChild(this.settingEl);
			this.row = { name: "", desc: "", heading: false, cls: [], disabled: false };
			rows.push(this.row);
		}
		setName(n: string): this { this.row.name = n; return this; }
		setDesc(d: unknown): this { this.row.desc = typeof d === "string" ? d : String((d as { textContent?: string })?.textContent ?? ""); return this; }
		setHeading(): this { this.row.heading = true; return this; }
		setClass(c: string): this { this.row.cls.push(c); return this; }
		setDisabled(d: boolean): this { this.row.disabled = d; return this; }
		addText(cb: (t: TextComponent) => void): this { cb(new TextComponent(this.controlEl)); return this; }
		addTextArea(cb: (t: unknown) => void): this {
			const el = document.createElement("textarea");
			this.controlEl.appendChild(el);
			const area = { inputEl: el, setPlaceholder: () => area, setValue: () => area, onChange: () => area };
			cb(area);
			return this;
		}
		addDropdown(cb: (d: unknown) => void): this {
			const d: Record<string, (...a: never[]) => unknown> = {
				addOption: () => d, setValue: () => d, onChange: () => d,
			};
			cb(d);
			return this;
		}
		addToggle(cb: (t: unknown) => void): this {
			const g: Record<string, (...a: never[]) => unknown> = { setValue: () => g, onChange: () => g };
			cb(g);
			return this;
		}
		addButton(cb: (b: unknown) => void): this {
			const b: Record<string, (...a: never[]) => unknown> = {
				setButtonText: () => b, setTooltip: () => b, setCta: () => b, setDisabled: () => b, onClick: () => b,
			};
			cb(b);
			return this;
		}
		addComponent(cb: (el: HTMLElement) => void): this { cb(this.controlEl); return this; }
	}
	class SecretComponent {
		setValue(): this { return this; }
		onChange(): this { return this; }
	}
	const cls = (): new (...a: never[]) => object => class {};
	return {
		Setting, SecretComponent, TextComponent,
		Modal: cls(), SuggestModal: cls(), FuzzySuggestModal: cls(), TFolder: cls(), TFile: cls(),
		Notice: cls(), Platform: { isMobile: false, isDesktop: true },
		setIcon: () => {},
	};
});

import { renderConnectionsSection } from "../ui/settings/connections";
import { renderNewConversationsSection } from "../ui/settings/conversationDefaults";
import { renderAnsweringSection } from "../ui/settings/answering";
import { renderOptimizerSection } from "../ui/settings/optimizer";
import { renderNotesSection } from "../ui/settings/notes";
import { renderStorageSection } from "../ui/settings/storage";
import { renderTroubleshootingSection } from "../ui/settings/troubleshooting";
import type { SettingsContext } from "../ui/settings/context";
import { DEFAULT_SETTINGS } from "../models/settings";
import type PythiaPlugin from "../main";
import { t } from "../i18n";

const ROOT = resolve(__dirname, "..");
const read = (f: string): string => readFileSync(resolve(ROOT, f), "utf8");
/** The file's CODE, without comments — these rules name the forbidden constructs
 *  in their own prose, and a scan that reads the prose fails on the explanation
 *  rather than on the mistake. */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function makeCtx(over: Partial<typeof DEFAULT_SETTINGS> = {}): { ctx: SettingsContext; host: HTMLElement; refreshes: () => number } {
	let refreshes = 0;
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, ...over },
		app: {},
		conversations: [],
		plaintextSearchKey: "",
		hasApiKeyFor: () => false,
		saveSettings: async () => {},
		saveSettingsSoon: () => {},
		pendingEvictionCount: () => 0,
		pluginDataStore: { dataFileBytes: async () => null },
		glossaryService: { invalidate: () => {} },
	};
	const host = document.createElement("div");
	return {
		host,
		refreshes: () => refreshes,
		ctx: {
			plugin: plugin as unknown as PythiaPlugin,
			saveSoon: () => {},
			registerCommit: () => {},
			refreshIndexStatus: () => { refreshes++; },
		},
	};
}

/** The rows of one section: its heading, its intro, and the settings under them. */
interface Section { heading: string; intro: string; controls: Row[] }

function sectionsOf(): Section[] {
	const out: Section[] = [];
	for (const row of rows) {
		if (row.heading) { out.push({ heading: row.name, intro: "", controls: [] }); continue; }
		const current = out[out.length - 1];
		if (!current) continue;
		if (row.cls.includes("pythia-section-intro")) { current.intro = row.desc; continue; }
		current.controls.push(row);
	}
	return out;
}

/** Every section module except the embedding block, which has its own suite. */
const RENDERERS = [
	renderConnectionsSection,
	renderNewConversationsSection,
	renderAnsweringSection,
	renderOptimizerSection,
	renderNotesSection,
	renderStorageSection,
	renderTroubleshootingSection,
];

function renderAll(over: Partial<typeof DEFAULT_SETTINGS> = {}): Section[] {
	const { ctx, host } = makeCtx(over);
	for (const render of RENDERERS) render(host, ctx);
	return sectionsOf();
}

beforeEach(() => { rows.length = 0; document.body.innerHTML = ""; });

describe("every section names its own remit (ADR-209)", () => {
	it("opens with a heading and one non-empty intro sentence", () => {
		// "Behaviour" and "Features" were the sections nobody could write a sentence
		// for, and they are where ten unrelated rows accumulated. A section with no
		// remit to state has no remit.
		const sections = renderAll();
		expect(sections.length).toBe(RENDERERS.length + 1); // Notes carries the Glossary subsection
		for (const s of sections) {
			expect(s.heading, "a section with no name").not.toBe("");
			expect(s.intro.length, `${s.heading} has no intro`).toBeGreaterThan(20);
		}
	});

	it("gives every section at least one control", () => {
		for (const s of renderAll()) {
			expect(s.controls.length, `${s.heading} is an empty heading`).toBeGreaterThan(0);
		}
	});
});

describe("scope is the organising axis (ADR-209, principle 6)", () => {
	// claude-sonnet-4-6 accepts both temperature and effort, so every row of the
	// section is in its overridable state and the rule can be asserted whole.
	const both = { defaultAnthropicModel: "claude-sonnet-4-6" };

	it("every row of New conversations says a conversation can override it", () => {
		const s = renderAll(both).find((x) => x.heading === t("newConvSection"))!;
		const silent = s.controls.filter((r) => !r.desc.endsWith(t("overridablePerConv")));
		expect(silent.map((r) => r.name)).toEqual([]);
		expect(s.controls.length).toBeGreaterThanOrEqual(8);
	});

	it("no row outside New conversations claims to be overridable", () => {
		const offenders = renderAll(both)
			.filter((s) => s.heading !== t("newConvSection"))
			.flatMap((s) => s.controls.filter((r) => r.desc.includes(t("overridablePerConv"))).map((r) => `${s.heading} → ${r.name}`));
		expect(offenders).toEqual([]);
	});

	it("custom instructions sit with the global rules, not the defaults", () => {
		// They apply to conversations already underway, so they are not something a
		// new conversation "starts with"; before ADR-209 they rendered after the
		// embedding block and read as a vault-context setting.
		const sections = renderAll();
		const home = sections.find((s) => s.controls.some((r) => r.name === t("customInstructionsName")))!;
		expect(home.heading).toBe(t("answeringSection"));
	});

	it("debug mode sits in Troubleshooting, not inside the embedding block", () => {
		const sections = renderAll();
		const home = sections.find((s) => s.controls.some((r) => r.name === t("debugModeName")))!;
		expect(home.heading).toBe(t("troubleshootingSection"));
	});
});

describe("the model row follows the chosen provider (ADR-209)", () => {
	it("is one row, naming the provider it belongs to", () => {
		const s = renderAll({ defaultProvider: "openai" }).find((x) => x.heading === t("newConvSection"))!;
		const model = s.controls.filter((r) => r.name === t("defaultModelName"));
		expect(model.length).toBe(1);
		expect(model[0].desc).toContain(t("providerOpenAI"));
	});

	it("gates temperature and effort against that provider's default model", () => {
		// claude-sonnet-5 takes effort but no temperature; the suffix replaces the
		// overridable sentence, because a live control the model ignores was the
		// original defect (#87).
		const s = renderAll({ defaultAnthropicModel: "claude-sonnet-5" }).find((x) => x.heading === t("newConvSection"))!;
		const temp = s.controls.find((r) => r.name === t("temperatureName"))!;
		const effort = s.controls.find((r) => r.name === t("effortName"))!;
		expect(temp.disabled).toBe(true);
		expect(temp.desc).toContain(t("paramUnsupportedSuffix"));
		expect(effort.disabled).toBe(false);
		expect(effort.desc.endsWith(t("overridablePerConv"))).toBe(true);
	});
});

describe("a folder lives with the feature that writes to it (ADR-209)", () => {
	it("the two index skip folders repaint the index status row (#367)", () => {
		// The conversations and default-notes folders are `scopeSignature`'s skip
		// list, so moving one makes the index out of date. Before ADR-209 they had
		// no way to reach the status row and it went on reading "Ready" with the one
		// non-destructive action greyed out.
		const skip = ["conversationsFolder", "scratchFolder"];
		for (const file of ["ui/settings/notes.ts", "ui/settings/storage.ts"]) {
			const src = read(file);
			for (const key of skip) {
				if (!src.includes(`"${key}"`)) continue;
				const line = src.split("\n").find((l) => l.includes(`"${key}"`))!;
				expect(line, `${file}: the ${key} picker must pass ctx.refreshIndexStatus`).toContain("ctx.refreshIndexStatus");
			}
		}
	});

	it("keeps the archive folder beside the toggle that writes to it", () => {
		const s = renderAll().find((x) => x.heading === t("storageSection"))!;
		const names = s.controls.map((r) => r.name);
		expect(names).toContain(t("archiveFolderName"));
		expect(names.indexOf(t("archiveFolderName"))).toBe(names.indexOf(t("archiveBeforeEvictionName")) + 1);
	});
});

describe("one way to make a heading (ADR-209, principle 3)", () => {
	const SETTINGS_SOURCES = [
		"settings.ts",
		"ui/settings/context.ts",
		"ui/settings/connections.ts",
		"ui/settings/conversationDefaults.ts",
		"ui/settings/answering.ts",
		"ui/settings/optimizer.ts",
		"ui/settings/notes.ts",
		"ui/settings/storage.ts",
		"ui/settings/troubleshooting.ts",
		"ui/embeddingSettings.ts",
		"ui/glossarySettings.ts",
		"ui/pricingSettings.ts",
		"ui/conversationCapSetting.ts",
		"ui/vaultIndexStatusSetting.ts",
	];

	it("no raw h2/h3 anywhere in the settings tab", () => {
		// The tab mixed createEl("h3") with Obsidian's setHeading(), which do not
		// render alike — one idea with two visual tiers.
		const offenders = SETTINGS_SOURCES.filter((f) => /createEl\(\s*"h[1-6]"/.test(code(f)));
		expect(offenders).toEqual([]);
	});

	it("setHeading() is called in exactly one place", () => {
		const callers = SETTINGS_SOURCES.filter((f) => code(f).includes("setHeading()"));
		expect(callers).toEqual([]);
		expect(code("ui/settings/section.ts")).toContain("setHeading()");
	});

	it("overridable() is written by one module and used by one section", () => {
		const users = SETTINGS_SOURCES.filter((f) => /\boverridable\(/.test(code(f)) && f !== "ui/settings/context.ts");
		expect(users).toEqual(["ui/settings/conversationDefaults.ts"]);
	});
});

describe("the tab is a shell, and the order is the architecture (ADR-209)", () => {
	it("renders the sections in the documented order", () => {
		const src = read("settings.ts");
		const order = [
			"renderConnectionsSection",
			"renderNewConversationsSection",
			"renderAnsweringSection",
			"renderOptimizerSection",
			"renderEmbeddingSettings",
			"renderNotesSection",
			"renderStorageSection",
			"renderTroubleshootingSection",
		];
		const positions = order.map((name) => src.indexOf(`${name}(containerEl`));
		expect(positions.every((p) => p > 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("holds no settings rows of its own", () => {
		// Every row belongs to a section module; a `new Setting(` here is a row that
		// no section's remit had to cover — which is how the tab grew to 528 lines.
		expect(code("settings.ts")).not.toContain("new Setting(");
	});

	it("the embedding block renders before the sections that repaint its status row", () => {
		const src = read("settings.ts");
		expect(src.indexOf("renderEmbeddingSettings")).toBeLessThan(src.indexOf("renderNotesSection"));
		expect(src.indexOf("renderEmbeddingSettings")).toBeLessThan(src.indexOf("renderStorageSection"));
	});
});
