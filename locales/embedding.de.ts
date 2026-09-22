import type embeddingEn from "./embedding.en";

// German for `embedding.en.ts` — same keys, enforced by the type (ADR-198).

const embeddingDe: typeof embeddingEn = {
	// ── Der Abschnitt und was er tut ──────────────────────────────────────────
	embeddingSectionName:      "Semantische Suche auf dem Gerät",
	embeddingIntro:            "Pythia kann Gespräche anzeigen, die mit dem aktuellen verwandt sind, und einer Nachricht selbstständig passende Notizen beilegen. Beides nutzt ein kleines Sprachmodell, das auf diesem Gerät läuft: Es verwandelt Text in Zahlen, sodass ähnliche Bedeutungen nah beieinander liegen. Deine Notizen werden lokal indexiert und dafür nirgendwohin geschickt. Das Modell wird einmal heruntergeladen, beim ersten Gebrauch.",
	embeddingModelName:        "Modell",
	embeddingModelDesc:        "Mehrsprachig (≈ {{multiMb}} MB) erkennt Bedeutung über Sprachgrenzen hinweg – eine deutsche Frage findet eine englische Notiz. Englisch (≈ {{enMb}} MB) ist kleiner und schneller und versteht andere Sprachen nur über gemeinsame Wörter. Gilt für ähnliche Gespräche und den Vault-Kontext; ein Wechsel baut einen neuen Index auf.",
	embeddingModelMobileNote:  "Auf diesem Gerät nutzt Pythia {{model}}: {{chosen}} braucht mehr Speicher, als ein Smartphone oder Tablet erlaubt – das Laden hat Obsidian neu starten lassen. Deine Auswahl gilt weiterhin auf dem Desktop.",
	embeddingModelDesktopNote: "Smartphones und Tablets nutzen immer {{model}} – {{chosen}} braucht mehr Speicher, als sie erlauben.",
	relatedFirstRun:           "Semantisches Modell wird vorbereitet – beim ersten Mal wird es heruntergeladen, das kann einen Moment dauern.",
	relatedSimilarityName:     "Ähnliche Gespräche — ab welcher Nähe ein Treffer zählt",
	relatedSimilarityDesc:     "Wie ähnlich ein Gespräch sein muss, um unter „Ähnliche anzeigen“ zu erscheinen. Streng zeigt nur sehr enge Treffer; Locker auch schwächere.",
	relatedSimilarityStrict:   "Streng (weniger, näher)",
	relatedSimilarityBalanced: "Ausgewogen",
	relatedSimilarityLoose:    "Locker (mehr, lockerer)",

	// ── Vault-Kontext ─────────────────────────────────────────────────────────
	vaultContextSectionName:      "Vault-Kontext (semantisches RAG)",
	vaultContextIntro:            "Mit Vault-Kontext wird jede Nachricht mit einem Index deiner Notizen verglichen, und die ähnlichsten werden dem Prompt beigelegt, damit die Antwort sie nutzen kann. Der Index entsteht im Hintergrund, wenn er zum ersten Mal gebraucht wird, und folgt danach deinen Änderungen. Eine Notiz mit pythia: false in den Eigenschaften wird nie indexiert.",
	vaultContextEnabledName:      "Standardmäßig aktivieren",
	vaultContextEnabledDesc:      "Relevante Vault-Notizen automatisch in neue Unterhaltungen holen. Pro Unterhaltung auch über die Eingabe-Toolbar umschaltbar (Bibliothek-Symbol).",
	vaultContextFoldersName:      "Zu indexierende Ordner",
	vaultContextFoldersDesc:      "Ein Ordnerpfad pro Zeile, um den semantischen Index einzugrenzen (leer lassen, um den ganzen Vault zu indexieren). Weniger Ordner = schnellere Indexierung bei großen Vaults.",
	vaultContextMaxNotesName:     "Max. zu indexierende Notizen",
	vaultContextMaxNotesDesc:     "Obergrenze für die Anzahl indexierter Notizen (0 = unbegrenzt). Schützt sehr große Vaults vor einem langsamen, speicherintensiven Index – besser oben auf Ordner eingrenzen.",
	vaultContextNotesPerTurnName: "Notizen pro Antwort",
	vaultContextNotesPerTurnDesc: "Wie viele passende Notizen einer Nachricht als Kontext beigelegt werden. Mehr Notizen kosten mehr Tokens und können die eigentliche Frage überdecken.",

	// ── Der Index: Hinweise während des Aufbaus ───────────────────────────────
	vaultIndexBuilding:     "Vault-Index wird im Hintergrund erstellt – Antworten nutzen ihn, sobald er bereit ist.",
	vaultIndexProgress:     "Vault wird für Pythia indexiert… {{done}}/{{total}}",
	vaultIndexBusy:         "Der Vault-Index wird bereits erstellt – bitte warte, bis er fertig ist.",
	vaultIndexCapped:       "Großer Vault: {{indexed}} von {{total}} Notizen werden indexiert. Grenze in den Einstellungen auf Ordner ein oder erhöhe das Limit.",
	vaultIndexThrottled:    "Dieses Gerät führt das Embedding-Modell im UI-Thread aus (kein Hintergrund-Worker verfügbar). Die Indexierung wird daher gedrosselt, damit die App reagierbar bleibt – das kann dauern. Sie läuft einmal; Änderungen werden inkrementell aktualisiert.",
	vaultIndexPausedNotice: "Pythia hat den Vault-Index pausiert: Die letzten Aufbauten sind nicht fertig geworden – das passiert, wenn die App mittendrin geschlossen wird oder der Speicher ausgeht. Antworten funktionieren auch ohne ihn. Neuer Versuch: Einstellungen → Vault-Kontext → Jetzt aufbauen.",

	// ── Der Index: die Statuszeile in den Einstellungen ───────────────────────
	vaultIndexStatusName:        "Index-Status",
	vaultIndexStateNotBuilt:     "Noch nicht aufgebaut. Er entsteht im Hintergrund, sobald du zum ersten Mal eine Nachricht mit Vault-Kontext sendest – oder tippe auf „Jetzt aufbauen“.",
	vaultIndexStateBuilding:     "Wird aufgebaut… {{done}} von {{total}} Notizen. Du kannst weiterarbeiten – Antworten nutzen den Index, sobald er bereit ist.",
	vaultIndexStateReady:        "Bereit – {{count}} Notizen indexiert. Änderungen werden laufend übernommen.",
	vaultIndexStatePartial:      "Unvollständig – bisher {{count}} Notizen indexiert. Der Aufbau geht weiter, sobald er gebraucht wird, oder tippe auf „Jetzt aufbauen“.",
	vaultIndexStateOutdated:     "Veraltet – Ordner oder Notizlimit haben sich seit dem Aufbau geändert. Er wird neu aufgebaut, sobald er gebraucht wird, oder tippe auf „Jetzt aufbauen“.",
	vaultIndexStateFailed:       "Der letzte Aufbau ist fehlgeschlagen: {{error}}",
	vaultIndexStateOutOfMemory:  "Abgebrochen – diesem Gerät ist beim Laden des Modells der Speicher ausgegangen. Pythia versucht es nicht von selbst erneut; tippe auf „Jetzt aufbauen“ für einen neuen Versuch.",
	vaultIndexStatePaused:       "Pausiert – die letzten {{count}} Aufbauten sind nicht fertig geworden. Das passiert, wenn die App mittendrin geschlossen wird oder dem Gerät der Speicher ausgeht, deshalb startet Pythia keinen weiteren von selbst. Tippe auf „Jetzt aufbauen“ für einen neuen Versuch.",
	vaultIndexDetailModel:       "Modell: {{model}}",
	vaultIndexDetailModelMobile: "Modell: {{model}} (mobil)",
	vaultIndexBackend:           "Engine: {{backend}}",
	vaultIndexDetailOff:         "Vault-Kontext ist standardmäßig aus – oben einschalten oder pro Unterhaltung über das Bibliothek-Symbol",
	vaultIndexBuildNow:          "Jetzt aufbauen",
	vaultIndexBuildNowTooltip:   "Index fertigstellen oder aktualisieren, Bereits-Indexiertes bleibt erhalten",
	vaultContextReindexBtn:      "Index neu aufbauen",
	vaultIndexRebuildTooltip:    "Index verwerfen und jede Notiz neu einbetten",
};

export default embeddingDe;
