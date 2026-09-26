// Vault context: which notes a turn draws in, found by Schreibstube's search by
// meaning (ADR-116, ADR-224). Merged into the table by `en.ts`, so `t()` and the
// `Strings` type are unchanged. `vaultContext.de.ts` must name the same keys.

const vaultContextEn = {
	vaultContextSectionName:      "Vault context",
	vaultContextIntro:            "With vault context on, each message you send is matched against your notes by meaning, and the closest ones are added to the prompt so the answer can draw on them. The matching is done on this device by Schreibstube's search by meaning; Pythia no longer runs a model of its own. A note with pythia: false in its properties is never added.",
	vaultContextSourceName:       "Search by meaning",
	vaultContextSourceReady:      "Schreibstube is installed and its search by meaning is on: vault context and related conversations work.",
	vaultContextNeedsSchreibstube: "Vault context on — but it needs Schreibstube with Search by meaning switched on to find notes. Until then, messages go out with the notes you attach.",
	vaultContextSourceMissing:    "Not available. Vault context and related conversations need Schreibstube with Search by meaning switched on; without it, messages go out with the notes you attach, and the conversation search looks at titles.",
	vaultContextEnabledName:      "Enable by default",
	vaultContextEnabledDesc:      "Add relevant vault notes to new conversations. Also toggle per conversation from the input toolbar (library icon).",
	vaultContextFoldersName:      "Folders to draw from",
	vaultContextFoldersDesc:      "One folder path per line; only notes inside them are added (leave empty for the whole vault). Pythia's own conversation and scratch folders are never used.",
	vaultContextNotesPerTurnName: "Notes per answer",
	vaultContextNotesPerTurnDesc: "How many relevant notes are added to a message as context. More notes cost more tokens and can bury your actual question.",
};

export default vaultContextEn;
