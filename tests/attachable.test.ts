import { describe, expect, it } from "vitest";
import { isAttachable } from "../services/attachable";

describe("isAttachable", () => {
	it("offers notes, PDFs and spreadsheet exports", () => {
		for (const extension of ["md", "pdf", "csv", "tsv", "CSV"]) {
			expect(isAttachable({ extension })).toBe(true);
		}
	});

	it("leaves out what is neither text nor a PDF", () => {
		for (const extension of ["png", "canvas", "base", "xlsx", ""]) {
			expect(isAttachable({ extension })).toBe(false);
		}
	});
});
