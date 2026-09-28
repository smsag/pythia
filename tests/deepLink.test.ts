import { describe, it, expect, vi } from "vitest";
import { handleDeepLink, linkText, wantsNewConversation, MAX_LINK_TEXT_CHARS, type DeepLinkHost } from "../services/deepLink";
import { pythiaLink } from "../utils";
import { t } from "../i18n";

function host(over: Partial<DeepLinkHost> = {}) {
	const calls: string[] = [];
	const notices: string[] = [];
	const h: DeepLinkHost & { calls: string[]; notices: string[] } = {
		calls,
		notices,
		ready: async () => { calls.push("ready"); },
		open: async () => { calls.push("open"); },
		create: async (text) => { calls.push(text ? `create:${text}` : "create"); },
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
		expect(h.calls).toEqual(["ready", "open"]);
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
			expect(h.calls).toEqual(["ready", expected]);
			expect(h.notices).toEqual([]);
		}
	});

	it("an unknown cmd says so, naming it — a silent no-op is unreportable", async () => {
		const h = host();
		await handleDeepLink({ cmd: "summon" }, h);
		expect(h.calls).toEqual(["ready"]);
		expect(h.notices).toEqual([t("unknownAction", { action: "summon" })]);
	});
});

describe("obsidian://pythia — missing parameters", () => {
	it("resume without an id never guesses a conversation", async () => {
		const h = host();
		await handleDeepLink({ cmd: "resume" }, h);
		expect(h.calls).toEqual(["ready"]);
		expect(h.notices).toEqual([t("uriMissingId")]);
	});

	it("template without a name says which parameter is missing", async () => {
		const h = host();
		await handleDeepLink({ cmd: "template" }, h);
		expect(h.calls).toEqual(["ready"]);
		expect(h.notices).toEqual([t("uriMissingName")]);
	});

	it("inject with no text, and with empty text, are the same thing", async () => {
		for (const params of [{ cmd: "inject" }, { cmd: "inject", text: "" }]) {
			const h = host();
			await handleDeepLink(params, h);
			expect(h.calls).toEqual(["ready"]);
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
		expect(h.calls).toEqual(["ready", "inject:50% off & 100% sure"]);
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

describe("obsidian://pythia — the shortcut link (ADR-241)", () => {
	it("the new flag starts a conversation, whatever form Obsidian delivers it in", async () => {
		for (const v of ["", "true", "1", "yes", "TRUE"]) {
			const h = host();
			await handleDeepLink({ vault: "V", new: v }, h);
			expect(h.calls, `new=${JSON.stringify(v)}`).toEqual(["ready", "create"]);
		}
	});

	it("new=0 / false / no is the explicit 'just open'", async () => {
		for (const v of ["0", "false", "no", " False "]) {
			const h = host();
			await handleDeepLink({ vault: "V", new: v }, h);
			expect(h.calls).toEqual(["ready", "open"]);
		}
	});

	it("an explicit cmd wins over the flag", async () => {
		const h = host();
		await handleDeepLink({ cmd: "open", new: "true" }, h);
		expect(h.calls).toEqual(["ready", "open"]);
	});

	it("text rides into a new conversation to be prefilled", async () => {
		const h = host();
		await handleDeepLink({ new: "true", text: "What changed this week?" }, h);
		expect(h.calls).toEqual(["ready", "create:What changed this week?"]);
		const c = host();
		await handleDeepLink({ cmd: "new", text: "hi" }, c);
		expect(c.calls).toEqual(["ready", "create:hi"]);
	});

	it("waits for the workspace before doing anything", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		const h = host({ ready: () => gate });
		const done = handleDeepLink({ new: "true" }, h);
		await Promise.resolve();
		expect(h.calls).toEqual([]);
		release();
		await done;
		expect(h.calls).toEqual(["create"]);
	});
});

describe("obsidian://pythia — text from a link is untrusted (ADR-241)", () => {
	it("text over the limit is refused whole, before anything opens, and says why", async () => {
		const h = host();
		await handleDeepLink({ new: "true", text: "x".repeat(MAX_LINK_TEXT_CHARS + 1) }, h);
		expect(h.calls).toEqual([]);
		expect(h.notices).toEqual([t("uriTextTooLong", { max: String(MAX_LINK_TEXT_CHARS) })]);
	});

	it("exactly the limit is accepted, never cut", () => {
		expect(linkText("x".repeat(MAX_LINK_TEXT_CHARS))).toHaveLength(MAX_LINK_TEXT_CHARS);
	});

	it("the limit applies to inject too", async () => {
		const h = host();
		await handleDeepLink({ cmd: "inject", text: "y".repeat(MAX_LINK_TEXT_CHARS + 1) }, h);
		expect(h.calls).toEqual([]);
	});

	it("invisible characters are removed, line breaks and tabs kept", () => {
		expect(linkText("a\u0000b‮c​d\n\te")).toBe("abcd\n\te");
		expect(linkText("  padded  ")).toBe("padded");
		expect(linkText(undefined)).toBe("");
	});

	it("a text that is only invisible characters counts as no text", async () => {
		const h = host();
		await handleDeepLink({ cmd: "inject", text: "​\u0007" }, h);
		expect(h.notices).toEqual([t("uriMissingText")]);
	});

	it("wantsNewConversation reads only the flag", () => {
		expect(wantsNewConversation({})).toBe(false);
		expect(wantsNewConversation({ cmd: "new" })).toBe(false);
	});
});

describe("pythiaLink — the one shortcut-link builder", () => {
	it("names the vault, encoded, and adds only the new flag", () => {
		expect(pythiaLink("My Vault")).toBe("obsidian://pythia?vault=My%20Vault");
		expect(pythiaLink("A&B", "new")).toBe("obsidian://pythia?vault=A%26B&new=true");
	});

	it("the ask link ends in text= so a Shortcut can append its input", () => {
		expect(pythiaLink("V", "ask")).toBe("obsidian://pythia?vault=V&new=true&text=");
	});
});
