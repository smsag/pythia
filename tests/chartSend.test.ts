// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makePlugin, mountView, seedConversation } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation, ToolCall } from "../models/types";
import { CHART_BLOCK_LANG, CHART_TOOL_OK } from "../services/chartSpec";
import type { ComposerField } from "../ui/ComposerField";

/** The provider seam, stubbed the way tests/viewRender.test.ts stubs it. The
 *  extra `onToolCall` argument is the point of this file: a chart reaches the
 *  answer through a tool call, not through the token stream. */
interface StreamFake {
	(conv: unknown, text: string, notes: string[],
		appendToken: (t: string) => void,
		onComplete: (fullText: string, usage?: unknown, finish?: unknown) => Promise<void> | void,
		onError: (err: Error) => void,
		onToolCall: (call: ToolCall) => Promise<string>): Promise<void>;
}

function stubStream(plugin: InstanceType<typeof PythiaPlugin>, fake: StreamFake): void {
	(plugin as unknown as { llmRouter: { streamMessage: StreamFake } }).llmRouter.streamMessage = fake;
}

function setInput(view: PythiaSidebarView, text: string): void {
	(view as unknown as { composer: ComposerField }).composer.value = text;
}

const chartCall = (over: Record<string, unknown> = {}): ToolCall => ({
	id:    "call-1",
	name:  "render_chart",
	input: {
		type: "bar", categories: ["2023", "2024"],
		series: [{ name: "EMEA", values: [1, 2] }],
		...over,
	},
});

let plugin: InstanceType<typeof PythiaPlugin>;

async function openBlank(): Promise<{ view: PythiaSidebarView; conv: Conversation }> {
	const conv = await seedConversation(plugin, {
		name: "Chat", messages: [], contextNotes: [],
	} as Partial<Conversation>);
	const { view } = await mountView(plugin);
	return { view, conv };
}

beforeEach(async () => {
	document.body.innerHTML = "";
	plugin = await makePlugin();
});

describe("a chart reaches the answer (ADR-210)", () => {
	it("places the block where the model paused to ask for it", async () => {
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete, _onError, onToolCall) => {
			appendToken("Before. ");
			expect(await onToolCall(chartCall())).toBe(CHART_TOOL_OK);
			appendToken("After.");
			await onComplete("Before. After.");
		});

		const { view, conv } = await openBlank();
		setInput(view, "chart it");
		await view.sendMessage();

		const content = conv.messages[1].content;
		expect(content).toContain("```" + CHART_BLOCK_LANG);
		expect(content.indexOf("Before.")).toBeLessThan(content.indexOf("```"));
		expect(content.indexOf("```")).toBeLessThan(content.indexOf("After."));
	});

	// A fence that does not start at a line boundary never opens, and the chart is
	// then a dead card with nothing said.
	it("opens the fence on a line of its own", async () => {
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete, _onError, onToolCall) => {
			appendToken("Mid-sentence");
			await onToolCall(chartCall());
			appendToken(" continues.");
			await onComplete("Mid-sentence continues.");
		});

		const { view, conv } = await openBlank();
		setInput(view, "chart it");
		await view.sendMessage();

		for (const line of conv.messages[1].content.split("\n")) {
			if (line.includes("```")) expect(line.trimStart().startsWith("```")).toBe(true);
		}
	});

	// The turn said nothing in words. Dropping it as an empty reply — which is
	// what `if (!fullText)` did — would throw the chart away with it.
	it("keeps a turn whose only output is a chart", async () => {
		stubStream(plugin, async (_c, _t, _n, _appendToken, onComplete, _onError, onToolCall) => {
			await onToolCall(chartCall());
			await onComplete("");
		});

		const { view, conv } = await openBlank();
		setInput(view, "just the chart");
		await view.sendMessage();

		expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(conv.messages[1].content).toContain("```" + CHART_BLOCK_LANG);
	});

	it("still drops a turn that produced nothing at all", async () => {
		stubStream(plugin, async (_c, _t, _n, _appendToken, onComplete) => {
			await onComplete("");
		});

		const { view, conv } = await openBlank();
		setInput(view, "hi");
		await view.sendMessage();

		expect(conv.messages.map((m) => m.role)).toEqual(["user"]);
	});

	it("records nothing for a spec it rejects, and says why", async () => {
		let reply = "";
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete, _onError, onToolCall) => {
			reply = await onToolCall(chartCall({ series: [{ name: "s", values: [1] }] }));
			appendToken("Sorry.");
			await onComplete("Sorry.");
		});

		const { view, conv } = await openBlank();
		setInput(view, "chart it");
		await view.sendMessage();

		expect(reply).toContain("series[0].values");
		expect(conv.messages[1].content).toBe("Sorry.");
	});

	it("places two charts, each at its own point", async () => {
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete, _onError, onToolCall) => {
			appendToken("First: ");
			await onToolCall(chartCall({ title: "One" }));
			appendToken(" Second: ");
			await onToolCall({ ...chartCall({ title: "Two" }), id: "call-2" });
			await onComplete("First:  Second: ");
		});

		const { view, conv } = await openBlank();
		setInput(view, "two charts");
		await view.sendMessage();

		const content = conv.messages[1].content;
		expect(content.match(/```pythia-chart/g)).toHaveLength(2);
		expect(content.indexOf('"One"')).toBeLessThan(content.indexOf("Second:"));
		expect(content.indexOf("Second:")).toBeLessThan(content.indexOf('"Two"'));
	});

	// Per send, like pendingWebSources — a chart from the last turn reappearing
	// in the next one would be the same bug ADR-099 fixed for research.
	it("does not carry a chart over into the next send", async () => {
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete, _onError, onToolCall) => {
			appendToken("One.");
			await onToolCall(chartCall());
			await onComplete("One.");
		});
		const { view, conv } = await openBlank();
		setInput(view, "first");
		await view.sendMessage();

		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete) => {
			appendToken("Two.");
			await onComplete("Two.");
		});
		setInput(view, "second");
		await view.sendMessage();

		expect(conv.messages[3].content).toBe("Two.");
	});
});

describe("the tool is offered where a chart can be placed", () => {
	it("survives a send with no tool call at all", async () => {
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete) => {
			appendToken("Plain answer.");
			await onComplete("Plain answer.");
		});
		const { view, conv } = await openBlank();
		setInput(view, "hi");
		await view.sendMessage();
		expect(conv.messages[1].content).toBe("Plain answer.");
	});
});

// The stubs above never touch the network; this keeps a real provider from
// being constructed if the harness changes underneath.
afterEach(() => { vi.restoreAllMocks(); });
