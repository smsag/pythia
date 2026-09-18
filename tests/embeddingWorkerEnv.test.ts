import { describe, it, expect, vi } from "vitest";

// `getEmbeddingBundle()` reads `__EMBEDDING_BUNDLE_PLACEHOLDER__`, an esbuild
// `define` that unit tests never apply — it is a bare global identifier, so
// stubbing the global is what stands in for the build step. Mocking the module
// would not work: `workerSource` calls `getEmbeddingBundle` through the
// module-local binding, not the export, so the real function must run.
vi.stubGlobal("__EMBEDDING_BUNDLE_PLACEHOLDER__", "/*BUNDLE*/");

import {
	WORKER_ENV_PREFIX,
	workerSource,
	getEmbeddingBundle,
} from "../services/embedding/host/embeddingBundle";

/** Run the prefix against a STAND-IN global, so the suite never mutates the real
 *  `process` (vitest itself needs it) and a non-configurable case cannot leak
 *  into another file. `new Function` shadows `globalThis` with the parameter. */
const runPrefix = (target: object): void => {
	new Function("globalThis", WORKER_ENV_PREFIX)(target);
};

describe("worker env prefix (ADR-179)", () => {
	it("comes FIRST in the worker source", () => {
		// The whole point: transformers.js reads `process` while its module body
		// evaluates, and an ES import is hoisted above any statement in entry.ts.
		// Anywhere but position zero is the bug.
		expect(workerSource().indexOf(WORKER_ENV_PREFIX)).toBe(0);
	});

	it("still carries the whole bundle after the prefix", () => {
		expect(workerSource().slice(WORKER_ENV_PREFIX.length)).toContain("/*BUNDLE*/");
	});

	it("is NOT added to the bundle the iframe renders", () => {
		// The iframe has always worked precisely because Electron gives subframes no
		// Node access. Prefixing it would be untested surface for no gain.
		expect(getEmbeddingBundle()).not.toContain(WORKER_ENV_PREFIX);
	});

	it("hides `process` from the exact checks transformers.js makes", () => {
		// env.js: `typeof process !== 'undefined'`, then `process?.release?.name === 'node'`.
		const fake: { process?: unknown } = { process: { release: { name: "node" } } };
		runPrefix(fake);
		expect(fake.process).toBeUndefined();
		expect((fake.process as { release?: unknown } | undefined)?.release).toBeUndefined();
	});

	it("overwrites a NON-WRITABLE `process` rather than throwing", () => {
		// The bundle is an ES module, so strict mode: a plain assignment would throw
		// here. defineProperty does not.
		const fake = {};
		Object.defineProperty(fake, "process", {
			value: { release: { name: "node" } },
			writable: false,
			configurable: true,
		});
		expect(() => runPrefix(fake)).not.toThrow();
		expect((fake as { process?: unknown }).process).toBeUndefined();
	});

	it("survives a NON-CONFIGURABLE `process` instead of taking the worker down", () => {
		// defineProperty throws on this one. A throw at statement zero would kill the
		// Worker and look exactly like the bug being fixed; the try/catch lets the
		// chain fall through to the iframe as it did before.
		const fake = {};
		Object.defineProperty(fake, "process", {
			value: { release: { name: "node" } },
			writable: false,
			configurable: false,
		});
		expect(() => runPrefix(fake)).not.toThrow();
		expect((fake as { process?: unknown }).process).toBeDefined();
	});

	it("is a single statement with no newline, so it cannot shift the bundle's first line", () => {
		expect(WORKER_ENV_PREFIX).not.toContain("\n");
	});

	it("shadows `process` LEXICALLY, which a non-configurable global cannot defeat", () => {
		// The hole in the original prefix: `defineProperty` throws on a
		// non-configurable `process`, the catch swallows it, and the fix silently
		// does nothing — a live suspect for the M2 Air still reporting
		// `iframe (UI thread)` after ADR-179. A lexical binding has no such hole.
		const probe = new Function("globalThis", `${WORKER_ENV_PREFIX} return [typeof process, process?.release?.name];`);
		const stubborn = {};
		Object.defineProperty(stubborn, "process", {
			value: { release: { name: "node" } }, configurable: false, writable: false,
		});
		// Exactly what transformers.js env.js:38-39 reads.
		expect(probe(stubborn)).toEqual(["undefined", undefined]);
	});

	it("keeps the globalThis half, for code that reads the property explicitly", () => {
		// A lexical shadow does not intercept `globalThis.process`; both halves earn
		// their place.
		const fake: { process?: unknown } = { process: { release: { name: "node" } } };
		runPrefix(fake);
		expect(fake.process).toBeUndefined();
	});
});
