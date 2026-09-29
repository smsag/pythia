import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import type { Conversation } from "../models/types";
import {
	MAX_SOURCE_ITEMS,
	readSchreibstubeApi,
	schreibstubeState,
	SchreibstubeLink,
	sourceChanges,
	toSourceItem,
} from "../services/schreibstubeLink";

function fakeApi(over: Record<string, unknown> = {}) {
	return {
		version: 2,
		status: vi.fn(() => "ready"),
		search: vi.fn(async () => [
			{ kind: "conversation", id: "pythia:c2", title: "B", score: 0.7, similarity: 0.7, source: "pythia", item: "c2" },
			{ kind: "conversation", id: "other:c9", title: "X", score: 0.6, similarity: 0.6, source: "other", item: "c9" },
			{ kind: "note", id: "a.md", title: "a", score: 0.6, similarity: 0.6 },
		]),
		related: vi.fn(async () => [
			{ kind: "conversation", id: "pythia:c3", title: "C", score: 0.8, similarity: 0.8, source: "pythia", item: "c3" },
		]),
		registerSource: vi.fn(() => ({ release: vi.fn(), consent: () => "allowed" })),
		...over,
	};
}

type Registered = {
	kind: string;
	label: string;
	icon: string;
	list(): unknown[];
	changes(cursor: string | null): { changed: unknown[]; removed: string[]; cursor: string };
	open(id: string): void;
	link(id: string): string;
};
const registered = (api: ReturnType<typeof fakeApi>): Registered =>
	(api.registerSource.mock.calls[0] as unknown[])[1] as Registered;

function appWith(api: unknown, registry = true): App {
	const vault = { getName: () => "Tresor" };
	return (registry
		? { vault, plugins: { getPlugin: (id: string) => (id === "schreibstube" ? { api } : null) } }
		: { vault }) as unknown as App;
}

const conversation = {
	id: "c1",
	name: "Exposé",
	updatedAt: "2026-02-01T00:00:00.000Z",
	summaryText: "Texte",
	messages: [{ content: "Schreib" }, { content: 3 }, null],
} as unknown as Conversation;

const openConversation = vi.fn();

function link(api: unknown, registry = true) {
	return new SchreibstubeLink({
		app: appWith(api, registry),
		conversations: () => [conversation],
		onConversationsChanged: () => () => undefined,
		openConversation,
		log: () => undefined,
	});
}

describe("readSchreibstubeApi", () => {
	it("finds version 2", () => {
		const api = fakeApi();
		expect(readSchreibstubeApi(appWith(api))).toBe(api);
	});

	it("reads anything else as not there", () => {
		expect(readSchreibstubeApi(appWith(null))).toBeNull();
		expect(readSchreibstubeApi(appWith(fakeApi({ version: 1 })))).toBeNull();
		expect(readSchreibstubeApi(appWith(fakeApi({ search: "no" })))).toBeNull();
		expect(readSchreibstubeApi(appWith(fakeApi(), false))).toBeNull();
	});
});

describe("toSourceItem", () => {
	it("hands over title, summary and the message texts", () => {
		expect(toSourceItem(conversation)).toEqual({
			id: "c1",
			title: "Exposé",
			updatedAt: Date.parse("2026-02-01T00:00:00.000Z"),
			summary: "Texte",
			messages: ["Schreib", "", ""],
			notes: [],
		});
	});

	it("hands over the notes attached as context, and only paths", () => {
		const attached = {
			...conversation,
			contextNotes: ["Projekte/Pythia/readme.md", 7, "", "Projekte/Pythia/spec.md"],
		} as unknown as Conversation;
		expect(toSourceItem(attached).notes).toEqual(["Projekte/Pythia/readme.md", "Projekte/Pythia/spec.md"]);
	});
});

describe("SchreibstubeLink", () => {
	it("is available only when Schreibstube says it can answer, fully or in part", () => {
		expect(link(fakeApi()).available()).toBe(true);
		expect(link(fakeApi({ status: () => "partial" })).available()).toBe(true);
		expect(link(fakeApi({ status: () => "loading" })).available()).toBe(false);
		expect(link(fakeApi({ status: () => "off" })).available()).toBe(false);
		expect(link(fakeApi({ status: () => { throw new Error("x"); } })).available()).toBe(false);
		expect(link(null).available()).toBe(false);
	});

	it("registers even while Schreibstube cannot answer yet, so the person is asked early", () => {
		const api = fakeApi({ status: () => "loading" });
		link(api).available();
		expect(api.registerSource).toHaveBeenCalledTimes(1);
	});

	it("says whether the person has allowed Pythia in Schreibstube", () => {
		expect(link(fakeApi()).consent()).toBe("allowed");
		const pending = fakeApi({ registerSource: vi.fn(() => ({ release: vi.fn(), consent: () => "pending" })) });
		expect(link(pending).consent()).toBe("pending");
		expect(link(null).consent()).toBeNull();
	});

	it("registers as a conversation source, with its labels, its icon and its links", () => {
		const api = fakeApi();
		link(api).available();
		expect((api.registerSource.mock.calls[0] as unknown[])[0]).toBe("pythia");
		const source = registered(api);
		expect(source.kind).toBe("conversation");
		expect(source.icon).toBe("pythia");
		expect(source.label.length).toBeGreaterThan(0);
		expect(source.link("c1")).toBe("obsidian://pythia?vault=Tresor&cmd=resume&id=c1");
	});

	it("hands over only what changed since its cursor", () => {
		const api = fakeApi();
		link(api).available();
		const source = registered(api);
		const first = source.changes(null);
		expect(first.changed).toEqual([toSourceItem(conversation)]);
		expect(first.removed).toEqual([]);
		expect(source.changes(first.cursor)).toEqual({ changed: [], removed: [], cursor: first.cursor });
	});

	it("does not register again with an API object that refused it", () => {
		const log = vi.fn();
		const api = fakeApi({ registerSource: vi.fn(() => { throw new Error("no"); }) });
		const l = new SchreibstubeLink({
			app: appWith(api),
			conversations: () => [conversation],
			onConversationsChanged: () => () => undefined,
			openConversation,
			log,
		});
		l.available();
		l.available();
		expect(api.registerSource).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledTimes(1);
		expect(l.consent()).toBeNull();
	});

	it("lets the old registration go when Schreibstube is loaded again", () => {
		const first = fakeApi();
		const second = fakeApi();
		let current: unknown = first;
		const l = new SchreibstubeLink({
			app: { vault: { getName: () => "Tresor" }, plugins: { getPlugin: () => ({ api: current }) } } as unknown as App,
			conversations: () => [conversation],
			onConversationsChanged: () => () => undefined,
			openConversation,
			log: () => undefined,
		});
		l.available();
		current = second;
		l.available();
		const released = (first.registerSource.mock.results[0]?.value as { release: ReturnType<typeof vi.fn> }).release;
		expect(released).toHaveBeenCalledTimes(1);
		expect(second.registerSource).toHaveBeenCalledTimes(1);
	});

	it("hands the conversations over once per API object", async () => {
		const api = fakeApi();
		const l = link(api);
		l.available();
		await l.searchConversations("küche", 5);
		expect(api.registerSource).toHaveBeenCalledTimes(1);
		expect(registered(api).list()).toEqual([toSourceItem(conversation)]);
	});

	it("keeps only Pythia's own conversations from a search, by their own id", async () => {
		const api = fakeApi();
		expect(await link(api).searchConversations("küche", 5)).toEqual(["c2"]);
		expect(api.search).toHaveBeenCalledWith("küche", { kinds: ["conversation"], sources: ["pythia"], limit: 5 });
	});

	it("answers nothing when Schreibstube fails or is gone", async () => {
		const failing = fakeApi({ search: vi.fn(async () => { throw new Error("gone"); }) });
		expect(await link(failing).searchConversations("küche", 5)).toEqual([]);
		expect(await link(null).related("c1", 5)).toEqual([]);
	});

	it("asks for related conversations by Pythia's id", async () => {
		const api = fakeApi();
		expect(await link(api).related("c1", 5)).toEqual([{ id: "c3", score: 0.8 }]);
		expect(api.related).toHaveBeenCalledWith(
			{ source: "pythia", id: "c1" },
			{ kinds: ["conversation"], sources: ["pythia"], limit: 5 }
		);
	});

	it("keeps only notes from a note search, and passes the excluded paths on", async () => {
		const api = fakeApi({
			search: vi.fn(async () => [
				{ kind: "note", id: "a.md", title: "a", score: 0.6, similarity: 0.6 },
				{ kind: "image", id: "b.jpg", title: "b", score: 0.5, similarity: 0.5 },
			]),
		});
		expect(await link(api).searchNotes("küche", 5, ["x.md"])).toEqual(["a.md"]);
		expect(api.search).toHaveBeenCalledWith("küche", { kinds: ["note"], limit: 5, exclude: ["x.md"] });
	});

	it("lets Schreibstube open a conversation it recommends", () => {
		const api = fakeApi();
		link(api).available();
		registered(api).open("c7");
		expect(openConversation).toHaveBeenCalledWith("c7");
	});
});

describe("sourceChanges", () => {
	const conv = (id: string, updatedAt: string, over: Record<string, unknown> = {}) =>
		({ id, name: id, updatedAt, summaryText: "", messages: [{ content: id }], ...over }) as unknown as Conversation;

	it("reports a conversation dated before, or far after, everything read so far", () => {
		const list = [conv("a", "2026-05-01T00:00:00.000Z"), conv("future", "2999-01-01T00:00:00.000Z")];
		const { cursor } = sourceChanges(list, null);
		list.push(conv("old", "2001-01-01T00:00:00.000Z"));
		const next = sourceChanges(list, cursor);
		expect(next.changed.map((i) => i.id)).toEqual(["old"]);
	});

	it("reports a renamed, answered or re-summarised conversation, and one that went", () => {
		const list = [conv("a", "2026-05-01T00:00:00.000Z"), conv("b", "2026-05-02T00:00:00.000Z")];
		const { cursor } = sourceChanges(list, null);
		const edited = [conv("a", "2026-05-01T00:00:00.000Z", { name: "Neu" })];
		expect(sourceChanges(edited, cursor)).toMatchObject({ changed: [{ id: "a" }], removed: ["b"] });
		const noted = [conv("a", "2026-05-01T00:00:00.000Z", { contextNotes: ["x.md"] }), list[1]!];
		expect(sourceChanges(noted, cursor).changed.map((i) => i.id)).toEqual(["a"]);
	});

	it("takes a cursor it cannot read as a first listing", () => {
		const list = [conv("a", "2026-05-01T00:00:00.000Z")];
		for (const cursor of ["nicht json", "[1]", "null", 42]) {
			expect(sourceChanges(list, cursor).changed.map((i) => i.id)).toEqual(["a"]);
		}
	});

	it("hands over the newest conversations only, with a bounded cursor", () => {
		const list = Array.from({ length: MAX_SOURCE_ITEMS + 5 }, (_, i) =>
			conv(`c-${String(i).padStart(4, "0")}-${"x".repeat(30)}`, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString())
		);
		const first = sourceChanges(list, null);
		expect(first.changed).toHaveLength(MAX_SOURCE_ITEMS);
		expect(first.changed.map((i) => i.id)).not.toContain(list[0]!.id);
		expect(first.cursor.length).toBeLessThan(256 * 1024);
		expect(sourceChanges(list, first.cursor).changed).toEqual([]);
	});
});

describe("schreibstubeState", () => {
	it("asks for the person's yes before anything else", () => {
		expect(schreibstubeState("pending", "ready")).toBe("pending");
		expect(schreibstubeState("denied", "unavailable")).toBe("pending");
	});

	it("tells waiting from what only the person can fix", () => {
		expect(schreibstubeState("allowed", "loading")).toBe("loading");
		expect(schreibstubeState("allowed", "unavailable")).toBe("unavailable");
		expect(schreibstubeState("allowed", "partial")).toBe("ready");
		expect(schreibstubeState("allowed", "ready")).toBe("ready");
	});

	it("reads Schreibstube switched off, or not there, as missing", () => {
		expect(schreibstubeState("allowed", "off")).toBe("missing");
		expect(schreibstubeState(null, null)).toBe("missing");
	});
});

describe("Schreibstube's status, as the link reads it", () => {
	it("is Schreibstube's own answer, and null when it is not there or fails", () => {
		expect(link(fakeApi({ status: vi.fn(() => "unavailable") })).status()).toBe("unavailable");
		expect(link(null).status()).toBeNull();
		const failing = fakeApi({ status: vi.fn(() => { throw new Error("gone"); }) });
		expect(link(failing).status()).toBeNull();
	});

	it("is not available while Schreibstube cannot answer", () => {
		expect(link(fakeApi({ status: vi.fn(() => "unavailable") })).available()).toBe(false);
		expect(link(fakeApi({ status: vi.fn(() => "loading") })).available()).toBe(false);
	});
});
