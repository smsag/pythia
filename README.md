# Pythia

An [Obsidian](https://obsidian.md) plugin that brings AI conversations (Anthropic and OpenAI) into your vault as first-class objects — with templates, context injection, streaming chat, and PKM-native storage.

## Features

- **Command palette workflows** — start, resume, and manage AI conversations without leaving Obsidian
- **Template system** — define system prompts and auto-attached context notes in vault markdown files (frontmatter-driven)
- **Context injection** — attach any vault note as context for a conversation, manually or via template
- **Streaming chat** — responses rendered token-by-token in the sidebar panel
- **Conversation storage** — full history saved in `data.json`; optional summary notes written to your vault
- **Resume modes** — continue past conversations with full message history or an AI-generated summary (controls token cost)
- **Save output** — write any response directly to a new vault note
- **Multi-provider** — supports Anthropic (Claude) and OpenAI models, switchable per conversation

## Commands

| Command | Description |
|---|---|
| `Pythia: New conversation` | Blank conversation, no context |
| `Pythia: New conversation from template` | Pick a template → loads system prompt + context notes |
| `Pythia: New conversation with current note` | Active note auto-injected as context |
| `Pythia: Resume conversation` | Pick a past conversation → choose resume mode |
| `Pythia: Save response as note` | Save last response (or selection) as a new vault note |
| `Pythia: Open sidebar` | Open / focus the chat sidebar |

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
