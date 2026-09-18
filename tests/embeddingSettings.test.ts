// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal `Setting` chain — enough to let renderEmbeddingSettings build its rows
// and hand us the text inputs it created.
const inputs: HTMLInputElement[] = [];

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
		constructor(parent: HTMLElement) { this.el = document.createElement("div"); parent.appendChild(this.el); }
		setName(): this { return this; }
		setDesc(): this { return this; }
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
		addButton(cb: (b: Record<string, () => unknown>) => void): this {
			const b: Record<string, () => unknown> = { setButtonText: () => b, onClick: () => b };
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

const fakePlugin = () => ({
	settings: { ...DEFAULT_SETTINGS, vaultContextMaxIndexedNotes: 5000 },
	saves: 0,
	saveSettingsSoon() { this.saves++; },
	async saveSettings() {},
	invalidateRelatedService() {},
	getVaultIndexStatus: () => "idle",
	reindexVault: async () => {},
});

beforeEach(() => { inputs.length = 0; });

describe("vaultContextMaxIndexedNotes field (ADR-171 rule, ADR-179 fix)", () => {
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
