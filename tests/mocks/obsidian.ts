// Headless `obsidian` stub for view-render smoke tests (engineering-review #125).
//
// The real `obsidian` npm package ships types only (`"main": ""`), so anything
// that imports it must be mocked to run under Vitest. Most suites do that inline
// with `vi.mock("obsidian", …)`; the view-render suite instead mounts the REAL
// PythiaSidebarView + plugin, which pulls the whole `obsidian` surface through
// `main.ts`/`sidebar.ts`, so the stub lives here and is wired in via a Vitest
// `resolve.alias` (see vitest.config.ts). Suites that declare their own
// `vi.mock("obsidian")` still shadow this alias, so their behaviour is unchanged.
//
// This provides just enough of the API for the plugin to boot headlessly and for
// the view to build its DOM. `document` is happy-dom's, available because this
// module is only imported from tests that run in the happy-dom environment.

const noop = (): void => {};
const anoop = async (): Promise<void> => {};
const cls = (): new () => object => class {};

export class Component {
	registerDomEvent(el: EventTarget, type: string, cb: EventListener): void {
		try { el.addEventListener(type, cb); } catch { /* ignore */ }
	}
	registerEvent(): void {}
	register(): void {}
	registerInterval(): void {}
	addChild<T>(c: T): T { return c; }
	load(): void {}
	onload(): void {}
	unload(): void {}
}

export class ItemView extends Component {
	leaf: unknown;
	app: unknown;
	containerEl: { children: Element[]; empty(): void };
	constructor(leaf: { app: unknown }) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		const root = document.createElement("div");
		const header = document.createElement("div");  // children[0] — leaf header, never touched
		const content = document.createElement("div"); // children[1] — content pane
		document.body.appendChild(root);
		root.appendChild(header);
		root.appendChild(content);
		this.containerEl = {
			children: [header, content],
			empty() { header.remove(); content.remove(); },
		};
	}
}

export class Plugin extends Component {
	app: unknown;
	manifest: unknown;
	constructor(app: unknown, manifest: unknown) { super(); this.app = app; this.manifest = manifest; }
	async loadData(): Promise<unknown> { return {}; }
	async saveData(): Promise<void> {}
	registerView(): void {}
	addCommand(): void {}
	addRibbonIcon(): Element { return document.createElement("div"); }
	addSettingTab(): void {}
	registerObsidianProtocolHandler(): void {}
	addStatusBarItem(): Element { return document.createElement("div"); }
}

export class Notice {
	constructor(_msg?: string, _timeout?: number) {}
	setMessage(): void {}
	hide(): void {}
}

export const Modal = cls();
export const SuggestModal = cls();
export const FuzzySuggestModal = cls();
export const PluginSettingTab = cls();
export const MarkdownView = cls();
export const TFile = cls();
export const TFolder = cls();
export const TAbstractFile = cls();

// Minimal Menu that records its items and exposes the last-shown menu on a global
// so tests can inspect / invoke it (e.g. the history long-press context menu).
interface MenuItemRec { title?: string; icon?: string; click?: () => void }
export class Menu {
	items: MenuItemRec[] = [];
	addItem(cb: (item: unknown) => void): this {
		const rec: MenuItemRec = {};
		const api = {
			setTitle(t: string) { rec.title = t; return api; },
			setIcon(i: string) { rec.icon = i; return api; },
			setSection() { return api; },
			setDisabled() { return api; },
			onClick(fn: () => void) { rec.click = fn; return api; },
		};
		cb(api);
		this.items.push(rec);
		return this;
	}
	showAtPosition(): this { (globalThis as unknown as { __lastMenu?: Menu }).__lastMenu = this; return this; }
	showAtMouseEvent(): this { (globalThis as unknown as { __lastMenu?: Menu }).__lastMenu = this; return this; }
}
export const App = cls();
export const Editor = cls();
export const WorkspaceLeaf = cls();
export const ButtonComponent = cls();
export const Setting = cls();

export const Platform = { isMobile: false, isDesktop: true, isIosApp: false, isAndroidApp: false };

export const setIcon = noop;
export const getIcon = (): null => null;
export const debounce = <T>(fn: T): T => fn;
export const normalizePath = (p: string): string => p;
export const parseYaml = (): Record<string, unknown> => ({});
export const stringifyYaml = (): string => "";
export const requestUrl = anoop;

export const MarkdownRenderer = {
	render: async (_app: unknown, md: string, el: Element): Promise<void> => {
		el.appendChild(document.createTextNode(String(md)));
	},
};
