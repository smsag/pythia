/**
 * One question to Schreibstube at a time (ADR-257 addendum).
 *
 * Every question Pythia asks Schreibstube — a conversation search, the notes
 * for a send, related conversations — makes it run its model, on a phone too.
 * Several at once took Obsidian past the memory iOS allows it. The gate sits in
 * `SchreibstubeLink`, the one reader of Schreibstube, so it holds for every
 * caller: each panel, the palette modal, every leaf, every send.
 *
 * - A question runs only when none is running; the others wait, in order.
 * - A question in a `lane` replaces one waiting in the same lane: of a burst of
 *   searches typed in a row, only the latest is asked.
 * - A question whose `signal` aborts is answered with its fallback at once. If
 *   it was waiting, it never runs; if it was running, Schreibstube cannot be
 *   stopped (its API takes no signal, D-83), so the gate stays held until it ends.
 * - A question that has not answered by the deadline is answered with its
 *   fallback and lets the next one go, so a hung model load cannot shut search
 *   by meaning off for the session. Its late answer is ignored.
 * - The gate never rejects: a failure is logged and answered with the fallback.
 */

/** How long a question may hold the gate. A phone loading the model cold
 *  takes seconds, not tens of them; past this the question is given up. */
export const QUESTION_DEADLINE_MS = 30_000;

export interface QuestionOptions {
	/** What the question is, for the log. */
	what: string;
	/** Questions in the same lane replace each other while they wait. */
	lane?: string;
	/** Aborted: answered with the fallback, never run if still waiting. */
	signal?: AbortSignal;
}

interface Waiting {
	lane?: string;
	start(): void;
	drop(): void;
}

export class QuestionGate {
	private running = false;
	private readonly waiting: Waiting[] = [];

	constructor(
		private readonly log: (message: string, data?: unknown) => void,
		private readonly deadlineMs = QUESTION_DEADLINE_MS,
	) {}

	/** Questions waiting for the one that runs; for tests and the log. */
	pending(): number {
		return this.waiting.length;
	}

	ask<T>(work: () => Promise<T>, fallback: T, opts: QuestionOptions): Promise<T> {
		return new Promise<T>((resolve) => {
			let settled = false;
			const answer = (value: T): void => {
				if (settled) return;
				settled = true;
				opts.signal?.removeEventListener("abort", onAbort);
				resolve(value);
			};
			const entry: Waiting = {
				lane: opts.lane,
				start: () => this.run(work, fallback, opts, answer),
				drop: () => answer(fallback),
			};
			const onAbort = (): void => {
				const at = this.waiting.indexOf(entry);
				if (at !== -1) this.waiting.splice(at, 1);
				answer(fallback);
			};
			if (opts.signal?.aborted) return answer(fallback);
			opts.signal?.addEventListener("abort", onAbort);
			if (opts.lane !== undefined) {
				for (let i = this.waiting.length - 1; i >= 0; i--) {
					if (this.waiting[i].lane !== opts.lane) continue;
					const [replaced] = this.waiting.splice(i, 1);
					replaced.drop();
				}
			}
			this.waiting.push(entry);
			this.next();
		});
	}

	private next(): void {
		if (this.running) return;
		const entry = this.waiting.shift();
		if (!entry) return;
		this.running = true;
		entry.start();
	}

	private run<T>(work: () => Promise<T>, fallback: T, opts: QuestionOptions, answer: (value: T) => void): void {
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;
			clearTimeout(timer);
			this.running = false;
			this.next();
		};
		const timer = setTimeout(() => {
			this.log(`schreibstube: ${opts.what} did not answer within ${this.deadlineMs / 1000} s; given up`);
			answer(fallback);
			release();
		}, this.deadlineMs);
		let started: Promise<T>;
		try {
			started = work();
		} catch (e) {
			started = Promise.reject(e);
		}
		void started
			.then(answer, (e: unknown) => {
				this.log(`schreibstube: ${opts.what} failed`, e);
				answer(fallback);
			})
			.finally(release);
	}
}
