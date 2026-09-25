# <img src="assets/logo.svg" alt="" width="28"> Pythia

An [Obsidian](https://obsidian.md) plugin that brings AI conversations (Anthropic, OpenAI and Mistral) into your vault as first-class objects — with templates, context injection, streaming chat, summaries, and PKM-native storage.

## Features

- **Command palette workflows** — start, resume, and manage AI conversations without leaving Obsidian
- **Template system** — define system prompts in vault markdown files (frontmatter-driven)
- **Streaming chat** — responses rendered token-by-token in the sidebar panel
- **Turn labels** — a compact meta line above every turn: the model that answered, the time, and the token counts. When a conversation runs on a template, the template name appears on the answer it first shaped — and again if a different template takes over later — so you can see which prompt produced which response
- **Conversation storage** — full history saved in `data.json`; conversations are automatically given a short AI-generated title after the first exchange; optional summary notes written to your vault
- **History limit, without losing anything** — Pythia keeps up to 450 conversations by default (leave the field empty for no limit). When the limit is reached the oldest are removed — but **archived to a vault note first**, with the whole transcript and queryable frontmatter, and a conversation whose note cannot be written is kept rather than deleted. Conversations with a starred passage, the one you have open, and any a merge link points at are never removed. The delete dialog offers the same **Archive** beside **Delete**, and the settings show how large `data.json` has grown
- **Summaries** — press and hold the **Send** button for the summary menu: *Summarize conversation* writes an AI summary and a new title in one step, *Summarize favorites* distils the starred passages into key learnings. Summaries appear as collapsible cards at the top of the message list, each with the time it was generated, and scroll with the conversation
- **Resume modes** — continue past conversations with the full message history, an AI-generated summary, or a hybrid of summary plus recent messages (controls token cost)
- **Favorites** — star any assistant response; a short AI-generated title is assigned automatically; starred messages are accessible via the `#` chapter navigator
- **Fork conversation** — select any text in a response, then press **Fork** in the action strip to branch the conversation: a new conversation inherits the same system prompt and template, starts empty, and shows a banner linking back to the source with its summary. Clicking the banner link reopens the source conversation and scrolls silently to the exact message that was forked from. On the source side, the branch preview marks its summary as outdated when the fork has moved on, and a ↻ button regenerates it in one tap
- **Merge conversation** — the inverse of Fork. Select any text in a response, press **Merge** in the action strip, then search and pick an existing conversation. The passage is underlined and tapping it opens that conversation's summary right where you are reading, with a ↻ to regenerate it and a link to open the conversation itself; its summary is generated on the spot if it does not have one yet. The link reads from both ends: the conversation you merged with shows a banner naming every conversation that points at it. A merge changes nothing about what the model sees, so linking costs no tokens
- **Forks navigator** — the `#` chapter navigator shows a **Forks** section at the top when the active conversation has child forks, making it easy to jump to any branch
- **`#` Chapter navigator** — the `#` button at the bottom-right of the message area opens a popover listing all starred messages and user turns for quick scroll navigation
- **Delete last exchange** — long-press (450 ms) on the last user bubble to delete the most recent prompt + response pair (only the last exchange; a confirmation step is shown before deletion)
- **Compare models** — the same long-press offers **⇄ Compare**: pick another model and the last prompt is re-run on it, sequentially, into a comparison card with one tab per model (model, time, token counts). Add as many models as you like, then **Keep this answer** on the tab you prefer: it becomes the conversation's answer, and every other tab is saved as a fork named `<conversation> · <Model>` so nothing is lost and the alternatives stay reachable from the `#` navigator's Forks section. Sending is paused until you keep one (or discard the comparison, which restores the original answer). Note-writing tools are withheld during a comparison run; web search stays available in research mode
- **Cut-off answers recover** — when a reply stops at the token limit, a card under it says so and offers **→ Continue**, **↑ Retry with** a doubled limit, or **⇄ Compare** with another model. The conversation settings warn before it happens: switch a conversation onto a reasoning model with a low token limit and the modal offers the fix in one tap; model rows show speed · depth · cost at a glance
- **Reference row** — a compact pill strip that auto-appears when a conversation has associated vault files (context notes, saved notes, summary notes); each pill shows an estimated token count; click a pill to open the file, × to remove it from context or delete it from the vault
- **Cost per answer** — every answer's label shows the token counts and an estimated price (`↑1.628 ↓941 · ≈ $0.012`), priced from list prices pulled from [models.dev](https://models.dev) and refreshed with each release; the conversation panel shows a running total per conversation. Each answer keeps the price it had when it was generated. An estimate, not a bill — your provider's invoice is authoritative. Off by default; switch it on under *Show cost per answer*
- **Charts you can paste into a document** — when an answer turns on a handful of comparable numbers, Pythia draws a **bar, line or pie chart** inline instead of writing out a table. Two controls on the chart: **copy as image** puts a PNG on the clipboard, so it pastes straight into Word, Google Docs, Slides or Notion as a picture; **copy source** gives the chart's block, which pastes back into a note and draws there too. Charts follow your theme (light and dark), and every series colour is checked for contrast. A chart built from web research names the sources its numbers came from, under the chart. Ask for one in words ("chart that") or just let Pythia decide — and if you want the table alongside it, say so: an explicit request wins over the default
- **Wide content pans** — code blocks, Mermaid diagrams and markdown tables are clipped to the chat width instead of squeezing; click-and-drag (macOS mouse) or swipe (iOS touch / trackpad) to pan horizontally. Table cells wrap between words and are never broken mid-word
- **Save output** — write any response directly to a new vault note
- **Selection action strip** — select any text in the chat to reveal a fixed action bar above the input: **Copy**, **Insert into note**, **Save to inbox**, **Fork**
- **Inbox** — "Save to inbox" prepends the selection with a timestamp to a configurable inbox note
- **AI note creation** — ask Pythia to create, update, or rewrite a vault note; a confirm chip appears before any write so you can approve or cancel, and a clickable link confirms the result
- **`#` note picker** — type `#` in the chat input to fuzzy-search all vault notes and attach one inline, just like VS Code's `#` file picker. The note stays where you put it as a chip — the library icon and its name — so you can see what you attached while you write; one Backspace removes it and detaches the note, and undo brings both back. It goes out with the message as an Obsidian `[[link]]` and renders there as a link you can open
- **Drag notes into the prompt** — drag a note, several notes or a whole folder from the file explorer, search, a tab or a link onto the chat input: each lands as a chip where you drop it and is attached, exactly as if you had picked it with `#`. Hold ⇧ (macOS) or Alt (Windows/Linux) while dropping to open the note in the tab instead, as anywhere in Obsidian
- **Vault context (semantic RAG)** — toggle the **library icon** in the input toolbar to let Pythia automatically pull the most semantically relevant notes from your **whole vault** into every message, without hand-picking them. It's a per-conversation switch (like the web-search globe). Uses the same on-device embedding model as "related conversations" (nothing leaves your machine). Retrieved notes are excerpted to their own, tighter budget and are **cited** in the answer, and each turn's auto-pulled notes show as distinct read-only pills in the reference row. Keep a note out of the index entirely with `pythia: false` in its frontmatter. Off by default (a Command Palette command sets the default for new conversations).
- **Glossary** — select a term or a name in an answer and press **Define** (or **Person**): Pythia writes a short definition for the sense used there into a note of its own in the glossary folder, and marks the term in every conversation from then on. Tap a marked term to read the definition in place. It is shown in the conversation's language — a definition first written in German reads in English in an English conversation; the translation is made once and kept in the term note as `definition_en`, so it syncs and can be corrected by hand
- **Multi-provider** — Anthropic (Claude), OpenAI and Mistral, switchable per conversation and per template
- **Answer instructions in the header** — the header shows what every answer is sent with: `Sonnet 5 | Hoch | DE` — the model, the reasoning effort, and the language the model is told to write in (`AUTO` when it just follows the language you write in). Tap any of the three to change it for this conversation; each option explains itself in one line. A tinted value is set for this conversation, a plain one follows the plugin settings, and **Standard** returns it to them. Rename, copy link and conversation settings sit in the **⌄** menu next to it
- **Context menus** — right-click any file in the Explorer to open a conversation about that note; right-click a folder to combine all its notes as context; right-click selected text in the editor to send it to Pythia
- **Browse conversations** — open any past conversation directly from the Command Palette, no resume-mode step
- **Search conversations** — the loupe in the header opens the conversation panel with its search box focused: an empty box browses by date, a query ranks every conversation by its title, summary and messages, with the matching line under each hit. Partial words work as you type, and so do German compounds — searching *Vertrag* finds a conversation about your *Mietvertrag*. When a search comes back almost empty, Pythia also looks at the notes each conversation attached or cited and tells you it did: the extra results sit under **ALSO IN NOTES**, each one saying which note put it there. Type `note:` to search only those notes, `all:` for everything, or `conv:` to stay in the conversations — the same syntax works in the Command Palette's *Browse conversations*
- **Related conversations** — the ⇄ icon on any row in the conversation panel (or a long-press on touch) finds conversations that are semantically close to it, using the same on-device embedding model as vault context. Nothing is sent anywhere, and the similarity threshold is measured per model rather than guessed — *strict* / *balanced* / *loose* in the settings
- **Web search** — toggle the globe in the input toolbar and the model can look up current information through [Tavily](https://tavily.com) (your own API key). Results are cited in the answer with the domain they came from
- **Prompt optimizer** — *New conversation from prompt* (in `Pythia: Commands…`) rewrites a rough prompt before you send it; the same is available inline from the Send menu for what you have already typed. Optionally framed as CO-STAR, RACE or RISEN. Inline, it can also **suggest a model**: it rates how demanding the task is and offers the cheapest model of your default provider that can handle it, as a chip beside Send (`→ GPT-5.4 mini ●○○`). Tap to use it for the next answer only; your conversation keeps its model
- **Delete conversation** — remove any conversation via the sidebar trash button or the Command Palette. The dialog offers **Archive** (write it to a note, then remove it) beside **Delete**
- **Browse favorites** — fuzzy-search all starred responses across every conversation and jump directly to one from the Command Palette
- **Deep-link URIs** — open, create, or resume conversations via `obsidian://pythia` links from anywhere
- **Mobile-compatible** — works on Obsidian for iOS and Android (requires Obsidian ≥ 1.4.0)

## Commands

| Command | Description |
|---|---|
| `Pythia: New conversation` | Blank conversation, no context |
| `Pythia: Resume conversation` | Pick a past conversation → choose resume mode |
| `Pythia: Commands…` | The command hub — everything below, searchable in one dialog |
| `Pythia: Summarize favorites` | Synthesize the conversation's starred passages into key learnings |
| `Pythia: Send selection to Pythia` | Editor selection → new conversation, pre-filled |
| `Pythia: Send selection to Pythia with template` | The same, choosing a template first |
| `Pythia: Toggle vault context default (semantic RAG)` | Turn the vault-context **default** on/off for new conversations (the per-conversation toggle lives on the input toolbar) |
| `Pythia: Rebuild vault context index` | Wipe and rebuild the semantic index in the background (e.g. after changing indexed folders) |

The sidebar is opened from the ribbon icon (or any `obsidian://pythia` link) — there is no separate command for it.

### `Pythia: Commands…`

One palette entry rather than ten: *New conversation from template · with current note · from clipboard · from prompt · Browse conversations · Browse favorites · Summarize favorites · Reload conversations from disk*. Each row explains itself, and the dialog is searchable.

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
model: claude-sonnet-5
max_tokens: 8000
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
| `provider` | no | `anthropic`, `openai` or `mistral` — overrides the default provider |
| `model` | no | Model ID (e.g. `claude-sonnet-5`) — overrides the default |
| `max_tokens` | no | Output-token limit override (default: 8192, or 16384 on reasoning models) |
| `context_notes` | no | Vault paths of notes always attached as context |
| `resume_mode` | no | `full` (entire history), `summary` (condensed) or `hybrid` (summary + recent messages) — controls token cost on long conversations |
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
| `Cmd/Ctrl + Shift + N` | `Pythia: New conversation` |
| `Cmd/Ctrl + Shift + R` | `Pythia: Resume conversation` |
| `Cmd/Ctrl + Shift + P` | `Pythia: Commands…` |

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
| `Enter` | Insert a line break |
| `Cmd/Ctrl+Enter` | Send message |
| `#query` | Fuzzy-search vault notes; `↑↓` to navigate, `↵` to attach, `Esc` to dismiss |

The composer holds a prompt, not a chat line, so `Enter` writes a line break and sending takes a modifier — a stray line break costs nothing, a stray send costs an answer you have to delete. The **Send** button does the same thing and is the primary send on mobile, where there is no modifier key.

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
- **Off the UI thread & non-blocking** — embedding runs in a background Web Worker (with a fallback that stays responsive via cooperative throttling), and the index is built/refreshed in the background with a live progress notice. Which backend actually started is no longer a guess: the vault-index status line in Settings names it, and says why the others did not start. A chat turn only ranks against the ready index (embedding just your question), so replies are never delayed and Obsidian stays responsive while indexing. The first turn(s) right after enabling won't use vault context yet — later turns pull in relevant notes automatically.
- **Scoped to the folders you choose** — set **Folders to index** in Settings (one path per line; empty = whole vault). Scoping keeps the on-device index small and fast on large vaults.
- **Scales safely** — notes are embedded in small padded batches during indexing, which keeps the runtime's memory from growing with every differently-sized chunk, so even a very large vault won't exhaust memory. A build also **saves as it goes**: if Obsidian is closed or the build is interrupted, the next one resumes rather than starting over. A **Max notes to index** cap (default 5,000; Settings) guards against runaway indexes on huge vaults — if you exceed it you're told to scope to folders (or raise the cap) rather than silently missing notes.
- **Kept fresh, cheaply** — a debounced watcher updates the index note-by-note as you edit: a single edit re-embeds just that one note (not a whole-vault rescan), so keeping the index current is nearly free even on large vaults. Force a full rebuild any time with **Settings → Rebuild index** or the `Rebuild vault context index` command.
- **Cited, visible & bounded** — long notes are excerpted to the most relevant sections and appear as numbered **citations** in the response, like notes you attach by hand. But an auto-retrieved note is *not* treated as one you attached: it gets a tighter excerpt budget of its own, so five of them cannot quietly add thousands of tokens to every turn, and the attached-note warnings stay about notes you actually chose. Each turn's auto-retrieved notes surface as distinct read-only pills in the reference row, so you can see what was pulled in.
- **Per-note opt-out** — put `pythia: false` in a note's frontmatter and it is never indexed or retrieved, wherever it sits. Only an explicit `false` counts, so the `pythia:` resume link Pythia writes into a saved conversation note (below) does not opt anything out. The check is re-applied when a note would be sent, so excluding a note on one device takes effect on the others without a rebuild.
- **Scoped** — Pythia's own `Conversations/` and `Scratch/` folders are excluded so saved chats aren't fed back in, and notes you already attached manually are never duplicated. The `Archive/` folder is *not* excluded today, so archived conversations are indexed like any other note — scope **Folders to index** if you would rather they were not.

Tuning lives in the settings tab: the embedding model, the folders to index, how many notes are pulled per turn (default 5), the index cap, and a **Rebuild index** button. `vaultContextSimilarity` (`strict` / `balanced` / `loose`) is still `data.json`-only.

## Vault Structure

```
vault/
├── Pythia/
│   ├── Templates/       ← your template notes
│   ├── Conversations/   ← auto-saved conversation summary notes
│   ├── Archive/         ← conversations archived before the history limit removes them
│   └── Scratch/         ← ad-hoc conversation notes
└── Glossary/
    ├── Terms/           ← one note per defined term
    ├── People/          ← one note per person
    └── Themes/          ← theme notes the entries link to
```

## Settings

**Providers**

| Setting | Default | Description |
|---|---|---|
| Anthropic / OpenAI / Mistral API key | — | Secret name in Obsidian's native SecretStorage |
| Tavily API key | — | Enables the `web_search` tool |
| Default provider | `anthropic` | `anthropic`, `openai` or `mistral` |
| Default Anthropic model | `claude-sonnet-5` | Overridden per template and per conversation |
| Default OpenAI model | `gpt-5.4-mini` | " |
| Default Mistral model | `mistral-large-latest` | " |

**Answers**

| Setting | Default | Description |
|---|---|---|
| Language | Language of the conversation | What Pythia answers in — chat replies and every generated text (titles, summaries, definitions). Follow Obsidian's UI language, or pick one of DE / EN / IT / ES. Overridable per conversation |
| Max tokens | `8192` | Output-token limit (16384 on reasoning models). A cut-off answer says so and offers Continue / Retry with a raised limit |
| Temperature | `0.7` | Sampling temperature, where the model supports one |
| Effort | `high` | Reasoning effort, where the model supports one |
| Custom instructions | — | Appended to every system prompt |
| Show cost per answer | `false` | Estimated price on each turn label and a running total per conversation |

**Vault**

| Setting | Default | Description |
|---|---|---|
| Templates folder | `Pythia/Templates` | Scanned for `type: Pythia Prompt Template` |
| Conversations folder | `Pythia/Conversations` | Where summary notes are saved |
| Scratch folder | `Pythia/Scratch` | For ad-hoc conversations |
| Inbox note | `Pythia/Inbox.md` | Target for "Save to inbox" — selections are prepended with a timestamp |
| Glossary folder | `Glossary` | `Terms/`, `People/` and `Themes/` live under it |
| Max attached-note tokens | `8000` | Attached notes beyond this are excerpted to their most relevant sections |

**Storage**

| Setting | Default | Description |
|---|---|---|
| Default resume mode | `full` | `full`, `summary` or `hybrid` |
| Message cap per session | `100` | Further sends are blocked past it; leave empty for no limit |
| Conversation history limit | `450` | Oldest conversations are removed past it; leave empty for no limit. The line beneath it shows how large `data.json` has grown |
| Archive before deleting | `true` | Write a conversation to a note before the limit removes it. A conversation whose note cannot be written is kept |
| Archive folder | `Pythia/Archive` | One note per archived conversation, with the full transcript |

**Search & retrieval**

| Setting | Default | Description |
|---|---|---|
| Embedding model | on-device | Shared by vault context and related conversations; nothing leaves the machine |
| Related-conversation similarity | `balanced` | `strict` / `balanced` / `loose` — measured per embedding model |
| Vault context | `false` | Default for new conversations (per-conversation toggle on the input toolbar) |
| Folders to index | whole vault | One path per line |
| Notes per turn / max indexed notes | `5` / `5000` | Caps on retrieval and on index size |
| Web search default / auto-arm / results | `false` / `true` / `5` | Web-search behaviour for new conversations |

**Other**

| Setting | Default | Description |
|---|---|---|
| Prompt optimizer template / framework | — / `none` | Template used by the optimizer; `CO-STAR`, `RACE` or `RISEN` |
| Suggest a model | on | The inline optimizer also suggests the cheapest adequate model of the default provider, for one answer |
| Debug mode | `false` | Log API calls and payloads to the developer console |

API keys are stored in Obsidian's native `SecretStorage` API (vault-scoped, never written to `data.json`). The settings tab uses `SecretComponent` to let you select or create a named secret. Only the secret's name (e.g. `pythia-anthropic`) is stored in `data.json` — the value never leaves SecretStorage.

Requires Obsidian ≥ 1.4.0.

## Data & Privacy

Pythia sends data to third-party AI providers **only** when you actively use the chat. No data is collected, shared, or transmitted in any other way.

**What is sent externally:**

| Data | Sent to | When |
|---|---|---|
| Your chat messages and attached note content | Anthropic, OpenAI or Mistral (whichever provider you select) | On every message you send |
| System prompt and context notes | Same provider | On every message you send |
| Search queries the model chooses to run | [Tavily](https://tavily.com) | Only while web search is switched on for that conversation |

**What stays local:**

- All conversation history is stored in your vault's `data.json` file — it never leaves your device except as part of the API calls above.
- API keys are stored in Obsidian's native `SecretStorage` (vault-scoped encryption). They are never written to `data.json` or transmitted anywhere beyond the respective provider's SDK.
- **Embeddings are computed on your device.** Vault context and related conversations run a local model; no note or conversation text is sent anywhere for them.
- Archived conversations are plain notes in your vault.
- Pythia has no telemetry, analytics, or crash reporting.

**Provider privacy policies:**

- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Mistral Privacy Policy](https://mistral.ai/terms/#privacy-policy)
- [Tavily Privacy Policy](https://tavily.com/privacy) — only if you enable web search

You are responsible for reviewing those policies and ensuring your usage complies with any applicable data-handling requirements.

## Development

**Requirements:** Node.js, a local Obsidian vault for testing.

```bash
npm install
npm run dev              # watch mode
npm run build            # typecheck + production build
npm test                 # Vitest unit tests
npm run lint             # ESLint
npm run check:filesize   # per-file line budget (ADR-097)
```

The four checks CI runs are `lint`, `check:filesize`, `build` and `test` — the same ones you run locally.

Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/pythia/` in your vault, then enable the plugin in Obsidian settings.

## License

MIT — see [LICENSE](LICENSE).
