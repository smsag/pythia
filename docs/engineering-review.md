# Engineering Review — Pythia

*Initial review: 2026-05-29 at v1.10.2.*
*Updated: 2026-05-30 — v1.10.2 session fixes.*
*Updated: 2026-05-30 — v1.11.0 batch: #2, #3 (partial), #7, #8, #9, #13, #16 resolved. 6 new suggestions added (#17–#22).*

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-29 | Initial review at v1.10.2 |
| 2026-05-30 | `onStarClick` reuses chapter name (eliminates `generateFavoriteName` API call). #16 added. |
| 2026-05-30 | v1.11.0: #16 dead code removed. #9 `Buffer` guard. #7 persistence try/catch + flush-on-unload. #3 `maxConversations` cap+eviction. #2 serial backfill. #8 `MarkdownRenderer` try/catch. #13 auto-abbreviate model names. New suggestions #17–#22 added. |

---

## File Inventory (sorted by lines, v1.11.0)

| # | File | Lines | Role |
|---|------|------:|------|
| 1 | `sidebar.ts` | 1 918 | Main view: UI, rendering, streaming, interaction |
| 2 | `styles.css` | 1 197 | All plugin CSS |
| 3 | `docs/design-system.css` | 525 | Design-system reference / prototype |
| 4 | `main.ts` | 751 | Plugin entry, commands, conversation lifecycle |
| 5 | `services/OpenAIProvider.ts` | 379 | OpenAI streaming + utility calls |
| 6 | `settings.ts` | 373 | Settings schema + settings tab UI |
| 7 | `services/AnthropicService.ts` | 317 | Anthropic streaming + utility calls |
| 8 | `locales/de.ts` | 213 | German i18n strings |
| 9 | `locales/en.ts` | 212 | English i18n strings |
| 10 | `CLAUDE.md` | 249 | Agent instructions |
| 11 | `docs/pythia-spec.md` | 324 | Product spec |
| 12 | `README.md` | 207 | User-facing docs |
| 13 | `ui/InlineSuggest.ts` | 152 | `#` note picker autocomplete |
| 14 | `services/NoteWriter.ts` | 135 | Vault write operations |
| 15 | `suggest/ConversationSettingsModal.ts` | 133 | Per-conversation settings modal |
| 16 | `services/TemplateLoader.ts` | 87 | Template discovery + parsing |
| 17 | `suggest/ConversationSuggest.ts` | 82 | Fuzzy-search modals for conversations / favorites |
| 18 | `AGENTS.md` | 81 | Agent / worktree workflow docs |
| 19 | `models/types.ts` | 76 | Shared TypeScript interfaces |
| 20 | `services/LLMRouter.ts` | 68 | Dispatches calls to the active provider |
| 21 | `suggest/InputModal.ts` | 69 | Generic text-input modal |
| 22 | `services/ToolHandler.ts` | 63 | `create_note` tool definition + execution |
| 23 | `services/ConversationStore.ts` | 58 | In-memory store + debounced persistence |
| 24 | `suggest/ResumeModeModal.ts` | 54 | Resume-mode picker |
| 25 | `services/ContextBuilder.ts` | 50 | Builds system prompt + attaches notes |
| 26 | `esbuild.config.mjs` | 47 | Build configuration |
| 27 | `versions.json` | 43 | Min Obsidian version per release |
| 28 | `suggest/DeleteConversationModal.ts` | 42 | Delete-conversation confirmation modal |
| 29 | `suggest/FolderSuggest.ts` | 37 | Folder picker autocomplete |
| 30 | `suggest/TemplateSuggest.ts` | 36 | Template picker modal |
| 31 | `services/apiError.ts` | 33 | HTTP error classification |
| 32 | `suggest/NoteSuggest.ts` | 29 | Note path picker |
| 33 | `services/LLMProvider.ts` | 20 | Provider interface |
| 34 | `utils.ts` | 20 | `todayISO`, `getFilesInFolder` |
| 35 | `package.json` | 25 | Project manifest |
| 36 | `i18n.ts` | 16 | i18n lookup helper |
| 37 | `tsconfig.json` | 17 | TypeScript config |
| 38 | `manifest.json` | 10 | Obsidian plugin manifest |

**Source total (excluding lock file and generated `main.js`):** ~6 700 lines.

---

## Improvement Suggestions

### Status of original 16

| # | Suggestion | Status |
|---|---|---|
| 1 | Incremental DOM rendering in `renderMessages` | Open — Backlog |
| 2 | Batch `backfillChapterNames` requests | ✅ Done — serial `for` loop |
| 3 | `data.json` unbounded growth | ✅ Partial — `maxConversations` cap + eviction; per-file split still Backlog |
| 4 | Cache context note file reads | Open — Backlog |
| 5 | Inject `NoteWriter` instead of constructing inline | Open — Now |
| 6 | Extract `parseTitleAndSummary` to shared util | Open — Now |
| 7 | Error handling on persistence failure | ✅ Done — try/catch + Notice + flush-on-unload |
| 8 | Wrap `MarkdownRenderer.render()` in try/catch | ✅ Done |
| 9 | Guard `Buffer` usage in `legacyDecrypt` | ✅ Done |
| 10 | Harden fire-and-forget async in fork path | Open — Backlog |
| 11 | Split `sidebar.ts` into sub-components | Open — Backlog |
| 12 | `BaseProvider` abstract class | Open — Backlog |
| 13 | Auto-abbreviate unknown model names | ✅ Done |
| 14 | Extract `normalizeMessages` to shared util | Open — Now |
| 15 | Zero automated tests | Open — Now |
| 16 | Remove dead `generateFavoriteName` | ✅ Done |

---

### New suggestions (#17–#22)

---

#### 17 — `maxConversations` eviction can silently drop the active conversation

**File:** `main.ts · persistData()`
**Severity:** Medium

Eviction runs inside `persistData()`, which mutates `this.conversations` in-place. If the currently open conversation has no starred messages and the cap is already full when the user first sends a message, the conversation is evicted from the array during the save triggered by that very message. On the next debounced save it re-appears, but the oscillation means the first save round-trips with a dropped conversation, and any crash in between loses the turn.

**Fix:** Protect the active conversation ID during eviction:

```typescript
const activeId = this.view?.activeConversationId ?? null;
const evictable = plain.filter(c => c.id !== activeId);
```

---

#### 18 — `SecretStorage.getSecret()` is async but called synchronously

**File:** `main.ts · loadPluginData()`, `setApiKey()`, `setOpenAIKey()`

Obsidian's current typings declare `getSecret(key: string): Promise<string | null>`. The plugin assigns the return value directly:

```typescript
this.plaintextApiKey = this.app.secretStorage.getSecret(secretName) ?? "";
```

On Electron (macOS/Windows) the underlying call resolves synchronously via a cached in-memory map, so this works today. On iOS/Android WebKit — where SecretStorage is backed by the system keychain — it is genuinely async: `plaintextApiKey` would be set to a `Promise` object, making every API call fail with an authentication error.

**Fix:** Await the call and make `loadPluginData` propagate the async nature through:

```typescript
this.plaintextApiKey =
    (await this.app.secretStorage.getSecret(this.settings.anthropicSecretName)) ?? "";
```

---

#### 19 — `color-mix()` requires Chromium 111; Obsidian minimum is Electron with Chromium 108

**File:** `styles.css`

```css
border: 1px solid color-mix(in srgb, var(--color-accent) 60%, black);
```

`color-mix()` shipped in Chromium 111. Obsidian's `minAppVersion` is `1.11.4`, which shipped with Chromium 108. Users who haven't updated would see a transparent or white border rather than the accent-tinted one.

**Fix:** Use a CSS custom property fallback or a simple `opacity` approach:

```css
border: 1px solid var(--color-accent);
opacity: 0.6; /* on the border layer only */
```

Or accept the behaviour and bump `minAppVersion` to one that ships Chromium 111+.

---

#### 20 — `fixDiagramSvgSize` accumulates observers across full DOM rebuilds

**File:** `sidebar.ts · fixDiagramSvgSize()`, `renderMessages()`

`renderMessages()` calls `this.messagesEl.empty()` and re-renders every message from scratch. Each rebuild calls `decorateCodeBlocks()`, which calls `fixDiagramSvgSize()` for each diagram, arming a new `MutationObserver` with a 10-second safety timeout. The observer from the previous render is attached to the now-detached DOM node and keeps running until the timeout fires. For a conversation with 5 diagrams refreshed 4 times during streaming, 20 observers accumulate simultaneously, each holding a closure over the old DOM node.

**Fix:** Track observers on the element using a `WeakMap` or a `data-*` attribute, and `disconnect()` any existing observer before arming a new one:

```typescript
private readonly diagObservers = new WeakMap<HTMLElement, MutationObserver>();

private fixDiagramSvgSize(el: HTMLElement): void {
    this.diagObservers.get(el)?.disconnect();
    // … arm new observer …
    this.diagObservers.set(el, mo);
}
```

---

#### 21 — `outputLanguage` setting value is injected verbatim into LLM prompts

**File:** `settings.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`

The dropdown stores `"English"` / `"German"` as the raw option values, and `langInstruction()` injects them directly:

```typescript
return `\n\nRespond in ${lang}.`;
```

This means: (a) the UI label and the LLM instruction are the same string — translating the UI label would break the prompt; (b) if the stored value in `data.json` is stale after a downgrade or manual edit, an unexpected string gets injected silently; (c) adding a new language requires both a new dropdown option and verification that the English LLM instruction word is correct.

**Fix:** Separate the stored key (`"en"` / `"de"`) from the LLM instruction string:

```typescript
const LANG_INSTRUCTIONS: Record<string, string> = {
    en: "English",
    de: "German",
};
function langInstruction(lang: string): string {
    const label = LANG_INSTRUCTIONS[lang];
    return label ? `\n\nRespond in ${label}.` : "";
}
```

---

#### 22 — Active stream is not aborted when the sidebar view is closed

**File:** `sidebar.ts`

`PythiaSidebarView` has no `onClose()` / `onunload()` lifecycle hook. If the user closes the sidebar pane while a response is streaming, `isStreaming` stays `true` on the dead view instance, the `AbortController` in the provider is never triggered, the API call keeps running and accumulating tokens, and the streamed text is written to the conversation in memory but the UI is gone.

`main.ts` now calls `llmRouter.abort()` in the plugin's `onunload`, but that only fires when the entire plugin unloads — not when the sidebar leaf is closed by the user.

**Fix:** Override `onClose()` in `PythiaSidebarView`:

```typescript
onClose(): void {
    if (this.isStreaming) {
        this.plugin.llmRouter.abort();
        this.isStreaming = false;
    }
}
```

---

## Priority Matrix

| # | Suggestion | Status | Impact | Effort | Priority |
|---|---|---|---|---|---|
| 22 | Abort stream on view close | Open | High | Very Low | ⭐ Now |
| 18 | `getSecret()` async safety | Open | High | Low | ⭐ Now |
| 17 | Eviction can drop active conversation | Open | Medium | Low | ⭐ Now |
| 21 | `outputLanguage` value coupled to LLM prompt | Open | Medium | Low | ⭐ Now |
| 6 | Extract `parseTitleAndSummary` to shared util | Open | High | Low | ⭐ Now |
| 14 | Extract `normalizeMessages` to shared util | Open | Medium | Low | ⭐ Now |
| 5 | Inject `NoteWriter` instead of constructing inline | Open | Low | Low | ⭐ Now |
| 15 | Add Vitest unit tests for pure functions | Open | High | Low | Soon |
| 19 | `color-mix()` Chromium 111 compatibility | Open | Low | Very Low | Soon |
| 20 | Observer accumulation across DOM rebuilds | Open | Medium | Low | Soon |
| 1 | Incremental DOM rendering in `renderMessages` | Open | High | High | Backlog |
| 11 | Split `sidebar.ts` into sub-components | Open | High | High | Backlog |
| 12 | `BaseProvider` abstract class | Open | Medium | High | Backlog |
| 3 | Per-conversation file storage (long-term) | Open | High | High | Backlog |
| 4 | Cache context note file reads | Open | Low | Medium | Backlog |
| 10 | Harden fire-and-forget async in fork path | Open | Low | Medium | Backlog |
