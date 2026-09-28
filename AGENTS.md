# Pythia — Agent Guidelines

## Project Overview

Obsidian plugin (TypeScript, esbuild). LLM conversations (Anthropic, OpenAI, Mistral) inside the vault; conversations, templates, glossary entries and summary notes are first-class vault objects. Search by meaning is Schreibstube's, reached through its API (ADR-223/224) — Pythia runs no model of its own.

**The file map, the engineering principles and the hard rules live in `CLAUDE.md`.** This file does not repeat them: a second copy of a file map is how this one went stale (it listed `settings.ts` as the home of `DEFAULT_SETTINGS`, two providers, and a Haiku favorite-name call removed long ago).

## Build & Test

```bash
npm install
npm run build     # tsc -noEmit -skipLibCheck && esbuild production
npm run dev       # watch mode
```

Before every commit run the same four steps CI runs: `npm run lint`, `npm run check:filesize`, `npm run build`, `npm test`.

CI installs with `npm ci --ignore-scripts`, so **no dependency may rely on an
install hook** (engineering-review #286). Adding one that does will pass locally
and fail in CI. Check a new native dependency against that before adding it.

## Key Conventions

- **Never rename model IDs** in `models/knownModels.ts` — they are real API values.
- **Naming**: use `Pythia`/`pythia` prefix for all plugin-level identifiers. Never use `Claude`/`claude` as an identifier (only in model ID strings).
- **Secret storage**: API keys live in `app.secretStorage` (Obsidian-native). Settings store only the secret name (`pythia-anthropic`, `pythia-openai`, …), never the key value.
- **Persistence**: `Conversation` objects are serialized to `data.json` through `PluginDataStore`; settings live in the same file under `settings`. Every value read back is validated (`mergeSettings`, `sanitizeConversationFields` — ADR-159).
- **Frontmatter key**: templates use `pythia_template: true`.
- **Default folders**: `Pythia/Templates`, `Pythia/Conversations`, `Pythia/Scratch`.

## README Rule

**Every new user-facing feature must be reflected in README.md before committing.**

Specifically:
- Add a bullet to the **Features** section.
- If the feature adds keyboard shortcuts, update or create a **Chat input** table.
- If the feature changes frontmatter keys or default folder paths, update the relevant example or Settings table.
- If the feature changes behaviour the user directly interacts with (new UI section, new command, new modal), add or update the relevant section.

Do not add internal refactors or bug fixes to the README.

## Releasing

Cut a release from `main` in this order:

0. **Prices** (ADR-163): merge the open *Update list prices* PR if the weekly workflow (`.github/workflows/update-pricing.yml`) left one, or run `npm run update:pricing` and review the diff of `models/modelPricing.ts` — every price a release ships has been read by a human. The script fails on a catalog model it cannot map to models.dev; fix the mapping in `scripts/modelsDev.mjs`, never by deleting the row. Likewise merge an open *Update context windows* PR (`.github/workflows/update-models.yml`, ADR-179) or run `npm run update:models`; the *Model catalog: upstream changes* issue is a list of decisions, not a release blocker. Both scripts share their id mapping in `scripts/modelsDev.mjs`.
1. **Bump the version in all four files** (they must agree — `tests/versionAgreement.test.ts` and the Release workflow both check):
   - `manifest.json` → `version`
   - `package.json` → `version`
   - `package-lock.json` → both root `version` fields (`npm install --package-lock-only --ignore-scripts` updates them)
   - `versions.json` → add `"X.Y.Z": "<minAppVersion>"` (copy the current `minAppVersion` from `manifest.json`)
2. Commit on `main` as `Release X.Y.Z` (summarize changes since the last release in the body).
3. **Publish via the Release workflow, not a tag push.** Trigger `.github/workflows/release.yml` with `workflow_dispatch` and input `version=X.Y.Z`. It builds and creates the GitHub release (tag `X.Y.Z`, no `v` prefix) with `main.js`, `manifest.json`, `styles.css` attached — the files Obsidian's plugin installer fetches.
   - The workflow **refuses to publish unless the version agrees with the repo**: `version` must be `X.Y.Z` (no `v`), and match `manifest.json`, `package.json` and a `versions.json` entry. Obsidian's installer reads the manifest rather than the tag, so a dispatch against a `main` that has not got step 1 yet fails in seconds instead of publishing a release whose manifest disagrees with its own tag — which cannot be corrected without deleting the release.
   - `release.yml` also fires on a pushed `[0-9]+.[0-9]+.[0-9]+` tag, **but agent git credentials are blocked from pushing tag refs (GitHub 403)** even when branch/`main` pushes succeed — so use `workflow_dispatch`. Dispatching on `main` tags the current `main` HEAD, so land the `Release X.Y.Z` commit first.
4. Verify: `npm run build`, `npm run lint`, `npm run check:filesize`, `npm test` all green before step 2.

## Obsidian API Notes

- `app.secretStorage.getSecret(id)` / `setSecret(id, value)` — synchronous, vault-scoped. Added in Obsidian 1.11.4.
- `SecretComponent(app, containerEl)` — settings UI widget for picking/creating secrets.
- `MarkdownRenderer.render(app, content, el, sourcePath, component)` — renders markdown into a DOM element.
- `FuzzySuggestModal<T>` — base for all picker modals.
- `ItemView` — base for the sidebar panel.
- Plugin `minAppVersion` is `1.11.4` (required for secretStorage). Plugin runs on both desktop and mobile.

## What NOT to Do

- Do not use `electron.safeStorage` for new features — legacy only (kept in `legacyDecrypt()`).
- Do not write API key values to `data.json` or any vault file.
- Do not add `isDesktopOnly: true` — the plugin is intentionally mobile-compatible.
- Do not create separate files to document changes unless the user asks.
