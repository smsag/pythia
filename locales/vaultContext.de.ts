// German for `vaultContext.en.ts` — same keys, enforced by the type (ADR-199).

import type vaultContextEn from "./vaultContext.en";

const vaultContextDe: typeof vaultContextEn = {
	vaultContextSectionName:      "Vault-Kontext",
	vaultContextIntro:            "Mit Vault-Kontext wird jede Nachricht nach Bedeutung mit deinen Notizen abgeglichen, und die passendsten werden dem Prompt beigelegt, damit die Antwort darauf zurückgreifen kann. Den Abgleich macht Schreibstubes Suche nach Bedeutung auf diesem Gerät; Pythia lädt kein eigenes Modell mehr. Eine Notiz mit pythia: false in den Eigenschaften wird nie beigelegt.",
	vaultContextSourceName:       "Suche nach Bedeutung",
	vaultContextSourceReady:      "Schreibstube ist installiert und die Suche nach Bedeutung eingeschaltet: Vault-Kontext und verwandte Unterhaltungen funktionieren.",
	vaultContextNeedsSchreibstube: "Vault-Kontext an – er braucht aber Schreibstube mit eingeschalteter Suche nach Bedeutung, um Notizen zu finden. Bis dahin gehen Nachrichten mit den angehängten Notizen hinaus.",
	vaultContextSourceMissing:    "Nicht verfügbar. Vault-Kontext und verwandte Unterhaltungen brauchen Schreibstube mit eingeschalteter Suche nach Bedeutung; ohne sie gehen Nachrichten mit den angehängten Notizen hinaus, und die Gesprächssuche schaut auf die Titel.",
	vaultContextEnabledName:      "Standardmäßig aktivieren",
	vaultContextEnabledDesc:      "Relevante Vault-Notizen in neue Unterhaltungen holen. Pro Unterhaltung auch über die Eingabe-Toolbar umschaltbar (Bibliothek-Symbol).",
	vaultContextFoldersName:      "Ordner als Quelle",
	vaultContextFoldersDesc:      "Ein Ordnerpfad pro Zeile; nur Notizen darin werden beigelegt (leer lassen für den ganzen Vault). Pythias eigene Gesprächs- und Notizordner werden nie verwendet.",
	vaultContextNotesPerTurnName: "Notizen pro Antwort",
	vaultContextNotesPerTurnDesc: "Wie viele passende Notizen einer Nachricht als Kontext beigelegt werden. Mehr Notizen kosten mehr Tokens und können die eigentliche Frage überdecken.",
};

export default vaultContextDe;
