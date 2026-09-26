// @vitest-environment happy-dom
//
// A resume mode that leaves messages out is never silent (ADR-231, #256): the
// context box names how many and offers the way back to the full history.
import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

describe("the context box shows a reduced history (ADR-231)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	const history = [userMsg("m1", "q1"), aiMsg("m2", "a1"), userMsg("m3", "q2"), aiMsg("m4", "a2")];

	it("names the left-out messages and switches back to full history", async () => {
		const conv = await seedConversation(plugin, {
			name: "Resumed", messages: history, resumeMode: "summary", resumedAfterId: "m4",
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);

		const row = pane().querySelector(".p-inspector-resume");
		expect(row?.textContent).toContain(t("ctxResumeSummary", { count: "4" }));
		const btn = row?.querySelector("button");
		expect(btn?.textContent).toBe(t("ctxSendFullHistory"));

		btn?.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(conv.resumeMode).toBe("full");
		expect(conv.resumedAfterId).toBeUndefined();
		expect(pane().querySelector(".p-inspector-resume")).toBeNull();
	});

	it("shows nothing for a mode with no resume point", async () => {
		await seedConversation(plugin, {
			name: "Template summary", messages: history, resumeMode: "summary",
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		expect(pane().querySelector(".p-inspector-resume")).toBeNull();
	});
});
