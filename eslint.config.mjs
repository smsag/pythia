import tseslint from "typescript-eslint";

export default tseslint.config(
	// Global ignores — these must be a standalone object with only `ignores`
	{ ignores: ["node_modules/**", "coverage/**", "main.js"] },

	// Apply to all TypeScript files
	{
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommended],
		rules: {
			// ── Warnings ──────────────────────────────────────────────────────
			// console.warn/error are always acceptable in catch blocks;
			// console.log guarded by settings.debugMode uses eslint-disable inline
			"no-console": ["warn", { allow: ["warn", "error"] }],

			// ── Warnings ──────────────────────────────────────────────────────
			"@typescript-eslint/no-unused-vars": ["warn", {
				argsIgnorePattern:     "^_",
				varsIgnorePattern:     "^_",
				caughtErrorsIgnorePattern: "^_",
			}],

			// ── Relaxations for Obsidian plugin patterns ───────────────────
			// Obsidian SDK and Electron access require casting through any
			"@typescript-eslint/no-explicit-any":      "off",
			// Empty catch blocks are used intentionally for non-critical ops
			"@typescript-eslint/no-empty-object-type": "off",
			// void operator is used intentionally for fire-and-forget
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
	// Test files may use console for debugging
	{
		files: ["tests/**/*.ts"],
		rules: {
			"no-console": "off",
		},
	}
);
