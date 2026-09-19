#!/usr/bin/env node
// Which of Obsidian's own CSS rules can reach a Pythia button? (ADR-190)
//
// Reads app.css out of the installed Obsidian (an .asar is a JSON header plus
// concatenated files — no dependency needed), keeps every rule whose subject is
// a bare `button` (pseudo-classes, :not() and [disabled] allowed) under
// ancestors a Pythia button can actually have, and compares the selectors with
// tests/fixtures/obsidianButtonRules.ts. Exits 1 on drift, so after an Obsidian
// update this says whether the fixture — and therefore the cascade test — still
// describes reality. Needs a local Obsidian; not part of CI.
//
//   npm run check:obsidian-cascade [-- /path/to/obsidian-x.y.z.asar]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function findAsar() {
	const arg = process.argv[2];
	if (arg) return arg;
	const dirs = [
		join(homedir(), "Library/Application Support/obsidian"),
		join(homedir(), ".config/obsidian"),
		join(process.env.APPDATA ?? "", "obsidian"),
	];
	for (const d of dirs) {
		if (!existsSync(d)) continue;
		const found = readdirSync(d).filter((f) => /^obsidian-[\d.]+\.asar$/.test(f))
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		if (found.length) return join(d, found[found.length - 1]);
	}
	const bundled = "/Applications/Obsidian.app/Contents/Resources/obsidian.asar";
	if (existsSync(bundled)) return bundled;
	throw new Error("No Obsidian .asar found; pass its path as the first argument.");
}

function readAppCss(asarPath) {
	const buf = readFileSync(asarPath);
	const headerPickle = buf.readUInt32LE(4);
	const jsonLen = buf.readUInt32LE(12);
	const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString("utf8"));
	const entry = header.files["app.css"];
	if (!entry) throw new Error("app.css not in the archive");
	const base = 8 + headerPickle;
	const off = base + Number(entry.offset);
	return buf.subarray(off, off + entry.size).toString("utf8");
}

// Ancestors a Pythia button can have: body state classes, the workspace chain,
// a modal and a Setting control. Anything else (a specific Obsidian view) cannot match.
const ANCESTORS = new Set([
	".app-container", ".workspace", ".workspace-split", ".workspace-leaf", ".workspace-leaf-content",
	".view-content", ".mod-right-split", ".mod-left-split", ".workspace-drawer", ".mod-right", ".mod-sidedock",
	".workspace-tabs", ".workspace-tab-container", ".mod-root", ".mod-active", ".mod-vertical", ".mod-horizontal", ".mod-top",
	".modal-container", ".modal", ".modal-content", ".setting-item", ".setting-item-control",
	".is-mobile", ".is-phone", ".is-tablet", ".is-desktop", ".theme-dark", ".theme-light", ".is-floating-nav",
	".mod-macos", ".mod-windows", ".mod-linux", ".is-frameless", ".is-hidden-frameless", ".show-view-header",
	".is-translucent", ".is-ios", ".is-android", ".native-scrollbars", ".is-focused", ".markdown-rendered",
]);
// Present in app.css but out of reach or irrelevant: a PDF viewer toolbar, a
// dev-only emulation class, and forced-colors borders (the OS owns those).
const IGNORED = new Set(["#editorUndoBar button", "body.emulate-mobile button"]);

function rules(css) {
	const out = [];
	const walk = (block, media) => {
		let i = 0;
		while (i < block.length) {
			const j = block.indexOf("{", i);
			if (j < 0) break;
			const sel = block.slice(i, j).trim();
			if (sel.startsWith("@")) {
				let d = 1, k = j + 1;
				while (d) { if (block[k] === "{") d++; else if (block[k] === "}") d--; k++; }
				if (/^@(media|supports|layer|container)/.test(sel)) walk(block.slice(j + 1, k - 1), sel);
				i = k;
			} else {
				const k = block.indexOf("}", j);
				out.push({ media, sel: sel.replace(/\s+/g, " "), body: block.slice(j + 1, k).replace(/\s+/g, " ").trim() });
				i = k + 1;
			}
		}
	};
	walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), "");
	return out;
}

const subjectOk = (c) => /^button(?![\w-])/.test(c) && !/[.[]/.test(c.slice(6).replace(/:not\([^)]*\)/g, "").replace(/\[(aria-)?disabled[^\]]*\]/g, ""));
const ancestorOk = (c) => (c.match(/\.[\w-]+/g) ?? []).every((cls) => ANCESTORS.has(cls)) && !/#/.test(c);

const asar = findAsar();
const css = readAppCss(asar);
const reached = [];
for (const r of rules(css)) {
	for (const s of r.sel.split(",").map((x) => x.trim())) {
		if (IGNORED.has(s) || /forced-colors/.test(r.media)) continue;
		const parts = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
		const subject = parts[parts.length - 1];
		if (subjectOk(subject) && parts.slice(0, -1).every(ancestorOk)) reached.push({ ...r, sel: s });
	}
}

const fixture = readFileSync(new URL("../tests/fixtures/obsidianButtonRules.ts", import.meta.url), "utf8");
const listed = [...fixture.matchAll(/^\t"(.+)",$/gm)].map((m) => m[1].replace(/\\"/g, "\""));
const live = [...new Set(reached.map((r) => r.sel))];
console.log(`${asar}\n${live.length} rules can reach a Pythia button:\n`);
for (const r of reached) console.log(`  ${r.media ? r.media + " " : ""}${r.sel}\n      ${r.body}`);
const added = live.filter((s) => !listed.includes(s)), gone = listed.filter((s) => !live.includes(s));
if (added.length || gone.length) {
	console.log("\nDRIFT against tests/fixtures/obsidianButtonRules.ts:");
	for (const s of added) console.log(`  + ${s}   (new in Obsidian — add it to the fixture, then make the test pass)`);
	for (const s of gone) console.log(`  - ${s}   (no longer in Obsidian)`);
	process.exit(1);
}
console.log("\nFixture matches.");
