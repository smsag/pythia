# Term notes of the glossary

Pythia (Obsidian) writes its glossary as one note per term; Nimbus (a native macOS/iOS app on the same vault) drills
those notes as flashcards. Nimbus never calls Pythia and Pythia never reads what Nimbus keeps: the term note is the
only thing they share. This document is the note's contract for its readers; `glossary-cases.json` holds the examples
both test suites run (Pythia: `tests/glossaryContract.test.ts` against its writer and reader, Nimbus:
`GlossaryContractTests` against `GlossaryTerm`). Both repositories hold the same two files (Pythia in `contracts/`,
Nimbus in `Contracts/`). A change here is a change in both apps.

Pythia's own decisions behind the format are ADR-149 and ADR-150 in its `docs/decisions.md`.

## 1. Which notes

A note is a term note when its frontmatter has `type` with the string value `term`. Pythia also writes `type: person`
and `type: theme` into the same folder; neither is a term. A note without frontmatter is no term note. Where the note
lies does not matter to a reader (Pythia's folder is `<glossary>/Terms/`, configurable).

## 2. The term

The frontmatter `term` when it is a non-empty string (trimmed), else the file name without `.md`. Pythia writes `term`
only when the term holds a character no file name can (`C#`, `A/B testing`).

Other properties Pythia writes (`aliases`, `theme` as `[[links]]`, `term_<lang>`, `definition_<lang>`,
`translated_from`, `language`, `source`, `updated`, `model`) are not part of this contract: a reader may use them, and
a writer may add properties without telling.

## 3. The body

After the frontmatter, lines split at `\n` (Pythia writes LF; a reader may also accept CRLF):

1. **Discussion:** the first line that, trimmed, matches `^##\s+Discussion\s*$` (any case) and everything after it are
   the discussion – prose of the user's, never part of definition or contexts, whatever it contains.
2. **Contexts:** every line before it that matches `^>\s?(.*)$` (the `>` in column 0) is a context: the passage the
   term was met in, the captured text trimmed. Empty ones are skipped. The first is the one a flashcard shows.
3. **Definition:** every other line before the discussion, joined with `\n` and trimmed – also a line after a context.
   It may be empty: then the note is a term without a definition (Nimbus makes no card of it and says so).

A writer renders an entry as the definition (trimmed), then each context as `> ` plus the text with line breaks
replaced by spaces, then `## Discussion`, an empty line and the discussion; the parts separated by one empty line,
the body ending in one `\n` (`writes` in the cases). So whatever it writes reads back unchanged.

## 4. Versions

There is no version field in a note. A change to sections 1–3 is made in both repositories in one step, with the
cases; `glossary-cases.json` carries `version`, raised with every such change.
