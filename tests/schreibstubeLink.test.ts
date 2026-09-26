import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import type { Conversation } from "../models/types";
import { readSchreibstubeApi, SchreibstubeLink, toSourceItem } from "../services/schreibstubeLink";

function fakeApi(over: Record<string, unknown> = {}) {
	return {
		version: 1,
		ready: vi.fn(() => true),
		search: vi.fn(async () => [
			{ kind: "conversation", id: "c2", title: "B", score: 0.7 },
			{ kind: "note", id: "a.md", title: "a", score: 0.6 },
		]),
		related: vi.fn(async () => [{ kind: "conversation", id: "c3", title: "C", score: 0.8 }]),
		registerSource: vi.fn(() => () => undefined),
		...over,
	};
}

function appWith(api: unknown, registry = true): App {
	return (registry
		? { plugins: { getPlugin: (id: string) => (id === "schreibstube" ? { api } : null) } }
		: {}) as unknown as App;
}

const conversation = {
	id: "c1",
	name: "Exposé",
	updatedAt: "2026-02-01T00:00:00.000Z",
	summaryText: "Texte",
	messages: [{ content: "Schreib" }, { content: 3 }, null],
} as unknown as Conversation;

function link(api: unknown, registry = true) {
	return new SchreibstubeLink({
		app: appWith(api, registry),
		conversations: () => [conversation],
		onConversationsChanged: () => () => undefined,
		log: () => undefined,
	});
}

describe("readSchreibstubeApi", () => {
	it("finds version 1", () => {
		const api = fakeApi();
		expect(readSchreibstubeApi(appWith(api))).toBe(api);
	});

	it("reads anything else as not there", () => {
		expect(readSchreibstubeApi(appWith(null))).toBeNull();
		expect(readSchreibstubeApi(appWith(fakeApi({ version: 2 })))).toBeNull();
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
		});
	});
});

describe("SchreibstubeLink", () => {
	it("is available only when Schreibstube says it can answer", () => {
		expect(link(fakeApi()).available()).toBe(true);
		expect(link(fakeApi({ ready: () => false })).available()).toBe(false);
		expect(link(fakeApi({ ready: () => { throw new Error("x"); } })).available()).toBe(false);
		expect(link(null).available()).toBe(false);
	});

	it("hands the conversations over once per API object", async () => {
		const api = fakeApi();
		const l = link(api);
		l.available();
		await l.searchConversations("küche", 5);
		expect(api.registerSource).toHaveBeenCalledTimes(1);
		const source = (api.registerSource.mock.calls[0] as unknown[])[1] as { list(): unknown[] };
		expect(source.list()).toEqual([toSourceItem(conversation)]);
	});

	it("keeps only conversations from a search", async () => {
		expect(await link(fakeApi()).searchConversations("küche", 5)).toEqual(["c2"]);
	});

	it("answers nothing when Schreibstube fails or is gone", async () => {
		const failing = fakeApi({ search: vi.fn(async () => { throw new Error("gone"); }) });
		expect(await link(failing).searchConversations("küche", 5)).toEqual([]);
		expect(await link(null).related("c1", 5)).toEqual([]);
	});

	it("asks for related conversations by Pythia's id", async () => {
		const api = fakeApi();
		expect(await link(api).related("c1", 5)).toEqual([{ id: "c3", score: 0.8 }]);
		expect(api.related).toHaveBeenCalledWith({ source: "pythia", id: "c1" }, { kinds: ["conversation"], limit: 5 });
	});

	it("keeps only notes from a note search, and passes the excluded paths on", async () => {
		const api = fakeApi({
			search: vi.fn(async () => [
				{ kind: "note", id: "a.md", title: "a", score: 0.6 },
				{ kind: "image", id: "b.jpg", title: "b", score: 0.5 },
			]),
		});
		expect(await link(api).searchNotes("küche", 5, ["x.md"])).toEqual(["a.md"]);
		expect(api.search).toHaveBeenCalledWith("küche", { kinds: ["note"], limit: 5, exclude: ["x.md"] });
	});
});
