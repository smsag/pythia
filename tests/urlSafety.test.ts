import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "../services/urlSafety";

describe("safeHttpUrl", () => {
	it("passes through an https URL", () => {
		expect(safeHttpUrl("https://example.com/x")).toBe("https://example.com/x");
	});

	it("passes through an http URL", () => {
		expect(safeHttpUrl("http://example.com/")).toBe("http://example.com/");
	});

	it("prefixes https:// for a bare domain", () => {
		expect(safeHttpUrl("example.com/article")).toBe("https://example.com/article");
	});

	it("rejects a javascript: scheme", () => {
		expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
	});

	it("rejects a data: scheme", () => {
		expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
	});

	it("rejects a file: scheme", () => {
		expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
	});

	it("does not mask a hostile scheme by prefixing https://", () => {
		// A scheme-carrying ref keeps its scheme and is judged on it — never
		// silently turned into https://javascript:… and opened.
		expect(safeHttpUrl("javascript://%0aalert(1)")).toBeNull();
	});

	it("returns null for empty/whitespace/nullish input", () => {
		expect(safeHttpUrl("")).toBeNull();
		expect(safeHttpUrl("   ")).toBeNull();
		expect(safeHttpUrl(undefined)).toBeNull();
		expect(safeHttpUrl(null)).toBeNull();
	});

	it("trims surrounding whitespace", () => {
		expect(safeHttpUrl("  https://example.com  ")).toBe("https://example.com/");
	});
});
