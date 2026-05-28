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
- **Fork conversation** — select any text in a response, then press **Fork** in the action strip to branch the conversation: a new conversation inherits the same system prompt and template, starts empty, and shows a banner linking back to the source with its summary
- **`#` Chapter navigator** — the `#` button at the bottom-right of the message area opens a popover listing all starred messages and user turns for quick scroll navigation
- **Delete last exchange** — long-press (450 ms) on the last user bubble to delete the most recent prompt + response pair (only the last exchange; a confirmation step is shown before deletion)
- **Reference row** — a compact pill strip that auto-appears when a conversation has associated vault files (saved notes, summary notes); click a pill to open the file, × to delete it
- **Save output** — write any response directly to a new vault note
- **Selection action strip** — select any text in the chat to reveal a fixed action bar above the input: **Copy**, **Insert into note**, **Save to inbox**, **Fork**
- **Inbox** — "Save to inbox" prepends the selection with a timestamp to a configurable inbox note
- **AI note creation** — ask Pythia to create a vault note in plain language (e.g. *"Create a note summarising our discussion at Research/Topic.md"*); a status chip confirms creation with a clickable link
- **`#` note picker** — type `#` in the chat input to fuzzy-search all vault notes and attach one inline, just like VS Code's `#` file picker
- **Multi-provider** — supports Anthropic (Claude) and OpenAI models, switchable per conversation
- **Context menus** — right-click any file in the Explorer to open a conversation about that note; right-click a folder to combine all its notes as context; right-click selected text in the editor to send it to Pythia
- **Browse conversations** — open any past conversation directly from the Command Palette, no resume-mode step
- **Delete conversation** — remove any conversation from `data.json` via the sidebar trash button or the Command Palette (confirmation required)
- **Browse favorites** — fuzzy-search all starred responses across every conversation and jump directly to one from the Command Palette
- **Deep-link URIs** — open, create, or resume conversations via `obsidian://pythia` links from anywhere
- **Mobile-compatible** — works on Obsidian for iOS and Android (requires Obsidian ≥ 1.11.4)

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
| `Pythia: Open sidebar` | Open / focus the chat sidebar |

### Context menus

- **Editor** — select any text in a note, right-click → **Send to Pythia**: opens a new conversation with the selected text pre-filled in the input.
- **File Explorer (file)** — right-click any `.md` file → **Chat about this note**: opens a new conversation with the file injected as context and an auto-generated summary of its content.
- **File Explorer (folder)** — right-click any folder → **Chat about folder**: combines all markdown files in the folder as context (up to 20,000 characters).

## Templates

Templates are vault notes with `pythia_template: true` in the frontmatter:

```markdown
---
pythia_template: true
name: Job Application
model: claude-sonnet-4-6
max_tokens: 4000
context_notes:
  - CV/Steffen-CV.md
  - Freelance/Reason-Why.md
resume_mode: summary
output_folder: Applications
---

You are helping write job applications for senior roles…
```

Place templates in the configured templates folder (default: `Pythia/Templates/`). The plugin discovers them automatically.

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
| Templates folder | `Pythia/Templates` | Scanned for `pythia_template: true` |
| Conversations folder | `Pythia/Conversations` | Where summary notes are saved |
| Scratch folder | `Pythia/Scratch` | For ad-hoc conversations |
| Inbox note | `Pythia/Inbox.md` | Target file for "Save to inbox" — selections are prepended with a timestamp |
| Auto-save summary | `true` | Write summary note on conversation end |
| Default resume mode | `summary` | `full` or `summary` |
| Max messages per session | `100` | Soft cap; 0 = unlimited |
| Debug mode | `false` | Log API calls and payloads to the developer console |
| Allow AI to create notes | `true` | Pass a `create_note` tool to the LLM so it can write vault notes on request |

API keys are stored in Obsidian's native `SecretStorage` API (vault-scoped, never written to `data.json`). The settings tab uses `SecretComponent` to let you select or create a named secret. Only the secret's name (e.g. `pythia-anthropic`) is stored in `data.json` — the value never leaves SecretStorage.

Requires Obsidian ≥ 1.11.4.

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
