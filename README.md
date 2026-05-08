# Pythia

An [Obsidian](https://obsidian.md) plugin that brings AI conversations (Anthropic and OpenAI) into your vault as first-class objects — with templates, context injection, streaming chat, and PKM-native storage.

## Features

- **Command palette workflows** — start, resume, and manage AI conversations without leaving Obsidian
- **Template system** — define system prompts and auto-attached context notes in vault markdown files (frontmatter-driven)
- **Context injection** — attach any vault note as context for a conversation, manually or via template
- **Streaming chat** — responses rendered token-by-token in the sidebar panel
- **Conversation storage** — full history saved in `data.json`; conversations are automatically given a short AI-generated title after the first exchange; optional summary notes written to your vault
- **Resume modes** — continue past conversations with full message history or an AI-generated summary (controls token cost)
- **Favorites** — star any assistant response; a short AI-generated title is assigned automatically; favorites appear as jump links at the top of the conversation
- **Save output** — write any response directly to a new vault note; select any text in the chat to **Copy**, **Insert into note**, or **Save to inbox** (prepends the selection with a timestamp to a configurable inbox note)
- **AI note creation** — ask Pythia to create a vault note in plain language (e.g. *"Create a note summarising our discussion at Research/Topic.md"*); a status chip confirms creation with a clickable link
- **`#` note picker** — type `#` in the chat input to fuzzy-search all vault notes and attach one inline, just like VS Code's `#` file picker
- **Multi-provider** — supports Anthropic (Claude) and OpenAI models, switchable per conversation
- **Context menus** — right-click selected text in the editor or any file in the Explorer to open a conversation instantly
- **Browse conversations** — open any past conversation directly from the Command Palette, no resume-mode step
- **Browse favorites** — fuzzy-search all starred responses across every conversation and jump directly to one from the Command Palette
- **Deep-link URIs** — open, create, or resume conversations via `obsidian://pythia` links from anywhere
- **Mobile-compatible** — works on Obsidian for iOS and Android (requires Obsidian ≥ 1.11.4)

## Commands

| Command | Description |
|---|---|
| `Pythia: New conversation` | Blank conversation, no context |
| `Pythia: New conversation from template` | Pick a template → loads system prompt + context notes |
| `Pythia: New conversation with current note` | Active note auto-injected as context |
| `Pythia: New conversation from clipboard` | Pre-fills the input with current clipboard text |
| `Pythia: Resume conversation` | Pick a past conversation → choose resume mode |
| `Pythia: Browse conversations` | Fuzzy-search all conversations and open one directly |
| `Pythia: Browse favorites` | Fuzzy-search all starred responses across every conversation and jump to one |
| `Pythia: Save response as note` | Save last response (or selection) as a new vault note |
| `Pythia: Open sidebar` | Open / focus the chat sidebar (right panel) |
| `Pythia: Open in left sidebar` | Open / focus the chat sidebar (left panel) |

### Context menus

- **Editor** — select any text in a note, right-click → **Send to Pythia**: opens a new conversation with the selected text pre-filled in the input.
- **File Explorer** — right-click any file → **Chat about this note**: opens a new conversation with that file injected as a context note.

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
| `obsidian://pythia?action=open` | Open the sidebar (explicit) |
| `obsidian://pythia?action=new` | Create a new blank conversation |
| `obsidian://pythia?action=resume&id=<uuid>` | Open a specific conversation by ID |
| `obsidian://pythia?action=template&name=<name>` | Create a conversation from a named template |

Vault note example:

```markdown
[Open Job Application chat](obsidian://pythia?action=template&name=Job%20Application)
```

## Chat input

| Key | Action |
|---|---|
| `Enter` | Send message |
| `Shift+Enter` | Insert new line |
| `#query` | Fuzzy-search vault notes; `↑↓` to navigate, `↵` to attach, `Esc` to dismiss |

## Context vs. attached notes

- **Context notes** (top of window) — injected into the system prompt on every message for the lifetime of the conversation. Set via template or the `+` button in the Context section.
- **Attached notes** ("Attach note" button) — appended inline to one specific message only, then cleared.

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
| Auto-save summary | `true` | Write summary note on conversation end |
| Default resume mode | `summary` | `full` or `summary` |
| Max messages per session | `100` | Soft cap; 0 = unlimited |
| Debug mode | `false` | Log API calls and payloads to the developer console |
| Allow AI to create notes | `true` | Pass a `create_note` tool to the LLM so it can write vault notes on request |

API keys are stored in Obsidian's native `SecretStorage` API (vault-scoped, never written to `data.json`). The settings tab uses `SecretComponent` to let you select or create a named secret. Only the secret's name (e.g. `pythia-anthropic`) is stored in `data.json` — the value never leaves SecretStorage.

Requires Obsidian ≥ 1.11.4.

## Development

**Requirements:** Node.js, a local Obsidian vault for testing.

```bash
npm install
npm run dev       # watch mode
npm run build     # production build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/pythia/` in your vault, then enable the plugin in Obsidian settings.

## License

MIT
