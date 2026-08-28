import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		// Prefer TypeScript source over built siblings: `main.js` (the esbuild
		// bundle) sits next to `main.ts`, and Vite's default order would resolve a
		// bare `../main` import to the bundle. Listing `.ts` first makes tests that
		// mount the real plugin (tests/viewRender.test.ts) hit source.
		extensions: [".ts", ".mts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
		alias: [
			// The `obsidian` npm package is types-only, so it cannot be imported at
			// runtime. Suites that mount the real view/plugin pull `obsidian` in
			// transitively; this maps it to a headless stub. Suites with their own
			// `vi.mock("obsidian")` shadow this alias, so they are unaffected.
			{ find: /^obsidian$/, replacement: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)) },
		],
	},
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			// Only report on modules that have tests. sidebar.ts, main.ts, and
			// the three providers remain excluded — their 0 % would be noise until
			// the sidebar-split refactor (#11) extracts more testable surface.
			include: [
				"services/messageUtils.ts",
				"services/apiError.ts",
				"services/NoteWriter.ts",
				"services/ToolHandler.ts",
				"services/ConversationStore.ts",
				"services/persistence.ts",
				"services/noteRelevance.ts",
				"services/noteChunking.ts",
				"services/retry.ts",
				"services/promptConstants.ts",
				"services/ContextBuilder.ts",
				"services/TemplateLoader.ts",
				"models/knownModels.ts",
			],
			thresholds: {
				statements: 90,
				branches:   80,
				functions:  95,
				lines:      90,
			},
		},
	},
});
