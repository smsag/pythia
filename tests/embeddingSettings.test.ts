// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal `Setting` chain — enough to let renderEmbeddingSettings build its rows
// and hand us the text inputs it created.
const inputs: HTMLInputElement[] = [];
/** Every Setting row, with what it was told — for the status and model rows. */
const rows: { name: string; desc: unknown; buttons: { text: string; disabled: boolean; click: () => void }[]; el: HTMLElement }[] = [];

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
		addText(cb: (t: TextComponent) => void): this { cb(new TextComponent(this.el)); return this; }
		addTextArea(cb: (t: { setPlaceholder(): unknown; setValue(): unknown; onChange(): unknown }) => void): this {
			cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } });
			return this;
		}
		addDropdown(cb: (d: Record<string, () => unknown>) => void): this {
			const d: Record<string, () => unknown> = {
				addOption: () => d, setValue: () => d, onChange: () => d,
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

beforeEach(() => { inputs.length = 0; rows.length = 0; });

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

describe("model row explains what this device runs (ADR-198)", () => {
	const modelRow = () => rows.find((r) => r.name === t("embeddingModelName"))!;

	it("on desktop with Multilingual, says phones use English and why", () => {
		renderEmbeddingSettings(document.createElement("div"), fakePlugin() as unknown as PythiaPlugin);
		const desc = String(modelRow().desc);
		expect(desc).toContain(t("embeddingModelDesktopNote", { model: "English", chosen: "Multilingual" }));
		expect(desc).toContain("120 MB");
	});

	it("on a phone, says it is using English instead and that the choice still holds on desktop", () => {
		renderEmbeddingSettings(document.createElement("div"), fakePlugin({ active: "xenova-all-MiniLM-L6-v2" }) as unknown as PythiaPlugin);
		expect(String(modelRow().desc)).toContain(t("embeddingModelMobileNote", { model: "English", chosen: "Multilingual" }));
	});

	it("adds no note when the chosen model runs everywhere", () => {
		const plugin = fakePlugin({ active: "xenova-all-MiniLM-L6-v2" });
		plugin.settings.embeddingModelId = "xenova-all-MiniLM-L6-v2";
		renderEmbeddingSettings(document.createElement("div"), plugin as unknown as PythiaPlugin);
		expect(String(modelRow().desc)).toBe(t("embeddingModelDesc", { multiMb: 120, enMb: 25 }));
	});
});

describe("index status row (ADR-198)", () => {
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
