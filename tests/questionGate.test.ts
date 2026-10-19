import { describe, it, expect, vi, afterEach } from "vitest";
import { QuestionGate } from "../services/questionGate";

// One question to Schreibstube at a time (ADR-257 addendum). Each test fails
// against a gate that runs questions side by side, keeps a replaced or aborted
// one, or holds the slot for a question that never answers.

/** A question that answers when told to. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.useRealTimers(); });

describe("QuestionGate", () => {
	it("runs one question at a time, the next when it ends", async () => {
		const gate = new QuestionGate(() => {});
		const first = deferred<string>();
		const started: string[] = [];
		const a = gate.ask(() => { started.push("a"); return first.promise; }, "", { what: "a" });
		const b = gate.ask(async () => { started.push("b"); return "B"; }, "", { what: "b" });
		await flush();
		expect(started).toEqual(["a"]);

		first.resolve("A");
		expect(await a).toBe("A");
		expect(await b).toBe("B");
		expect(started).toEqual(["a", "b"]);
	});

	it("a newer question in a lane replaces the one waiting there, answered with its fallback", async () => {
		const gate = new QuestionGate(() => {});
		const first = deferred<string[]>();
		const asked: string[] = [];
		const ask = (text: string, work: () => Promise<string[]>) =>
			gate.ask(() => { asked.push(text); return work(); }, [], { what: "search", lane: "conversations" });

		void ask("küche", () => first.promise);
		const middle = ask("küchen", async () => ["x"]);
		const last = ask("küchenplan", async () => ["y"]);
		expect(await middle).toEqual([]);                       // replaced, never run

		first.resolve([]);
		expect(await last).toEqual(["y"]);
		expect(asked).toEqual(["küche", "küchenplan"]);
	});

	it("does not let one lane replace a question of another, or one without a lane", async () => {
		const gate = new QuestionGate(() => {});
		const first = deferred<string>();
		void gate.ask(() => first.promise, "", { what: "search", lane: "conversations" });
		const notes = gate.ask(async () => "notes", "", { what: "note search" });
		const search = gate.ask(async () => "search", "", { what: "search", lane: "conversations" });
		first.resolve("");

		expect(await notes).toBe("notes");
		expect(await search).toBe("search");
	});

	it("never runs a waiting question whose signal aborts", async () => {
		const gate = new QuestionGate(() => {});
		const first = deferred<string>();
		const work = vi.fn(async () => "late");
		void gate.ask(() => first.promise, "", { what: "a" });
		const abort = new AbortController();
		const waiting = gate.ask(work, "fallback", { what: "b", signal: abort.signal });

		abort.abort();
		expect(await waiting).toBe("fallback");
		expect(gate.pending()).toBe(0);
		first.resolve("");
		await flush();
		expect(work).not.toHaveBeenCalled();
	});

	it("runs nothing for a signal aborted before asking", async () => {
		const gate = new QuestionGate(() => {});
		const abort = new AbortController();
		abort.abort();
		const work = vi.fn(async () => "x");
		expect(await gate.ask(work, "fallback", { what: "a", signal: abort.signal })).toBe("fallback");
		expect(work).not.toHaveBeenCalled();
	});

	it("answers an aborted running question at once, and holds the slot until Schreibstube ends it", async () => {
		const gate = new QuestionGate(() => {});
		const running = deferred<string>();
		const abort = new AbortController();
		const a = gate.ask(() => running.promise, "fallback", { what: "a", signal: abort.signal });
		const next = vi.fn(async () => "b");
		const b = gate.ask(next, "", { what: "b" });
		await flush();

		abort.abort();
		expect(await a).toBe("fallback");
		await flush();
		expect(next).not.toHaveBeenCalled();                    // the model is still busy

		running.resolve("ignored");
		expect(await b).toBe("b");
	});

	it("gives a question up at its deadline, says so, and lets the next one go", async () => {
		vi.useFakeTimers();
		const log = vi.fn();
		const gate = new QuestionGate(log, 1000);
		const hung = gate.ask(() => new Promise<string>(() => {}), "fallback", { what: "search" });
		const next = gate.ask(async () => "next", "", { what: "related" });

		await vi.advanceTimersByTimeAsync(1000);
		expect(await hung).toBe("fallback");
		expect(await next).toBe("next");
		expect(log).toHaveBeenCalledWith(expect.stringContaining("search did not answer within 1 s"));
	});

	it("never rejects: a failure or a throw is logged and answered with the fallback", async () => {
		const log = vi.fn();
		const gate = new QuestionGate(log);
		const rejected = gate.ask(async () => { throw new Error("worker gone"); }, [], { what: "search" });
		const thrown = gate.ask(() => { throw new Error("api getter"); }, [], { what: "related" });

		expect(await rejected).toEqual([]);
		expect(await thrown).toEqual([]);
		expect(log).toHaveBeenCalledWith("schreibstube: search failed", expect.any(Error));
		expect(log).toHaveBeenCalledWith("schreibstube: related failed", expect.any(Error));
		expect(await gate.ask(async () => "free", "", { what: "next" })).toBe("free");
	});
});
