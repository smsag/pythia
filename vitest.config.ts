import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			// Only report on pure-function modules that can be tested without
			// the Obsidian API. Everything else (sidebar.ts, main.ts, providers)
			// is excluded — their 0 % would be noise until the sidebar-split
			// refactor (#11) extracts more testable surface.
			include: [
				"services/messageUtils.ts",
				"services/apiError.ts",
			],
			thresholds: {
				statements: 90,
				branches:   85,
				functions:  100,
				lines:      90,
			},
		},
	},
});
