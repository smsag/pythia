import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			// Only report on modules that have tests. sidebar.ts, main.ts, and
			// the two providers remain excluded — their 0 % would be noise until
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
