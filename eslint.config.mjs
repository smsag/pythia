import tseslint from "typescript-eslint";

export default tseslint.config(
	// Global ignores — these must be a standalone object with only `ignores`
	{ ignores: ["node_modules/**", "coverage/**", "main.js"] },

	// Apply to all TypeScript files
	{
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommended],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
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
			// Fire-and-forget async calls must use void operator to signal intent
			"@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],

			// ── Project hard rules, enforced (ADR-159) ─────────────────────
			// `==` hides type coercion; `== null` is the one idiom worth keeping.
			"eqeqeq": ["error", "always", { null: "ignore" }],
			// Locale date/time formatters differ in order, punctuation and width
			// between locales; the UI draws a fixed mono rhythm (ADR-139). Use
			// formatDate / formatClockTime from services/messageUtils.ts.
			"no-restricted-properties": ["error",
				{ property: "toLocaleDateString", message: "Use formatDate() from services/messageUtils.ts (ADR-139)." },
				{ property: "toLocaleTimeString", message: "Use formatClockTime() from services/messageUtils.ts (ADR-139)." },
			],
			// HTML string injection is how model output would reach the DOM as
			// markup. Build nodes with Obsidian's DOM helpers or MarkdownRenderer.
			"no-restricted-syntax": ["error",
				{ selector: "AssignmentExpression > MemberExpression.left[property.name='innerHTML']", message: "Never assign innerHTML — build DOM nodes or use MarkdownRenderer." },
				{ selector: "AssignmentExpression > MemberExpression.left[property.name='outerHTML']", message: "Never assign outerHTML — build DOM nodes or use MarkdownRenderer." },
				{ selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Never insert HTML strings — build DOM nodes or use MarkdownRenderer." },
				// A document/window listener outlives the surface that added it unless
				// its removal is wired to that surface's close path — five copies of
				// that wiring each had the same leak (ADR-161). Popovers and menus go
				// through ui/outsideDismiss.ts; the few files that genuinely need a raw
				// listener are allow-listed below.
				{ selector: "CallExpression[callee.object.name='document'][callee.property.name='addEventListener']", message: "Use attachOutsideDismiss() from ui/outsideDismiss.ts (ADR-161), or allow-list this file in eslint.config.mjs with a reason." },
				{ selector: "CallExpression[callee.object.name='window'][callee.property.name='addEventListener']", message: "Use the view's registerDomEvent or watchViewport() (ADR-161), or allow-list this file in eslint.config.mjs with a reason." },
			],
		},
	},
	// Files that own a raw document/window listener AND its removal (ADR-161):
	// the dismiss helper itself; the drag-to-pan gesture (pointer capture must
	// follow the pointer off the element); the action sheet and inline picker
	// (register and remove in the same open/close pair); the delete bar (capture
	// listener added and removed by hidePreview); the embedding iframe bridge.
	{
		files: [
			"ui/outsideDismiss.ts",
			"ui/dragToPan.ts",
			// keyboardInset: Obsidian mobile's keyboardWillShow/Hide are window events
			// with no Obsidian API; watchViewport() adds and removes them as a pair.
			"ui/keyboardInset.ts",
			"ui/ActionSheet.ts",
			"ui/InlineSuggest.ts",
			"ui/ExchangeActionsController.ts",
			"services/embedding/host/**/*.ts",
		],
		rules: {
			"no-restricted-syntax": ["error",
				{ selector: "AssignmentExpression > MemberExpression.left[property.name='innerHTML']", message: "Never assign innerHTML — build DOM nodes or use MarkdownRenderer." },
				{ selector: "AssignmentExpression > MemberExpression.left[property.name='outerHTML']", message: "Never assign outerHTML — build DOM nodes or use MarkdownRenderer." },
				{ selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Never insert HTML strings — build DOM nodes or use MarkdownRenderer." },
			],
		},
	},
	// Test files may use console for debugging, and may build fixtures from
	// HTML strings — the innerHTML rule guards the plugin's DOM, not test setup.
	{
		files: ["tests/**/*.ts"],
		rules: {
			"no-console": "off",
			"no-restricted-syntax": "off",
		},
	}
);
