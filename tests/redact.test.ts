import { describe, it, expect } from "vitest";
import { redactSecrets, describeErrorForLog } from "../services/redact";

describe("redactSecrets — provider key prefixes", () => {
	it("masks an OpenAI sk- key", () => {
		const out = redactSecrets("key is sk-proj-abc123DEF456ghi789 done");
		expect(out).not.toContain("abc123DEF456ghi789");
		expect(out).toContain("[REDACTED]");
	});

	it("masks an Anthropic sk-ant- key (longer prefix, no leftover)", () => {
		const out = redactSecrets("sk-ant-api03-XXXXXXXXXXXXXXXX");
		expect(out).toBe("[REDACTED]");
	});

	it("masks a Tavily tvly- key", () => {
		expect(redactSecrets("tvly-abcdEFGH1234")).toBe("[REDACTED]");
	});
});

describe("redactSecrets — bearer + key/value", () => {
	it("masks a Bearer token but keeps the scheme", () => {
		const out = redactSecrets("Authorization: Bearer abc.def-ghi_JKL123");
		expect(out).toBe("Authorization: Bearer [REDACTED]");
	});

	it("masks JSON api_key values, keeping the key name", () => {
		const out = redactSecrets('{"api_key":"secretvalue123","query":"cats"}');
		expect(out).toContain('"api_key":"[REDACTED]"');
		expect(out).toContain('"query":"cats"');
		expect(out).not.toContain("secretvalue123");
	});

	it("masks authorization=... in a query-ish string", () => {
		const out = redactSecrets("authorization=Tok123SECRET&x=1");
		expect(out).not.toContain("Tok123SECRET");
		expect(out).toContain("x=1");
	});

	it("masks a token: '...' pair", () => {
		expect(redactSecrets("token: 'abc123def456'")).not.toContain("abc123def456");
	});
});

describe("redactSecrets — safe passthrough", () => {
	it("leaves ordinary text untouched", () => {
		const s = "The feature request has 42 votes on board Feature Requests.";
		expect(redactSecrets(s)).toBe(s);
	});

	it("does not mangle a plain word starting with sk (no dash)", () => {
		expect(redactSecrets("skateboard sky skip")).toBe("skateboard sky skip");
	});

	it("stringifies non-string input", () => {
		expect(redactSecrets(42)).toBe("42");
		expect(redactSecrets(null)).toBe("null");
	});
});

describe("describeErrorForLog", () => {
	it("returns name + redacted message, no raw object", () => {
		const out = describeErrorForLog(new Error("failed with Bearer sk-abcdEFGH1234"));
		expect(out).toMatch(/^Error: /);
		expect(out).not.toContain("sk-abcdEFGH1234");
		expect(out).toContain("[REDACTED]");
	});

	it("includes an HTTP status when the SDK error exposes one", () => {
		const err = Object.assign(new Error("Unauthorized"), { status: 401 });
		expect(describeErrorForLog(err)).toBe("Error (status 401): Unauthorized");
	});

	it("reads Mistral-style statusCode too", () => {
		const err = Object.assign(new Error("bad"), { statusCode: 403 });
		expect(describeErrorForLog(err)).toContain("status 403");
	});

	it("redacts a non-Error value", () => {
		expect(describeErrorForLog("Bearer sk-abcdEFGH1234")).toBe("Bearer [REDACTED]");
	});
});
