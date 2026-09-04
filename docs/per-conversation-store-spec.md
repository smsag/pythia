# Per-Conversation Store — Spec

*Status: DRAFT / not implemented — needs sign-off (on-disk format change + migration).*
*Last updated: 2026-09-04. Companion to ADR-122 (batch index writes). Author: Pythia engineering.*

---

## 1. Recommendation

Split conversation persistence out of the single `data.json` into **one file per conversation**
under a `conversations/` subfolder, writing only the conversations that actually changed on each
save. Keep `data.json` for settings + a lightweight conversation manifest. Ship it behind a
`splitConversationStore` flag with an automatic, reversible migration and a one-release bake before
making it the default.

**Why now:** the debounced save already knows exactly which conversations are dirty
(`ConversationStore.dirtyIds`), yet `PluginDataStore.persist()` still rewrites the whole
`data.json` — every conversation, every settings key — on each turn. Cost is O(all conversations),
not O(changed). On a large history this is the dominant local write on the chat send path and the
main driver of the iCloud/Obsidian-Sync watcher churn documented in `watchDataJson()`.

**When to skip:** if a user keeps only a handful of small conversations (the common case), the
current single-file write is already cheap. The flag lets those installs stay on the simple path;
the split only pays off past a few hundred KB of history.

---

## 2. Problem → ICP → JTBD

**Problem.** `persist()` serializes `{ settings, conversations: [ALL] }` and calls `saveData()` on
every debounced save (300 ms after a message mutation) and on every settings change. Write volume
grows linearly with total history even when a single message changed in a single conversation.

**Affected users (ICP).** Power users and RevOps/knowledge-heavy roles who accumulate long
histories (hundreds of conversations, long transcripts) — exactly the users who get the most value
from Pythia and are therefore most exposed to the regression. Mobile (iOS WebKit) users are hit
hardest: larger JSON = slower serialize + slower `saveData` + more sync pressure.

**Jobs-to-be-done.**
- *When I send a message, I want the save to be fast and not stutter the UI*, so long histories stay
  usable.
- *When I sync across devices, I want only what changed to move*, so I avoid large-file conflicts and
  constant re-downloads.
- *When data.json is evicted by iCloud, I want to lose as little as possible*, so a single corrupt or
  cloud-only file can't take my whole history with it.

**Assumption (explicit).** Typical heavy vault: 300–2,000 conversations, p95 conversation ≤ ~40 KB
serialized, total history 5–60 MB. The `maxConversations` eviction cap bounds this but is often set
high. *Not measured in-repo — validate with telemetry before defaulting on (§9).*

---

## 3. Goal & non-goals

**Goal.** Make a save cost proportional to what changed: O(dirty conversations), not O(all).
Preserve every current guarantee — atomicity per file, the iCloud-eviction refusal, the own-write
stamp for the cross-device watcher, `maxConversations` eviction, and malformed-record tolerance.

**Non-goals.**
- No change to the in-memory model (`Conversation` shape, `ConversationStore` ownership).
- No conversation *content* schema change — only where bytes land on disk.
- No new sync engine — we keep relying on the vault adapter + the existing mtime watcher.
- Not a search index (that's the vault RAG index, separate store).

---

## 4. Design

### 4.1 On-disk layout

```
.obsidian/plugins/pythia/
  data.json                     ← settings + manifest ONLY (small, rewritten on any change)
  conversations/
    <id>.json                   ← one conversation per file; written only when dirty
```

`data.json` becomes:

```jsonc
{
  "schema": 2,                   // store-format version (drives migration)
  "settings": { ... },           // unchanged
  "conversationStore": "split",  // "inline" | "split" — self-describing, survives flag flips
  "manifest": [                  // ordering + cheap metadata; NO message bodies
    { "id": "…", "title": "…", "updatedAt": "…", "starred": false }
  ]
}
```

The manifest keeps the sidebar's conversation list renderable without reading every file, preserves
display order, and lets eviction decisions (`maxConversations`, starred-protection) run without
loading bodies. Message bodies live only in the per-conversation files.

### 4.2 Write path (the win)

`persist()` splits into two concerns:

1. **Settings/manifest write** — small `data.json`, rewritten whenever settings change or the
   manifest changes (new/renamed/deleted/reordered conversation, star toggle).
2. **Dirty-conversation writes** — for each id in the `dirtyIds` snapshot, write
   `conversations/<id>.json`; for each deleted id, remove its file. This reuses the existing
   `snapshotDirty()` / `clearDirtySnapshot()` machinery already in `ConversationStore` — the dirty
   set is *already tracked*, it's just not consulted by the writer today.

Both use the same own-write time stamp (`saveDataRecordTime`) so the `watchDataJson` poller keeps
ignoring our own writes. The manifest write and the body writes stamp once around the whole batch.

### 4.3 Read path

- Load `data.json` → settings + manifest.
- Load each `conversations/<id>.json` referenced by the manifest (bounded parallelism, e.g. 8 at a
  time, to avoid a burst of adapter reads on mobile). A file that is missing or malformed is dropped
  with the same `console.warn` + count behaviour as `parseConversations` today; the manifest entry
  is pruned so it self-heals on the next manifest write.
- The iCloud-eviction guard (`shouldRefuseLoad`) now keys off the **manifest**: if `data.json` comes
  back with 0 manifest entries while we hold conversations in memory, refuse the load and keep state
  — same rule as today, evaluated one level up.

### 4.4 Migration (schema 1 → 2)

On load, if `data.json` has no `schema` (or `schema: 1`) and carries an inline `conversations`
array:
1. Parse conversations exactly as today (`parseConversations`).
2. Write each to `conversations/<id>.json`.
3. Write the new `data.json` (schema 2, `conversationStore: "split"`, manifest, `settings`,
   **no** inline `conversations`).
4. Only after all writes succeed, consider migration done. If any body write fails, abort and leave
   the legacy `data.json` untouched (idempotent — retried next load).

**Rollback (schema 2 → 1).** Flipping the flag off (or opening with an older Pythia build) triggers
the reverse: read manifest + bodies, write a single legacy `data.json` with the inline
`conversations` array, and leave the `conversations/` folder in place (harmless orphan; cleaned on
next split migration). This makes the change safe to disable in the field.

`id` is user-controlled only insofar as it's Pythia-generated (UUID-like); still, sanitize to a safe
filename charset and reject path separators when deriving `<id>.json` (see §7).

---

## 5. Work breakdown

### Epic A — Split writer
- **A1** Add `schema`, `conversationStore`, `manifest` to the data model; keep reading legacy shape.
  - *Outcome:* new writes are self-describing; old files still load.
- **A2** Rewrite `persist()` into `writeManifestAndSettings()` + `writeDirtyBodies(snapshot)` +
  `deleteBodies(removedIds)`; drive body writes from the dirty snapshot.
  - *Acceptance:* editing one conversation writes exactly one body file + (if manifest metadata
    changed) one `data.json`; N-1 untouched files are byte-identical (mtime unchanged).
- **A3** Bounded-parallelism reader; malformed/missing body → drop + prune manifest + warn.

### Epic B — Migration & flag
- **B1** `splitConversationStore` setting (default **off** at launch), plumbed to the store.
- **B2** Forward migration (1→2) with all-or-nothing body writes; idempotent retry.
- **B3** Rollback path (2→1) on flag-off / older build; orphan-folder tolerance.

### Epic C — Guards & parity
- **C1** Re-key `shouldRefuseLoad` onto the manifest; unit-test the eviction refusal end-to-end.
- **C2** `maxConversations` eviction operates on the manifest, then deletes the evicted body files.
- **C3** Own-write stamping wraps the whole batch so `watchDataJson` never reload-loops on our writes.

### Epic D — Telemetry & docs
- **D1** `debugLog` counters: bytes written, files written, files skipped per persist.
- **D2** ADR + architecture.md + engineering-review.md updates; this spec → "implemented".

---

## 6. API changes

`ConversationStore` — no signature changes needed; `snapshotDirty`/`clearDirtySnapshot`/`dirtyIds`
already exist and are exactly what the split writer consumes.

`PluginDataStore`:
- `persist()` — internally fans out to manifest + dirty-body writes (public signature unchanged).
- `loadPluginData()` — reads manifest, then bodies; migration branch on `schema`.
- new private: `writeManifest()`, `writeBody(c)`, `deleteBody(id)`, `readBody(id)`, `bodyPath(id)`.
- `persistence.ts` gains pure helpers: `buildManifest(convs)`, `migrateToSplit(...)`,
  `migrateToInline(...)`, and a filename sanitizer — all unit-testable without Obsidian.

Everything routes through `plugin.app.vault.adapter` (already the persistence boundary), so the
whole thing is testable with a fake adapter, mirroring the current fake-store test style.

---

## 7. Non-functional requirements

- **Performance.** Save cost O(dirty) not O(all). Target: a single-message turn writes ≤ one body
  file (+ manifest only if metadata changed). No added latency on the send path beyond the existing
  300 ms debounce.
- **Reliability / atomicity.** Per-file writes are independently atomic; one failed body write can't
  corrupt others or the manifest. Migration is all-or-nothing and idempotent.
- **Data consistency.** Manifest is the source of truth for existence + order; a body without a
  manifest entry is ignored, a manifest entry without a body self-heals (pruned + warned). Never
  block `persist()` (the eviction guard stays on the read path only — same as today).
- **Security.** Derive `<id>.json` through a strict sanitizer (allow `[A-Za-z0-9_-]`, reject `/`,
  `\`, `.`, `..`); never interpolate an id into a path unsanitized (path-traversal defense).
- **Observability.** Per-persist debug counters (bytes/files written/skipped); a one-line warn on
  dropped/malformed bodies with a count, matching today's behaviour.
- **Compatibility.** Desktop + iOS/Android (WebKit); no Node-only APIs on the path
  (`saveData`/adapter only). Bounded read parallelism to protect mobile.
- **Sync-friendliness.** Small per-file diffs reduce large-file conflicts under iCloud/Obsidian Sync;
  the mtime watcher continues to work unchanged (it polls `data.json`; extend it to also notice body
  changes, or rely on the manifest mtime bump — see Risks).

---

## 8. Risks & dependencies

| Risk | Impact | Mitigation |
|---|---|---|
| **Watcher only polls `data.json`** | A body changed on another device without a manifest bump wouldn't trigger reload | Bump the manifest (`updatedAt`) on every body write, so `data.json` mtime always moves; or extend the poller to the `conversations/` folder mtime |
| **Partial migration** (crash mid-write) | Mixed legacy + split state | All-or-nothing: legacy `data.json` only rewritten after all bodies land; idempotent retry on next load |
| **Adapter read burst on load** (many files) | Slow cold start on huge histories / mobile | Bounded parallelism; lazy-load bodies below the fold if needed (later optimization) |
| **Orphan body files** after rollback / eviction races | Wasted disk | Tolerated + swept on next split migration; eviction deletes bodies explicitly |
| **Filename collisions / traversal** | Corruption / security | Strict id sanitizer; reject separators |
| **Behaviour drift vs. current guarantees** | Silent data loss | Parity tests for the eviction guard, own-write stamp, malformed tolerance, `maxConversations` |

**Dependencies:** none external. Builds only on existing `ConversationStore` dirty tracking and the
vault adapter. Independent of ADR-122 (that batched the *index* writes; this batches the
*conversation* writes — same principle, different store).

---

## 9. Rollout

1. **Land behind flag (off).** Ship the writer + migration + rollback; default `inline`. Internal
   dogfood with the flag on.
2. **Telemetry bake (one release).** With the flag on for opt-in users, confirm via `debugLog`
   counters that per-turn writes drop to O(dirty) and cold-start read time is acceptable on a large
   vault. Validate the §2 size assumption against real numbers.
3. **Default on.** Flip default to `split` for new installs; migrate existing installs on next load
   (reversible). Keep the flag for one more release as an escape hatch.
4. **Remove legacy path.** Once split is proven, drop the inline writer (keep the reader + rollback
   for one further release for safety).

Support-readiness: the format is self-describing (`schema` + `conversationStore` in `data.json`), so
a support diagnostic can tell at a glance which store a user is on.

---

## 10. Success metrics

- **North Star:** median bytes written per chat turn. Target: **≫10× reduction** on a large-history
  vault (from "whole file" to "one body").
- **Supporting (leading):** files written per persist (target: 1 + optional manifest); p95 persist
  serialize time; cold-start load time on a 1k-conversation vault.
- **Supporting (lagging):** frequency of `watchDataJson` reload events (should fall with smaller
  diffs); count of iCloud-eviction refusals (should not rise); malformed-body warnings (should be ~0
  after migration).
- **Guardrail:** zero conversation-loss reports attributable to the migration; rollback exercised
  successfully in test.

---

## 11. Next steps

1. Sign-off on the on-disk format (§4.1) and the schema-version + `conversationStore` marker.
2. Implement Epic A behind the `splitConversationStore` flag (default off).
3. Add parity tests (eviction guard, own-write stamp, malformed tolerance, `maxConversations`) + a
   migration round-trip test (1→2→1) against a fake adapter.
4. Wire `debugLog` counters; dogfood with the flag on.
5. Review telemetry after one release; decide on defaulting to `split`.
