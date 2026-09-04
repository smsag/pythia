# Pythia

An [Obsidian](https://obsidian.md) plugin that brings AI conversations (Anthropic and OpenAI) into your vault as first-class objects — with templates, context injection, streaming chat, summaries, and PKM-native storage.

## Features

- **Command palette workflows** — start, resume, and manage AI conversations without leaving Obsidian
- **Template system** — define system prompts in vault markdown files (frontmatter-driven)
- **Streaming chat** — responses rendered token-by-token in the sidebar panel
- **Conversation storage** — full history saved in `data.json`; conversations are automatically given a short AI-generated title after the first exchange; optional summary notes written to your vault
- **Summary panel** — press ✦ in the toolbar to generate an AI summary and a new title for the conversation in one step. The summary appears in a collapsible panel below the header, with a timestamp showing when it was last generated. A ✦ indicator in the header row signals that a summary exists; click it to expand the panel.
- **Resume modes** — continue past conversations with full message history or an AI-generated summary (controls token cost)
- **Favorites** — star any assistant response; a short AI-generated title is assigned automatically; starred messages are accessible via the `#` chapter navigator
- **Fork conversation** — select any text in a response, then press **Fork** in the action strip to branch the conversation: a new conversation inherits the same system prompt and template, starts empty, and shows a banner linking back to the source with its summary. Clicking the banner link reopens the source conversation and scrolls silently to the exact message that was forked from
- **Forks navigator** — the `#` chapter navigator shows a **Forks** section at the top when the active conversation has child forks, making it easy to jump to any branch
- **`#` Chapter navigator** — the `#` button at the bottom-right of the message area opens a popover listing all starred messages and user turns for quick scroll navigation
- **Delete last exchange** — long-press (450 ms) on the last user bubble to delete the most recent prompt + response pair (only the last exchange; a confirmation step is shown before deletion)
- **Reference row** — a compact pill strip that auto-appears when a conversation has associated vault files (context notes, saved notes, summary notes); each pill shows an estimated token count; click a pill to open the file, × to remove it from context or delete it from the vault
- **Send button token count** — the Send button label shows the input token count from the last exchange (e.g. `Send · 3.9k`) so you can monitor context window usage at a glance
- **Code block pan** — wide code blocks and Mermaid diagrams are clipped to the chat width; click-and-drag (macOS mouse) or swipe (iOS touch / trackpad) to pan the content horizontally
- **Save output** — write any response directly to a new vault note
- **Selection action strip** — select any text in the chat to reveal a fixed action bar above the input: **Copy**, **Insert into note**, **Save to inbox**, **Fork**
- **Inbox** — "Save to inbox" prepends the selection with a timestamp to a configurable inbox note
- **AI note creation** — ask Pythia to create, update, or rewrite a vault note; a confirm chip appears before any write so you can approve or cancel, and a clickable link confirms the result
- **`#` note picker** — type `#` in the chat input to fuzzy-search all vault notes and attach one inline, just like VS Code's `#` file picker
- **Vault context (semantic RAG)** — toggle the **library icon** in the input toolbar to let Pythia automatically pull the most semantically relevant notes from your **whole vault** into every message, without hand-picking them. It's a per-conversation switch (like the web-search globe). Uses the same on-device embedding model as "related conversations" (nothing leaves your machine), and feeds retrieved notes through the normal attached-note pipeline so they are excerpted, token-counted, and **cited** just like notes you attach yourself; each turn's auto-pulled notes also show as distinct read-only pills in the reference row. Off by default (a Command Palette command sets the default for new conversations).
- **Multi-provider** — supports Anthropic (Claude) and OpenAI models, switchable per conversation
- **Context menus** — right-click any file in the Explorer to open a conversation about that note; right-click a folder to combine all its notes as context; right-click selected text in the editor to send it to Pythia
- **Browse conversations** — open any past conversation directly from the Command Palette, no resume-mode step
- **Delete conversation** — remove any conversation from `data.json` via the sidebar trash button or the Command Palette (confirmation required)
- **Browse favorites** — fuzzy-search all starred responses across every conversation and jump directly to one from the Command Palette
- **Deep-link URIs** — open, create, or resume conversations via `obsidian://pythia` links from anywhere
- **Mobile-compatible** — works on Obsidian for iOS and Android (requires Obsidian ≥ 1.4.0)

## Commands

| Command | Description |
|---|---|
| `Pythia: New conversation` | Blank conversation, no context |
| `Pythia: New conversation from template` | Pick a template → loads system prompt |
| `Pythia: New conversation with current note` | Active note auto-injected as context |
| `Pythia: New conversation from clipboard` | Pre-fills the input with current clipboard text |
| `Pythia: Resume conversation` | Pick a past conversation → choose resume mode |
| `Pythia: Browse conversations` | Fuzzy-search all conversations and open one directly |
| `Pythia: Browse favorites` | Fuzzy-search all starred responses across every conversation and jump to one |
| `Pythia: Toggle vault context default (semantic RAG)` | Turn the vault-context **default** on/off for new conversations (per-conversation toggle lives on the input toolbar) |
| `Pythia: Rebuild vault context index` | Wipe and rebuild the semantic index in the background (e.g. after changing indexed folders) |
| `Pythia: Open sidebar` | Open / focus the chat sidebar |

### Context menus

- **Editor** — select any text in a note, right-click → **Send to Pythia**: opens a new conversation with the selected text pre-filled in the input.
- **File Explorer (file)** — right-click any `.md` file → **Chat about this note**: opens a new conversation with the file injected as context and an auto-generated summary of its content.
- **File Explorer (folder)** — right-click any folder → **Chat about folder**: combines all markdown files in the folder as context (up to 20,000 characters).

## Templates

Templates are vault notes with `type: Pythia Prompt Template` in the frontmatter. Place them in the configured templates folder (default: `Pythia/Templates/`). The plugin discovers them automatically.

```markdown
---
type: Pythia Prompt Template
name: Job Application
model: claude-sonnet-4-6
max_tokens: 4000
context_notes:
  - CV/Steffen-CV.md
  - Freelance/Reason-Why.md
resume_mode: summary
output_folder: Applications
write_mode: create
auto_prompt: Draft a cover letter based on the attached CV and job description.
---

You are helping write job applications for senior roles…
```

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `type` | **yes** | Must be exactly `Pythia Prompt Template` |
| `name` | no | Display name in the template picker (defaults to filename) |
| `provider` | no | `anthropic` or `openai` — overrides the default provider |
| `model` | no | Model ID (e.g. `claude-sonnet-4-6`) — overrides the default |
| `max_tokens` | no | Token limit override (default: 4096) |
| `context_notes` | no | Vault paths of notes always attached as context |
| `resume_mode` | no | `full` (entire history) or `summary` (condensed) — controls token cost on long conversations |
| `output_folder` | no | Default folder for AI-created notes. Use `"."` to resolve to the same folder as the currently active note |
| `write_mode` | no | `create` (default) — LLM writes a new note. `update` — LLM prepends above the source note. `rewrite` — LLM replaces the full content of a context note. `none` — no write tool injected. |
| `auto_prompt` | no | Message sent automatically the moment the conversation opens — no manual typing required |

### write_mode

Controls what tool the LLM is given. A confirm chip always appears before any write executes — you can approve or cancel each operation.

- **`create`** (default) — exposes `create_note`. The LLM writes output to a new or specified vault note.
- **`update`** — exposes `prepend_note`. The LLM prepends its output to the top of the source note, separated by `---`.
- **`rewrite`** — exposes `rewrite_note`. The LLM replaces the full content of a note that was provided as context. The path must match an attached context note — the LLM cannot invent a target.
- **`none`** — no write tool; the LLM responds in chat only.

Use `rewrite` for editing workflows where Pythia should revise an existing document in place — e.g. "restructure this as a MECE outline" or "make this more concise". Use `update` for processing workflows where the AI result should live alongside the source material.

## Recommended hotkeys

Obsidian does not support plugin-defined default hotkeys, so assign these manually in **Settings → Hotkeys**:

| Suggested binding | Command |
|---|---|
| `Cmd/Ctrl + Shift + P` | `Pythia: Open sidebar` |
| `Cmd/Ctrl + Shift + N` | `Pythia: New conversation` |
| `Cmd/Ctrl + Shift + V` | `Pythia: New conversation from clipboard` |

## Deep-link URIs

Use `obsidian://pythia` links to open Pythia from browsers, Shortcuts automations, or vault notes:

| URI | Behaviour |
|---|---|
| `obsidian://pythia` | Open the sidebar |
| `obsidian://pythia?cmd=open` | Open the sidebar (explicit) |
| `obsidian://pythia?cmd=new` | Create a new blank conversation |
| `obsidian://pythia?cmd=resume&id=<uuid>` | Open a specific conversation by ID |
| `obsidian://pythia?cmd=template&name=<name>` | Create a conversation from a named template |

Vault note example:

```markdown
[Open Job Application chat](obsidian://pythia?cmd=template&name=Job%20Application)
```

### Resume link in saved notes

When you save a conversation to a vault note for the first time, Pythia automatically adds a `pythia` property to the note's frontmatter:

```yaml
---
pythia: "obsidian://pythia?vault=MyVault&cmd=resume&id=abc123"
---
```

Obsidian renders this as a clickable link in the note's **Properties** panel — click it to reopen that conversation in Pythia.

## Chat input

| Key | Action |
|---|---|
| `Enter` | Send message |
| `Shift+Enter` | Insert new line |
| `#query` | Fuzzy-search vault notes; `↑↓` to navigate, `↵` to attach, `Esc` to dismiss |

## Reference row

The **Reference** strip appears at the top of the sidebar whenever a conversation has associated vault files — a saved note or an auto-generated summary note. Each file is shown as a pill:

- **Click the filename** — opens the file in the editor.
- **× button** — shows a confirmation dialog, then permanently deletes the file from the vault and clears the link.

The row hides itself automatically when there are no associated files.

## Attached notes

**Attached notes** (the "Attach note" button or `#` trigger) are appended inline to one specific message only, then cleared automatically.

## Vault context (semantic RAG)

When **vault context** is on (the **library icon** in the input toolbar — a per-conversation toggle, like the web-search globe; the `Pythia: Toggle vault context default` command sets the default for new conversations), every message you send is first matched against a semantic index of your whole vault, and the most relevant notes are auto-attached to that turn — so Pythia can answer *from your knowledge base* without you hunting for the right notes.

- **On-device & private** — embeddings are computed locally by the same model as "related conversations" (see Settings → embedding model). No note content is sent anywhere except to your chosen LLM provider as normal context.
- **Off the UI thread & non-blocking** — embedding runs in a background Web Worker (with a fallback that stays responsive via cooperative throttling), and the index is built/refreshed in the background with a live progress notice. A chat turn only ranks against the ready index (embedding just your question), so replies are never delayed and Obsidian stays responsive while indexing. The first turn(s) right after enabling won't use vault context yet — later turns pull in relevant notes automatically.
- **Scoped to the folders you choose** — set **Folders to index** in Settings (one path per line; empty = whole vault). Scoping keeps the on-device index small and fast on large vaults.
- **Scales safely** — notes are read and embedded **one at a time** during indexing, so even a very large vault won't exhaust memory. A **Max notes to index** cap (default 5,000; Settings) guards against runaway indexes on huge vaults — if you exceed it you're told to scope to folders (or raise the cap) rather than silently missing notes.
- **Kept fresh, cheaply** — a debounced watcher updates the index note-by-note as you edit: a single edit re-embeds just that one note (not a whole-vault rescan), so keeping the index current is nearly free even on large vaults. Force a full rebuild any time with **Settings → Rebuild index** or the `Rebuild vault context index` command.
- **Cited, visible & bounded** — retrieved notes flow through the normal attached-note pipeline: long notes are excerpted to the most relevant sections, they count toward the attached-notes token warning, and they appear as numbered **citations** in the response, exactly like notes you attach by hand. Each turn's auto-retrieved notes also surface as distinct read-only pills in the reference row, so you can see what was pulled in.
- **Scoped** — Pythia's own `Conversations/` and `Scratch/` folders are excluded so saved chats aren't fed back in, and notes you already attached manually are never duplicated.

Tuning (via `data.json` for now — a settings-tab UI is planned): `vaultContextMaxNotes` (how many notes per turn, default 5) and `vaultContextSimilarity` (`strict` / `balanced` / `loose`).

## Vault Structure

```
vault/
├── Pythia/
│   ├── Templates/       ← your template notes
│   ├── Conversations/   ← auto-saved conversation summary notes
│   └── Scratch/         ← ad-hoc conversation notes
```

## Settings

| Setting | Default | Description |
|---|---|---|
| Anthropic API key | — | Secret name in Obsidian's native SecretStorage |
| OpenAI API key | — | Secret name in Obsidian's native SecretStorage |
| Default provider | `anthropic` | Anthropic or OpenAI |
| Default Anthropic model | `claude-sonnet-4-6` | Overridden per template |
| Default OpenAI model | `gpt-4o` | Overridden per template |
| Templates folder | `Pythia/Templates` | Scanned for `type: Pythia Prompt Template` |
| Conversations folder | `Pythia/Conversations` | Where summary notes are saved |
| Scratch folder | `Pythia/Scratch` | For ad-hoc conversations |
| Inbox note | `Pythia/Inbox.md` | Target file for "Save to inbox" — selections are prepended with a timestamp |
| Auto-save summary | `true` | Write summary note on conversation end |
| Default resume mode | `summary` | `full` or `summary` |
| Max messages per session | `100` | Soft cap; 0 = unlimited |
| Debug mode | `false` | Log API calls and payloads to the developer console |

API keys are stored in Obsidian's native `SecretStorage` API (vault-scoped, never written to `data.json`). The settings tab uses `SecretComponent` to let you select or create a named secret. Only the secret's name (e.g. `pythia-anthropic`) is stored in `data.json` — the value never leaves SecretStorage.

Requires Obsidian ≥ 1.4.0.

## Data & Privacy

Pythia sends data to third-party AI providers **only** when you actively use the chat. No data is collected, shared, or transmitted in any other way.

**What is sent externally:**

| Data | Sent to | When |
|---|---|---|
| Your chat messages and attached note content | Anthropic or OpenAI (whichever provider you select) | On every message you send |
| System prompt and context notes | Same provider | On every message you send |

**What stays local:**

- All conversation history is stored in your vault's `data.json` file — it never leaves your device except as part of the API calls above.
- API keys are stored in Obsidian's native `SecretStorage` (vault-scoped encryption). They are never written to `data.json` or transmitted anywhere beyond the respective provider's SDK.
- Pythia has no telemetry, analytics, or crash reporting.

**Provider privacy policies:**

- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)

You are responsible for reviewing those policies and ensuring your usage complies with any applicable data-handling requirements.

## Development

**Requirements:** Node.js, a local Obsidian vault for testing.

```bash
npm install
npm run dev       # watch mode
npm run build     # production build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/pythia/` in your vault, then enable the plugin in Obsidian settings.

## License

MIT — see [LICENSE](LICENSE).
