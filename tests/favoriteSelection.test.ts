// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { selectedAnswer } from "../ui/favoriteSelection";

/**
 * The one rule behind the toolbar's Favorite button and the "Favorite
 * selection" command: a shortcut must never favorite what the toolbar refuses.
 */
const CHAT = `
	<div class="p-chat">
		<div class="p-msg-user" data-msg-id="u1"><div class="p-bubble"><span id="prompt">A question</span></div></div>
		<div class="p-msg-ai" data-msg-id="a1"><div class="p-ai-body"><p id="one">First answer text</p><p id="two">More of it</p></div></div>
		<div class="p-msg-ai" data-msg-id="a2"><div class="p-ai-body"><p id="three">Second answer</p></div></div>
	</div>
	<p id="outside">Not the chat</p>`;

function select(from: string, to: string = from): Selection {
	const range = document.createRange();
	range.setStart(document.getElementById(from)!.firstChild!, 0);
	const end = document.getElementById(to)!.firstChild!;
	range.setEnd(end, end.textContent!.length);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
	return sel;
}

function chat(): HTMLElement {
	document.body.innerHTML = CHAT;
	return document.querySelector<HTMLElement>(".p-chat")!;
}

afterEach(() => window.getSelection()?.removeAllRanges());

describe("selectedAnswer", () => {
	it("is the answer a selection lies inside, across its paragraphs", () => {
		const messages = chat();
		expect(selectedAnswer(select("one", "two"), messages)?.dataset.msgId).toBe("a1");
	});

	it("is nothing over a prompt", () => {
		const messages = chat();
		expect(selectedAnswer(select("prompt"), messages)).toBeNull();
	});

	it("is nothing across two answers, or from a prompt into an answer", () => {
		const messages = chat();
		expect(selectedAnswer(select("two", "three"), messages)).toBeNull();
		expect(selectedAnswer(select("prompt", "one"), messages)).toBeNull();
	});

	it("is nothing outside the chat, and nothing when the selection is empty", () => {
		const messages = chat();
		expect(selectedAnswer(select("outside"), messages)).toBeNull();
		window.getSelection()!.removeAllRanges();
		expect(selectedAnswer(window.getSelection(), messages)).toBeNull();
		expect(selectedAnswer(null, messages)).toBeNull();
	});
});
