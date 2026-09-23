// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";

/** The controller the `#` picker hands its paths to. Reached through the view so
 *  the test exercises the real wiring — the picker's own dropdown needs a vault
 *  to search, which is not what is under test here. */
function attachments(view: PythiaSidebarView): { attach(p: string[]): void; sync(): void; clear(): void } {
	return (view as unknown as { composerAttachments: { attach(p: string[]): void; sync(): void; clear(): void } })
		.composerAttachments;
}

function input(view: PythiaSidebarView): HTMLTextAreaElement {
	return (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl;
}

/** What the browser does on a keystroke: change the value, then fire `input`. */
function type(view: PythiaSidebarView, value: string): void {
	const el = input(view);
	el.value = value;
	el.setSelectionRange(value.length, value.length);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

let plugin: InstanceType<typeof PythiaPlugin>;
let view: PythiaSidebarView;
let conv: Conversation;

beforeEach(async () => {
	document.body.innerHTML = "";
	plugin = await makePlugin();
	conv = await seedConversation(plugin, {
		name: "Chat", messages: [], contextNotes: [],
	} as Partial<Conversation>);
	({ view } = await mountView(plugin));
});

describe("a note picked with # leaves its link in the composer (ADR-211)", () => {
	it("writes the filename where the cursor was", () => {
		type(view, "Compare with last year");
		input(view).setSelectionRange(8, 8);
		attachments(view).attach(["Notes/Q3 revenue.md"]);

		expect(input(view).value).toBe("Compare [[Q3 revenue]] with last year");
		expect(conv.contextNotes).toEqual(["Notes/Q3 revenue.md"]);
	});

	it("shows the note in the reference row as well", () => {
		attachments(view).attach(["Notes/Q3 revenue.md"]);
		const names = Array.from(document.querySelectorAll(".p-wikilink-name")).map((e) => e.textContent);
		expect(names).toContain("Q3 revenue");
	});

	it("leaves the cursor after the link, ready to keep typing", () => {
		attachments(view).attach(["Notes/Plan.md"]);
		const el = input(view);
		expect(el.value.slice(0, el.selectionStart ?? 0)).toBe("[[Plan]] ");
	});

	it("puts a whole folder in as one link each", () => {
		attachments(view).attach(["A/One.md", "A/Two.md"]);
		expect(input(view).value).toBe("[[One]] [[Two]] ");
		expect(conv.contextNotes).toEqual(["A/One.md", "A/Two.md"]);
	});
});

describe("deleting the link detaches the note", () => {
	beforeEach(() => {
		type(view, "Compare with last year");
		input(view).setSelectionRange(8, 8);
		attachments(view).attach(["Notes/Q3 revenue.md"]);
	});

	it("detaches when the link is deleted", () => {
		type(view, "Compare with last year");
		expect(conv.contextNotes).toEqual([]);
	});

	it("detaches when the link is edited into something else", () => {
		type(view, "Compare [[Q3 revenu]] with last year");
		expect(conv.contextNotes).toEqual([]);
	});

	// A sync rather than a one-way detach, so the composer and the row above it
	// can never disagree.
	it("re-attaches when an undo brings the link back", () => {
		type(view, "Compare with last year");
		expect(conv.contextNotes).toEqual([]);
		type(view, "Compare [[Q3 revenue]] with last year");
		expect(conv.contextNotes).toEqual(["Notes/Q3 revenue.md"]);
	});

	it("takes the link out of the row too", () => {
		type(view, "Compare with last year");
		const names = Array.from(document.querySelectorAll(".p-wikilink-name")).map((e) => e.textContent);
		expect(names).not.toContain("Q3 revenue");
	});

	it("leaves a note attached by other means alone", () => {
		conv.contextNotes.push("Notes/Manual.md");
		type(view, "nothing left");
		expect(conv.contextNotes).toEqual(["Notes/Manual.md"]);
	});
});

describe("removing the note elsewhere takes the link with it", () => {
	/** The reference row and the context inspector both offer an × for the same
	 *  note, and they hang it at different depths — on the pill in one, on the row
	 *  in the other. Walk up from the name until the × is in reach, so the test
	 *  asserts the behaviour rather than either one's markup. */
	function removeVia(container: string): void {
		const name = Array.from(document.querySelectorAll(`${container} .p-wikilink-name`))
			.find((e) => e.textContent === "Q3 revenue");
		let el: Element | null | undefined = name;
		while (el && !el.querySelector(".p-wikilink-x")) el = el.parentElement;
		expect(el, `no remove control under ${container}`).toBeTruthy();
		el?.querySelector<HTMLButtonElement>(".p-wikilink-x")?.click();
	}

	beforeEach(() => {
		type(view, "Compare with last year");
		input(view).setSelectionRange(8, 8);
		attachments(view).attach(["Notes/Q3 revenue.md"]);
	});

	it("clears the link when the reference pill is removed", () => {
		removeVia(".p-pills");
		expect(input(view).value).toBe("Compare with last year");
		expect(conv.contextNotes).toEqual([]);
	});

	// Without the same hook the composer still names the note, so the next
	// keystroke re-attaches it and the removal silently undoes itself.
	it("clears the link when the context inspector removes it, and it stays gone", () => {
		removeVia(".p-inspector-row");
		expect(input(view).value).toBe("Compare with last year");
		type(view, "Compare with last year and more");
		expect(conv.contextNotes).toEqual([]);
	});
});

describe("sending ends the composer's claim on the note", () => {
	// The note stays attached to the conversation — that is what contextNotes
	// means — but its link left with the message, so nothing is left to delete.
	// This is what stops an edit three turns later detaching a note earlier
	// answers were built on.
	it("keeps the note attached, and stops tracking it", () => {
		attachments(view).attach(["Notes/Q3 revenue.md"]);
		attachments(view).clear();

		type(view, "a completely different message");
		expect(conv.contextNotes).toEqual(["Notes/Q3 revenue.md"]);
	});
});

describe("typing on your own", () => {
	it("does not attach a wikilink the user wrote themselves", () => {
		type(view, "see [[Some Note]] for details");
		expect(conv.contextNotes).toEqual([]);
	});

	it("costs nothing when nothing was attached", () => {
		type(view, "just words");
		expect(conv.contextNotes).toEqual([]);
	});
});
