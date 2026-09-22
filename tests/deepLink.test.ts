import { describe, it, expect, vi } from "vitest";
import { handleDeepLink, type DeepLinkHost } from "../services/deepLink";
import { t } from "../i18n";

function host(over: Partial<DeepLinkHost> = {}) {
	const calls: string[] = [];
	const notices: string[] = [];
	const h: DeepLinkHost & { calls: string[]; notices: string[] } = {
		calls,
		notices,
		open: async () => { calls.push("open"); },
		create: async () => { calls.push("create"); },
		resume: async (id) => { calls.push(`resume:${id}`); return true; },
		template: async (name) => { calls.push(`template:${name}`); return true; },
		inject: async (text) => { calls.push(`inject:${text}`); return true; },
		templatesFolder: () => "Templates",
		notice: (m) => notices.push(m),
		...over,
	};
	return h;
}

describe("obsidian://pythia — routing", () => {
	it("a link with no cmd opens the view: the only useful verbless action", async () => {
		const h = host();
		await handleDeepLink({ vault: "Mein Vault" }, h);
		expect(h.calls).toEqual(["open"]);
		expect(h.notices).toEqual([]);
	});

	it("routes each known cmd to its action and nothing else", async () => {
		for (const [cmd, params, expected] of [
			["open", {}, "open"],
			["new", {}, "create"],
			["resume", { id: "c1" }, "resume:c1"],
			["template", { name: "Podcast" }, "template:Podcast"],
			["inject", { text: "hello" }, "inject:hello"],
		] as const) {
			const h = host();
			await handleDeepLink({ cmd, ...params }, h);
			expect(h.calls).toEqual([expected]);
			expect(h.notices).toEqual([]);
		}
	});

	it("an unknown cmd says so, naming it — a silent no-op is unreportable", async () => {
		const h = host();
		await handleDeepLink({ cmd: "summon" }, h);
		expect(h.calls).toEqual([]);
		expect(h.notices).toEqual([t("unknownAction", { action: "summon" })]);
	});
});

describe("obsidian://pythia — missing parameters", () => {
	it("resume without an id never guesses a conversation", async () => {
		const h = host();
		await handleDeepLink({ cmd: "resume" }, h);
		expect(h.calls).toEqual([]);
		expect(h.notices).toEqual([t("uriMissingId")]);
	});

	it("template without a name says which parameter is missing", async () => {
		const h = host();
		await handleDeepLink({ cmd: "template" }, h);
		expect(h.calls).toEqual([]);
		expect(h.notices).toEqual([t("uriMissingName")]);
	});

	it("inject with no text, and with empty text, are the same thing", async () => {
		for (const params of [{ cmd: "inject" }, { cmd: "inject", text: "" }]) {
			const h = host();
			await handleDeepLink(params, h);
			expect(h.calls).toEqual([]);
			expect(h.notices).toEqual([t("uriMissingText")]);
		}
	});
});

describe("obsidian://pythia — the thing named is not there", () => {
	it("an unknown conversation id is reported with the id", async () => {
		const h = host({ resume: async () => false });
		await handleDeepLink({ cmd: "resume", id: "gone" }, h);
		expect(h.notices).toEqual([t("convNotFound", { id: "gone" })]);
	});

	it("an unknown template is reported with the name", async () => {
		const h = host({ template: async () => false });
		await handleDeepLink({ cmd: "template", name: "Nope" }, h);
		expect(h.notices).toEqual([t("templateNotFound", { name: "Nope" })]);
	});

	it("inject with no templates at all names the folder to look in", async () => {
		const h = host({ inject: async () => false, templatesFolder: () => "Vorlagen" });
		await handleDeepLink({ cmd: "inject", text: "hi" }, h);
		expect(h.notices).toEqual([t("noTemplatesFound", { folder: "Vorlagen" })]);
	});

	it("says nothing when the action succeeded", async () => {
		const h = host();
		await handleDeepLink({ cmd: "resume", id: "c1" }, h);
		expect(h.notices).toEqual([]);
	});
});

describe("obsidian://pythia — text is used exactly as delivered", () => {
	it("a bare % survives: Obsidian already decoded the parameter", async () => {
		const h = host();
		// Decoding again throws URIError on "50% off" — the bug this rule prevents.
		await handleDeepLink({ cmd: "inject", text: "50% off & 100% sure" }, h);
		expect(h.calls).toEqual(["inject:50% off & 100% sure"]);
		expect(h.notices).toEqual([]);
	});
});

describe("obsidian://pythia — errors cannot escape", () => {
	it("a rejected action becomes a Notice, because Obsidian does not await the handler", async () => {
		const h = host({ resume: async () => { throw new Error("disk on fire"); } });
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handleDeepLink({ cmd: "resume", id: "c1" }, h)).resolves.toBeUndefined();
		expect(h.notices).toEqual([t("deepLinkError", { error: "disk on fire" })]);
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});

	it("a thrown non-Error is still reported", async () => {
		const h = host({ open: async () => { throw "nope"; } });
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		await handleDeepLink({ cmd: "open" }, h);
		expect(h.notices).toEqual([t("deepLinkError", { error: "nope" })]);
		err.mockRestore();
	});
});
