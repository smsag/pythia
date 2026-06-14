# Claude Vault Assistant — Plugin Spec

**Version:** 0.1 (MVP)  
**Status:** Draft  
**Author:** Steffen (via Claude co-pilot session)

---

## Problem Statement

Claude Projects provides system prompts, persistent context, and conversation continuity — but lives outside Obsidian. Every session requires manual context transfer. Conversations don't feed back into the PKM. There's no way to attach live vault notes as context without copy-paste.

**Expected outcome:** A native Obsidian plugin that replicates the Claude Projects workflow inside the vault — with templates, context injection, conversation storage, and output capture — so that Claude sessions become first-class vault objects.

---

## User Stories

| ID | As a… | I want to… | So that… |
|----|--------|-----------|----------|
| US-1 | Vault user | Start a Claude conversation from the Befehlspalette | I never leave Obsidian |
| US-2 | Vault user | Start a conversation with the active note as context | I skip manual copy-paste |
| US-3 | Vault user | Use a template to pre-load system prompt + context notes | Every job application / gate artifact starts consistently |
| US-4 | Vault user | Resume a past conversation | I continue work across sessions |
| US-5 | Vault user | Choose per conversation whether to resume with full history or summary | I control token cost vs. fidelity |
| US-6 | Vault user | Save Claude's output as a new vault note | Artifacts land directly in my PKM |
| US-7 | Vault user | Search past conversations in Obsidian | My Claude sessions are part of my knowledge graph |

---

## Scenarios

### Scenario 1 — Job Application
1. Befehlspalette → `Claude: New conversation from template` → select "Job Application"
2. Plugin loads system prompt + auto-attaches CV note, Reason-Why note, Proof Points note
3. User pastes job description into chat
4. Iterates with Claude in sidebar
5. Claude drafts application → user clicks "Save as note" → saved to `/Applications/2026-05-07-Accenture-TPO.md`
6. Conversation summary saved to `/Claude/Conversations/2026-05-07-Accenture-TPO.md`

### Scenario 2 — Gate Artifact Drafting
1. Befehlspalette → `Claude: New conversation from template` → select "Lighthouse Discovery"
2. System prompt + architecture notes auto-loaded
3. User describes feature → Claude drafts Vision Prototype section
4. Output saved to `/Propstack/Gate-Artifacts/`

### Scenario 3 — Ad-hoc with active note
1. Befehlspalette → `Claude: New conversation with current note`
2. Active note injected as context automatically
3. One-off question answered in sidebar
4. Optionally saved to `/Claude/Scratch/`

### Scenario 4 — Resume conversation
1. Befehlspalette → `Claude: Resume conversation` → SuggestModal lists past conversations
2. User selects conversation → chooses resume mode:
   - **Full history** — all messages re-sent (accurate, higher token cost)
   - **Summary** — Claude-generated summary sent as context, new messages appended
3. Sidebar opens, conversation continues

---

## Befehlspalette Commands

| Command | Behavior |
|---------|----------|
| `Claude: New conversation` | Blank conversation, no context, opens sidebar |
| `Claude: New conversation from template` | SuggestModal → template picker → loads system prompt + context notes |
| `Claude: New conversation with current note` | Auto-injects active note as context, opens sidebar |
| `Claude: Resume conversation` | SuggestModal → conversation picker → resume mode selector |
| `Claude: Save response as note` | Saves last Claude response (or selection) as new vault note |
| `Claude: Open sidebar` | Opens/focuses the sidebar panel |

---

## UI Architecture

### Sidebar Panel (`ItemView`)

```
┌─────────────────────────────┐
│ 🤖 Claude Vault Assistant   │
│ [Conversation name        ▾]│  ← dropdown / click to switch
│ ─────────────────────────── │
│ Context: CV.md, Reason-Why  │  ← attached notes, click to edit
│ Template: Job Application   │
│ ─────────────────────────── │
│                             │
│  Claude: Here's a draft...  │
│                             │
│  You: Can you shorten...    │
│                             │
│ ─────────────────────────── │
│ [          message        ] │
│ [Attach note] [Send] [Save] │
└─────────────────────────────┘
```

**Key interactions:**
- Conversation name → click to rename or switch via SuggestModal
- Context pills → click to remove, "+" to add vault note
- "Save" button → saves selected text or last response as new note
- Streaming responses rendered in real time
- Markdown rendered in message bubbles

---

## Data Model

### Conversation (stored in plugin data — `data.json`)

```typescript
interface Conversation {
  id: string;                    // uuid
  name: string;                  // user-defined
  createdAt: string;             // ISO 8601
  updatedAt: string;
  templateId?: string;           // ref to template if used
  systemPrompt: string;          // resolved at creation time
  contextNotes: string[];        // vault paths attached
  resumeMode: 'full' | 'summary'; // per-conversation choice
  summaryNote?: string;          // vault path to summary note
  messages: Message[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachedNotes?: string[];      // notes attached to this specific message
}
```

### Template (markdown note with frontmatter)

```markdown
---
claude_template: true
name: Job Application
model: claude-sonnet-4-6
max_tokens: 4000
context_notes:
  - CV/Steffen-CV.md
  - Freelance/Reason-Why.md
  - Freelance/Proof-Points.md
resume_mode: summary
output_folder: Applications
---

You are helping Steffen write job applications for senior TPO/PM roles
in the DACH B2B SaaS market. Always write in German unless asked otherwise.
Structure: Einstieg → Warum ich → Warum diese Stelle → Abschluss.
Tone: direct, confident, no Floskeln.
```

Templates live in a configurable folder (default: `/Claude/Templates/`).  
Plugin discovers templates by scanning for `claude_template: true` in frontmatter.

### Summary Note (vault markdown — for PKM searchability)

```markdown
---
type: claude-conversation
template: Job Application
created: 2026-05-07
context_notes:
  - CV/Steffen-CV.md
tags: [claude, job-application]
---

## Summary
Claude helped draft a job application for the Accenture Senior TPO role.
Key decisions: led with Hamburg Messe portfolio redesign as anchor proof point.

## Output
[[Applications/2026-05-07-Accenture-TPO]]

## Conversation excerpt
...
```

---

## API Integration

### Model
`claude-sonnet-4-6` (configurable per template or globally in settings)

### Context injection strategy

At conversation start, plugin assembles the system prompt as:

```
<system_prompt>
{template system prompt or blank}
</system_prompt>

<context>
{contents of each attached note, labelled by filename}
</context>
```

Context notes are read fresh at conversation start — not cached — so updates to vault notes are picked up automatically.

### Streaming
Use Anthropic SDK streaming (`stream()`) → render tokens into sidebar as they arrive.

### Resume modes

**Full history:**
```
messages: [...allPreviousMessages, newUserMessage]
```

**Summary:**
```
system: "{original system prompt}\n\n<previous_conversation_summary>\n{summary}\n</previous_conversation_summary>"
messages: [newUserMessage]
```

Summary is generated by calling Claude with a summarization prompt at conversation end (or on-demand before resuming).

---

## Plugin Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Anthropic API key | — | Required |
| Default model | `claude-sonnet-4-6` | Used when template doesn't specify |
| Templates folder | `/Claude/Templates/` | Where plugin scans for templates |
| Conversations folder | `/Claude/Conversations/` | Where summary notes are saved |
| Scratch folder | `/Claude/Scratch/` | For ad-hoc conversations |
| Auto-save summary | `true` | Save summary note on conversation end |
| Default resume mode | `summary` | Overridden per conversation |

---

## File Structure (vault)

```
vault/
├── Claude/
│   ├── Templates/
│   │   ├── Job Application.md
│   │   ├── Lighthouse Discovery.md
│   │   └── Proposal Draft.md
│   ├── Conversations/
│   │   └── 2026-05-07-Accenture-TPO.md   ← summary note
│   └── Scratch/
│       └── 2026-05-07-quick-question.md
├── Applications/
│   └── 2026-05-07-Accenture-TPO.md        ← saved output
```

---

## Plugin File Structure

```
claude-vault-assistant/
├── main.ts                  # Plugin entry point, command registration
├── sidebar.ts               # ItemView sidebar panel
├── suggest/
│   ├── ConversationSuggest.ts   # SuggestModal for conversations
│   └── TemplateSuggest.ts       # SuggestModal for templates
├── services/
│   ├── AnthropicService.ts      # API calls, streaming
│   ├── ConversationStore.ts     # Load/save from plugin data.json
│   ├── TemplateLoader.ts        # Scan vault for templates
│   └── NoteWriter.ts            # Save outputs/summaries to vault
├── models/
│   └── types.ts                 # Conversation, Message, Template interfaces
├── settings.ts              # Settings tab
├── manifest.json
└── package.json
```

---

## MVP Scope vs. Later

### MVP (Now)
- Befehlspalette commands (all 6)
- Sidebar panel with streaming chat
- Template system (frontmatter-driven)
- Context note attachment (manual + template-defined)
- Conversation storage (plugin data + summary note)
- Resume modes (full / summary), per conversation
- Save response as vault note

### Next
- Active note auto-inject as toggle in settings
- Conversation search via Obsidian search index (tags on summary notes)
- Token usage display in sidebar
- Inline note picker (`[[` syntax inside message input)

### Later
- Multi-turn context from Dataview queries
- MCP server integration (vault as context for external agents)
- Mobile (Obsidian mobile API parity check needed)

---

## Non-Functional Requirements

| Concern | Requirement |
|---------|-------------|
| Performance | Context note loading < 500ms; streaming first token < 2s |
| Security | API key stored in Obsidian's secure storage (`app.vault.adapter` / keytar), never in `data.json` |
| Reliability | Graceful error handling on API failure; partial responses preserved |
| Data safety | No conversation data leaves device except Anthropic API calls |
| Observability | Console logging for API calls (debug mode toggle in settings) |
| Compatibility | Obsidian 1.4+, desktop only for MVP (mobile later) |

---

## Open Decisions

| # | Decision | Default assumption |
|---|----------|--------------------|
| 1 | Summary note format | Claude-generated prose summary + output link |
| 2 | Token limit handling | Warn user if context exceeds model limit; truncate oldest notes first |
| 3 | Conversation naming | Auto-named by date + template; user can rename inline |
| 4 | Multi-vault support | Out of scope for MVP |