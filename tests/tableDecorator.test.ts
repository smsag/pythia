// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

// tableDecorator pulls in the drag-to-pan gesture, which is DOM-only; happy-dom
// provides everything it touches, so no module stubbing is needed.
import { decorateTables } from "../ui/tableDecorator";

/** Obsidian augments HTMLElement with createEl/createDiv; the decorator uses the
 *  global createEl, so provide the minimum the function actually calls. */
beforeEach(() => {
	document.body.innerHTML = "";
	(globalThis as unknown as { createEl: unknown }).createEl = (
		tag: string,
		opts?: { cls?: string },
	) => {
		const el = document.createElement(tag);
		if (opts?.cls) el.className = opts.cls;
		return el;
	};
});

function render(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.appendChild(root);
	return root;
}

const TABLE = "<table><thead><tr><th>Ebene</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>";

describe("decorateTables", () => {
	it("wraps a table in a scroll frame, preserving it as the frame's child", () => {
		const root = render(`<p>before</p>${TABLE}<p>after</p>`);
		decorateTables(root);

		const frame = root.querySelector(".p-scroll-frame");
		expect(frame).not.toBeNull();
		expect(frame!.children).toHaveLength(1);
		expect(frame!.firstElementChild!.tagName).toBe("TABLE");
	});

	it("keeps the table at its original position in the document flow", () => {
		const root = render(`<p>before</p>${TABLE}<p>after</p>`);
		decorateTables(root);

		const tags = Array.from(root.children).map((c) => c.tagName.toLowerCase());
		expect(tags).toEqual(["p", "div", "p"]);
		expect(root.children[1].className).toBe("p-scroll-frame");
	});

	it("wraps every table, not just the first", () => {
		const root = render(`${TABLE}<p>between</p>${TABLE}`);
		decorateTables(root);
		expect(root.querySelectorAll(".p-scroll-frame")).toHaveLength(2);
	});

	it("is idempotent — a second pass never nests a frame inside a frame", () => {
		const root = render(TABLE);
		decorateTables(root);
		decorateTables(root);
		decorateTables(root);

		expect(root.querySelectorAll(".p-scroll-frame")).toHaveLength(1);
		expect(root.querySelector(".p-scroll-frame .p-scroll-frame")).toBeNull();
		expect(root.querySelectorAll("table")).toHaveLength(1);
	});

	it("marks the table so a later pass can tell it is already handled", () => {
		const root = render(TABLE);
		decorateTables(root);
		expect(root.querySelector("table")!.getAttribute("data-decorated")).toBe("1");
	});

	it("does nothing when there is no table", () => {
		const root = render("<p>just prose</p>");
		decorateTables(root);
		expect(root.querySelector(".p-scroll-frame")).toBeNull();
		expect(root.innerHTML).toBe("<p>just prose</p>");
	});

	it("leaves the table's own markup untouched", () => {
		const root = render(TABLE);
		const before = root.querySelector("table")!.innerHTML;
		decorateTables(root);
		expect(root.querySelector("table")!.innerHTML).toBe(before);
	});

	it("arms drag-to-pan on the frame rather than the table", () => {
		const root = render(TABLE);
		const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");
		decorateTables(root);
		const frame = root.querySelector<HTMLElement>(".p-scroll-frame")!;
		// The gesture listens on the element that actually scrolls.
		const armedOnFrame = spy.mock.instances.includes(frame);
		expect(armedOnFrame).toBe(true);
		spy.mockRestore();
	});
});
