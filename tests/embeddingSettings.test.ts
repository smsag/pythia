// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal `Setting` chain — enough to let renderEmbeddingSettings build its rows
// and hand us the text inputs it created.
const inputs: HTMLInputElement[] = [];
const dropdownOptions: string[] = [];
/** Every Setting row, with what it was told — for the status and model rows. */
const rows: { name: string; desc: unknown; buttons: { text: string; disabled: boolean; click: () => void }[]; el: HTMLElement }[] = [];
/** Every textarea the settings built, with a way to type into it. */
const textAreas: { value: string; fire: (v: string) => void }[] = [];

vi.mock("obsidian", () => {
	class TextComponent {
		inputEl: HTMLInputElement;
		constructor(parent: HTMLElement) {
			this.inputEl = document.createElement("input");
			parent.appendChild(this.inputEl);
			inputs.push(this.inputEl);
		}
		setPlaceholder(): this { return this; }
		setValue(v: string): this { this.inputEl.value = v; return this; }
		getValue(): string { return this.inputEl.value; }
		onChange(): this { return this; }
	}
	class Setting {
		private readonly el: HTMLElement;
		readonly settingEl: HTMLElement;
		private readonly row: (typeof rows)[number];
		constructor(parent: HTMLElement) {
			this.el = document.createElement("div");
			this.settingEl = this.el;
			parent.appendChild(this.el);
			this.row = { name: "", desc: null, buttons: [], el: this.el };
			rows.push(this.row);
		}
		setName(n: string): this { this.row.name = n; return this; }
		setDesc(d: unknown): this { this.row.desc = d; return this; }
		setHeading(): this { return this; }
		setClass(): this { return this; }
		addText(cb: (t: TextComponent) => void): this { cb(new TextComponent(this.el)); return this; }
		addTextArea(cb: (t: { setPlaceholder(): unknown; setValue(v: string): unknown; onChange(fn: (v: string) => void): unknown }) => void): this {
			const area = {
				setPlaceholder() { return this; },
				setValue(v: string) { textAreas.push({ value: v, fire: () => {} }); return this; },
				onChange(fn: (v: string) => void) {
					const last = textAreas[textAreas.length - 1];
					if (last) last.fire = (v: string) => { last.value = v; fn(v); };
					return this;
				},
			};
			cb(area as never);
			return this;
		}
		addDropdown(cb: (d: Record<string, () => unknown>) => void): this {
			const d: Record<string, (...a: never[]) => unknown> = {
				addOption: (v: string) => { dropdownOptions.push(v); return d; }, setValue: () => d, onChange: () => d,
			};
			cb(d);
			return this;
		}
		addButton(cb: (b: Record<string, (...a: never[]) => unknown>) => void): this {
			const state = { text: "", disabled: false, click: () => {} };
			this.row.buttons.push(state);
			const b: Record<string, (...a: never[]) => unknown> = {
				setButtonText: (text: string) => { state.text = text; return b; },
				setTooltip: () => b,
				setDisabled: (d: boolean) => { state.disabled = d; return b; },
				onClick: (fn: () => void) => { state.click = fn; return b; },
			};
			cb(b);
			return this;
		}
		addToggle(cb: (t: Record<string, () => unknown>) => void): this {
			const t: Record<string, () => unknown> = { setValue: () => t, onChange: () => t };
			cb(t);
			return this;
		}
	}
	return { Setting };
});

import { renderEmbeddingSettings } from "../ui/embeddingSettings";
import { DEFAULT_SETTINGS } from "../models/settings";
import type PythiaPlugin from "../main";
import type { EmbeddingModelId } from "../models/embeddingModels";
import type { VaultIndexStatus } from "../services/embedding/indexStatus";
import { t } from "../i18n";

const fakePlugin = (over: { active?: EmbeddingModelId; status?: Partial<VaultIndexStatus> } = {}) => {
	const listeners = new Set<() => void>();
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, vaultContextMaxIndexedNotes: 5000 },
		saves: 0,
		builds: 0,
		status: {
			state: "notBuilt", count: 0, done: 0, total: 0, error: null, outOfMemory: false, marker: null,
			backend: null, modelId: DEFAULT_SETTINGS.embeddingModelId, modelSubstituted: false, enabledByDefault: true,
			...over.status,
		} as VaultIndexStatus,
		listeners,
		saveSettingsSoon() { this.saves++; },
		async saveSettings() {},
		invalidateRelatedService() {},
		activeEmbeddingModelId: () => over.active ?? DEFAULT_SETTINGS.embeddingModelId,
		vaultIndexStatus: async () => plugin.status,
		onVaultIndexChange: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
		buildVaultIndexNow() { this.builds++; },
		reindexVault: async () => {},
	};
	return plugin;
};

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => { inputs.length = 0; rows.length = 0; dropdownOptions.length = 0; textAreas.length = 0; });

describe("vaultContextMaxIndexedNotes field (ADR-171 rule, ADR-182 fix)", () => {
	const render = () => {
		const plugin = fakePlugin();
		const commits: (() => void)[] = [];
		renderEmbeddingSettings(document.createElement("div"), plugin as unknown as PythiaPlugin, (c) => commits.push(c));
		// Two numeric fields, in creation order: the index cap, then notes-per-turn.
		const [input, perTurn] = inputs;
		return { plugin, commits, input, perTurn };
	};

	it("registers a commit, so the tab can flush it when it closes", () => {
		// A per-keystroke `onChange` field registers nothing — closing the tab
		// destroys the input before `blur` fires, which is why the flush exists.
		const { commits } = render();
		expect(commits.length).toBe(2); // the index cap and notes-per-turn
	});

	it("shows the stored value", () => {
		const { input } = render();
		expect(input.value).toBe("5000");
	});

	it("does NOT commit per keystroke", () => {
		// Typing "500" over "5000" used to store 5, then 50, then 500 on the way —
		// and an EMPTY box stored 0, which here means UNLIMITED. On a large vault
		// that silently uncapped the index.
		const { plugin, input } = render();
		for (const v of ["", "5", "50", "500"]) {
			input.value = v;
			input.dispatchEvent(new Event("input"));
		}
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(5000);
	});

	it("commits on blur", () => {
		const { plugin, input } = render();
		input.value = "500";
		input.dispatchEvent(new Event("blur"));
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(500);
		expect(plugin.saves).toBeGreaterThan(0);
	});

	it("restores the stored value when the entry is rejected, rather than storing 0", () => {
		// The old fallback turned any unparseable entry into 0 = unlimited.
		const { plugin, input } = render();
		input.value = "not a number";
		input.dispatchEvent(new Event("blur"));
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(5000);
		expect(input.value).toBe("5000");
	});

	it("an empty box does not mean unlimited here", () => {
		const { plugin, input } = render();
		input.value = "";
		input.dispatchEvent(new Event("blur"));
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(5000);
	});

	it("still accepts an explicit 0 (the documented 'unlimited')", () => {
		const { plugin, input } = render();
		input.value = "0";
		input.dispatchEvent(new Event("blur"));
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(0);
	});

	it("exposes notes-per-turn, which had no UI at all", () => {
		// It was reachable only by hand-editing data.json, so everyone ran the
		// hardcoded 5 whatever their context budget looked like.
		const { plugin, perTurn } = render();
		expect(perTurn.value).toBe(String(plugin.settings.vaultContextMaxNotes));
		perTurn.value = "3";
		perTurn.dispatchEvent(new Event("blur"));
		expect(plugin.settings.vaultContextMaxNotes).toBe(3);
	});

	it("refuses a notes-per-turn value that would mean 'none' or 'absurd'", () => {
		// 0 here is not "unlimited" like the index cap — it would mean retrieval is
		// on and silently contributes nothing, which is the least explicable state.
		const { plugin, perTurn } = render();
		const stored = plugin.settings.vaultContextMaxNotes;
		for (const v of ["0", "-1", "500"]) {
			perTurn.value = v;
			perTurn.dispatchEvent(new Event("blur"));
			expect(plugin.settings.vaultContextMaxNotes).toBe(stored);
		}
	});
});

describe("model row explains what this device runs (ADR-199)", () => {
	const modelRow = () => rows.find((r) => r.name === t("embeddingModelName"))!;

	it("on desktop with Multilingual, says phones use the Latin-script variant and what that means", () => {
		renderEmbeddingSettings(document.createElement("div"), fakePlugin() as unknown as PythiaPlugin);
		const desc = String(modelRow().desc);
		expect(desc).toContain(t("embeddingModelDesktopNote", { model: "Multilingual (Latin script)", chosen: "Multilingual" }));
		expect(desc).toContain(t("embeddingModelLatinNote"));
		expect(desc).toContain("120 MB");
	});

	it("on a phone, says it is using the variant and that the choice still holds on desktop", () => {
		renderEmbeddingSettings(document.createElement("div"), fakePlugin({ active: "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin" }) as unknown as PythiaPlugin);
		const desc = String(modelRow().desc);
		expect(desc).toContain(t("embeddingModelMobileNote", { model: "Multilingual (Latin script)", chosen: "Multilingual" }));
		expect(desc).toContain(t("embeddingModelLatinNote"));
	});

	it("the dropdown offers the two full models, never the variant (ADR-200)", () => {
		renderEmbeddingSettings(document.createElement("div"), fakePlugin() as unknown as PythiaPlugin);
		// The model dropdown is the first one rendered; the similarity presets follow.
		expect(dropdownOptions.slice(0, 2)).toEqual(["xenova-all-MiniLM-L6-v2", "xenova-paraphrase-multilingual-MiniLM-L12-v2"]);
		expect(dropdownOptions).not.toContain("xenova-paraphrase-multilingual-MiniLM-L12-v2-latin");
	});

	it("adds no note when the chosen model runs everywhere", () => {
		const plugin = fakePlugin({ active: "xenova-all-MiniLM-L6-v2" });
		plugin.settings.embeddingModelId = "xenova-all-MiniLM-L6-v2";
		renderEmbeddingSettings(document.createElement("div"), plugin as unknown as PythiaPlugin);
		expect(String(modelRow().desc)).toBe(t("embeddingModelDesc", { multiMb: 120, enMb: 25 }));
	});
});

describe("index status row (ADR-199)", () => {
	const statusRow = () => rows.find((r) => r.name === t("vaultIndexStatusName"))!;
	const text = (): string => (statusRow().desc as DocumentFragment).textContent ?? "";

	it("paints the state and the detail line on open", async () => {
		renderEmbeddingSettings(document.body.appendChild(document.createElement("div")), fakePlugin({ status: { state: "ready", count: 51 } }) as unknown as PythiaPlugin);
		await flush();
		expect(text()).toContain(t("vaultIndexStateReady", { count: 51 }));
		expect(text()).toContain(t("vaultIndexDetailModel", { model: "Multilingual" }));
	});

	it("Build now is disabled while there is nothing to do, and runs a build when there is", async () => {
		const plugin = fakePlugin({ status: { state: "ready", count: 3 } });
		renderEmbeddingSettings(document.body.appendChild(document.createElement("div")), plugin as unknown as PythiaPlugin);
		await flush();
		const [buildNow] = statusRow().buttons;
		expect(buildNow.text).toBe(t("vaultIndexBuildNow"));
		expect(buildNow.disabled).toBe(true);

		plugin.status = { ...plugin.status, state: "paused", marker: { attempts: 2, startedAt: 0, modelId: "" } };
		for (const l of plugin.listeners) l();
		await flush();
		expect(buildNow.disabled).toBe(false);
		expect(text()).toContain(t("vaultIndexStatePaused", { count: 2 }));
		buildNow.click();
		expect(plugin.builds).toBe(1);
	});

	it("follows a running build live", async () => {
		const plugin = fakePlugin();
		renderEmbeddingSettings(document.body.appendChild(document.createElement("div")), plugin as unknown as PythiaPlugin);
		await flush();
		plugin.status = { ...plugin.status, state: "building", done: 7, total: 51 };
		for (const l of plugin.listeners) l();
		await flush();
		expect(text()).toContain(t("vaultIndexStateBuilding", { done: 7, total: 51 }));
	});

	it("unsubscribes once its row has left the DOM (the tab re-rendered or closed)", async () => {
		const plugin = fakePlugin();
		const host = document.body.appendChild(document.createElement("div"));
		renderEmbeddingSettings(host, plugin as unknown as PythiaPlugin);
		await flush();
		expect(plugin.listeners.size).toBe(1);
		host.remove();
		for (const l of [...plugin.listeners]) l();
		expect(plugin.listeners.size).toBe(0);
	});
});

describe("the status row follows a scope change (#367)", () => {
	const statusRowOf = () => rows.find((r) => r.name === t("vaultIndexStatusName"))!;
	const buildNowBtn = () => statusRowOf().buttons.find((b) => b.text === t("vaultIndexBuildNow"))!;

	/** A plugin whose status answers like the real service: complete under the
	 *  scope the index was built with, out of date once the folders change. */
	const render = async () => {
		const plugin = fakePlugin({ status: { state: "ready", count: 12 } });
		const indexedFolders = ["Notes"];
		plugin.settings.vaultContextFolders = [...indexedFolders];
		plugin.vaultIndexStatus = async () => ({
			...plugin.status,
			state: plugin.settings.vaultContextFolders.join("|") === indexedFolders.join("|") ? "ready" : "outdated",
		});
		renderEmbeddingSettings(document.createElement("div"), plugin as unknown as PythiaPlugin);
		await flush();
		return { plugin };
	};

	it("enables Build now once a folder is added", async () => {
		const { plugin } = await render();
		expect(buildNowBtn().disabled).toBe(true); // ready: nothing to do, correctly

		// The user adds a second folder. The index is now out of date, and the one
		// control that would fix it non-destructively must become available —
		// otherwise the only working button is the one that re-embeds everything.
		textAreas[0].fire("Notes\nInsights");
		await flush();
		expect(plugin.settings.vaultContextFolders).toEqual(["Notes", "Insights"]);
		expect(buildNowBtn().disabled).toBe(false);
	});

	it("enables it when the note cap changes too — the cap is part of the scope", async () => {
		const plugin = fakePlugin({ status: { state: "ready", count: 12 } });
		const indexedCap = plugin.settings.vaultContextMaxIndexedNotes;
		plugin.vaultIndexStatus = async () => ({
			...plugin.status,
			state: plugin.settings.vaultContextMaxIndexedNotes === indexedCap ? "ready" : "outdated",
		});
		const commits: (() => void)[] = [];
		renderEmbeddingSettings(document.createElement("div"), plugin as unknown as PythiaPlugin, (c) => commits.push(c));
		await flush();
		expect(buildNowBtn().disabled).toBe(true);

		const [cap] = inputs;
		cap.value = "200";
		cap.dispatchEvent(new Event("blur"));
		await flush();
		expect(plugin.settings.vaultContextMaxIndexedNotes).toBe(200);
		expect(buildNowBtn().disabled).toBe(false);
	});

	it("says the index is out of date, rather than still claiming ready", async () => {
		await render();
		textAreas[0].fire("Notes\nInsights");
		await flush();
		const desc = statusRowOf().desc as DocumentFragment;
		expect(desc.textContent).toContain(t("vaultIndexStateOutdated"));
	});
});
