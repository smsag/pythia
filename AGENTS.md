# Pythia — Agent Guidelines

## Project Overview

Obsidian plugin (TypeScript, esbuild). Lets users run LLM conversations (Anthropic + OpenAI) directly in the vault. Conversations, templates, and summary notes are first-class vault objects.

- **Entry point**: `main.ts` → `PythiaPlugin extends Plugin`
- **Sidebar**: `sidebar.ts` → `PythiaSidebarView extends ItemView`
- **Settings**: `settings.ts` → `PythiaSettingTab`, `PythiaSettings`, `DEFAULT_SETTINGS`
- **Types**: `models/types.ts` — `Conversation`, `Message`, `Favorite`, `PythiaTemplate`

## Build & Test

```bash
npm install
npm run build     # tsc -noEmit -skipLibCheck && esbuild production
npm run dev       # watch mode
```

Always run `npm run build` after any TypeScript change to verify compilation.

## Architecture

```
main.ts           ← Plugin lifecycle, commands, data persistence
sidebar.ts        ← All chat UI (ItemView)
settings.ts       ← Settings tab + DEFAULT_SETTINGS
models/types.ts   ← Shared interfaces (Conversation, Message, Favorite, PythiaTemplate)
services/
  AnthropicService.ts   ← Streaming + summary + favorite name generation (Haiku)
  OpenAIProvider.ts     ← Same interface, GPT-4o-mini for favorite names
  LLMProvider.ts        ← Interface: streamMessage, generateSummary, generateFavoriteName
  LLMRouter.ts          ← Routes calls to the correct provider by conversation.provider
  ContextBuilder.ts     ← buildSystemPrompt(), buildAttachedNotesContent()
  ConversationStore.ts  ← CRUD over plugin.conversations + saveConversations()
  NoteWriter.ts         ← Vault file writes (summary notes, ad-hoc saves)
  TemplateLoader.ts     ← Scans templatesFolder for pythia_template: true notes
suggest/
  ConversationSuggest.ts, NoteSuggest.ts, FolderSuggest.ts   ← FuzzySuggestModal wrappers
  TemplateSuggest.ts    ← Uses PythiaTemplate
  ConversationSettingsModal.ts  ← Provider/model picker (contains real model IDs — do not rename)
  InputModal.ts, ResumeModeModal.ts
```

## Key Conventions

- **Never rename Anthropic model IDs** (`claude-sonnet-4-6`, `claude-opus-4`, `claude-haiku-3-5`, `gpt-4o`, `gpt-4o-mini`, etc.) — these are real API values.
- **Naming**: use `Pythia`/`pythia` prefix for all plugin-level identifiers. Never use `Claude`/`claude` as an identifier (only in model ID strings).
- **Secret storage**: API keys live in `app.secretStorage` (Obsidian-native, since 1.11.4). Settings store only the secret name (`pythia-anthropic`, `pythia-openai`), never the key value.
- **Persistence**: `Conversation` objects (including `favorites[]`) are serialized to `data.json` via `ConversationStore`. Settings live in the same file under `settings`.
- **Context vs attached notes**: `conversation.contextNotes` → system prompt, every turn. `pendingAttachedNotes` → one message only, then cleared.
- **Frontmatter key**: templates use `pythia_template: true` (not `claude_template`).
- **Default folders**: `Pythia/Templates`, `Pythia/Conversations`, `Pythia/Scratch`.

## README Rule

**Every new user-facing feature must be reflected in README.md before committing.**

Specifically:
- Add a bullet to the **Features** section.
- If the feature adds keyboard shortcuts, update or create a **Chat input** table.
- If the feature changes frontmatter keys or default folder paths, update the relevant example or Settings table.
- If the feature changes behaviour the user directly interacts with (new UI section, new command, new modal), add or update the relevant section.

Do not add internal refactors or bug fixes to the README.

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
