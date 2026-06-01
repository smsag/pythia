import type { Strings } from "./en";

const de: Strings = {
	// ── Sidebar header ────────────────────────────────────────────────────────
	noConversation:         "Kein Gespräch",
	changeModelTooltip:     "Anbieter / Modell wechseln",
	deleteConvTooltip:      "Gespräch löschen",
	newConvTooltip:         "Neues Gespräch",
	templateLabel:          "Vorlage: {{name}}",

	// ── Fork banner ───────────────────────────────────────────────────────────
	forkedFromLabel:            "Verzweigt von",
	deletedConversation:        "Gelöschtes Gespräch",
	forkSummaryFailed:          "Zusammenfassung konnte nicht generiert werden: {{error}}",

	// ── Context / favorites sections ─────────────────────────────────────────
	referenceSection: "Referenz",
	forksSection: "Abzweigungen",
	chaptersSection: "Kapitel",
	addContextNoteTooltip: "Notiz zum Kontext hinzufügen",
	favoritesSection: "Favoriten",
	navNoForks:      "Noch keine Abzweigungen",
	navNoStarred:    "Keine markierten Nachrichten",
	navNoChapters:   "Noch keine Kapitel",

	// ── Empty states ─────────────────────────────────────────────────────────
	noActiveConversationHint:  "Kein aktives Gespräch.",
	startFromPaletteHint:      'Starte eines über die Befehlspalette (Strg/Cmd+P → "Pythia:").',
	startConversationBelow:    "Beginne das Gespräch unten.",

	// ── Message bubbles ───────────────────────────────────────────────────────
	addToFavorites:      "Zu Favoriten hinzufügen",
	removeFromFavorites: "Aus Favoriten entfernen",
	tokenCount:          "↑{{input}} ↓{{output}}",
	tokenCountTitle:     "Eingabe: {{input}} Tokens · Ausgabe: {{output}} Tokens",

	// ── Tool call chips ───────────────────────────────────────────────────────
	creatingNote: "Notiz wird erstellt: {{path}}",
	createdNote:  "✓ Erstellt [[{{name}}]]",

	// ── Selection toolbar ─────────────────────────────────────────────────────
	copyBtn:  "Kopieren",
	insertBtn:"In Notiz einfügen",
	inboxBtn: "Im Posteingang speichern",
	forkBtn:  "Verzweigen",

	// ── Input toolbar ─────────────────────────────────────────────────────────
	inputPlaceholder:    "Nachricht eingeben… (Enter zum Senden, Shift+Enter für neue Zeile)",
	sendBtn:             "Senden",
	sendBtnEstTitle:     "Geschätzte Eingabe-Tokens für nächste Sendung: {{n}}",
	stopBtn:             "Anfrage abbrechen",
	attachNoteTooltip:   "Notiz anhängen",
	saveResponseTooltip: "Antwort speichern",
	summarizeTooltip:    "Gespräch zusammenfassen",
	showChaptersTooltip: "Kapitel anzeigen",

	// ── Notices ───────────────────────────────────────────────────────────────
	copied:                    "Kopiert",
	copyFailed:                "Kopieren fehlgeschlagen",
	copyConvLinkTooltip:       "Link zu diesem Gespräch kopieren",
	convLinkCopied:            "Gesprächslink kopiert",
	noActiveNoteToInsert:      "Keine aktive Notiz zum Einfügen.",
	insertedIntoNote:          "In Notiz eingefügt",
	savedToInbox:              "Im Posteingang gespeichert",
	failedSaveToInbox:         "Speichern im Posteingang fehlgeschlagen: {{error}}",
	noMessagesToSave:          "Keine Nachrichten zum Speichern.",
	nothingNewToSave:          "Nichts Neues seit dem letzten Speichern.",
	savedToPath:               "Gespeichert unter {{path}}",
	saveFailed:                "Speichern fehlgeschlagen: {{error}}",
	noActiveConvToSend:        "Kein aktives Gespräch. Starte eines über die Befehlspalette.",
	messageLimitReached:       "Nachrichtenlimit erreicht ({{cap}}). Starte ein neues Gespräch oder erhöhe das Limit in Einstellungen → Pythia.",
	noMessagesToSummarize:     "Keine Nachrichten zum Zusammenfassen.",
	generatingSummary:         "Zusammenfassung wird erstellt…",
	summaryFailed:             "Zusammenfassung fehlgeschlagen: {{error}}",
	fileNotFound:              "Datei nicht gefunden: {{path}}",

	// ── API error notices ─────────────────────────────────────────────────────
	modelNotFound:  "Modell \"{{model}}\" nicht gefunden. Ändere es in den Einstellungen.",
	apiKeyRejected: "API-Schlüssel abgelehnt. Prüfe Einstellungen → Pythia.",
	rateLimitHit:   "Anfragelimit erreicht. Versuche es gleich erneut.",
	networkError:   "Netzwerkfehler. Prüfe deine Internetverbindung.",

	// ── Save conversation modal ───────────────────────────────────────────────
	saveConvTitle: "Gespräch als Notiz speichern",
	filePathLabel: "Dateipfad",

	// ── Main / commands ───────────────────────────────────────────────────────
	sendToPythia:           "An Pythia senden",
	chatAboutNote:          "Über diese Notiz chatten",
	chatAboutFolder:        "Über diesen Ordner chatten",
	noMarkdownInFolder:     "Keine Markdown-Dateien in diesem Ordner gefunden.",
	summaryGenerationFailed:"Zusammenfassung fehlgeschlagen: {{error}}",
	noActiveNoteForCommand: "Keine aktive Notiz. Öffne zuerst eine Notiz.",
	clipboardReadFailed:    "Zwischenablage konnte nicht gelesen werden. Bitte Zugriff erlauben und erneut versuchen.",
	clipboardEmpty:         "Zwischenablage ist leer.",
	noConversations:        "Keine Gespräche gefunden.",
	noFavorites:            "Keine Favoriten gefunden.",
	noPastConversations:    "Keine vergangenen Gespräche gefunden.",
	setApiKeyFirst:         "Trage deinen API-Schlüssel in Einstellungen → Pythia ein, bevor du eine Zusammenfassung erstellst.",
	generatingConvSummary:  "Gesprächszusammenfassung wird erstellt…",
	conversationDeleted:    "Gespräch gelöscht.",
	attachedAsContext:      "\"{{name}}\" als Kontext hinzugefügt.",
	noTemplatesFound:       "Keine Vorlagen in \"{{folder}}\" gefunden. Erstelle eine Notiz mit `pythia_template: true` im Frontmatter.",
	loadedTemplate:         "Vorlage \"{{name}}\" mit {{count}} Kontextnotiz(en) geladen.",
	deepLinkError:          "Pythia-Deeplink-Fehler: {{error}}",
	uriMissingId:           "Pythia URI: Parameter 'id' fehlt.",
	uriMissingName:         "Pythia URI: Parameter 'name' fehlt.",
	convNotFound:           "Pythia: Gespräch \"{{id}}\" nicht gefunden.",
	templateNotFound:       "Pythia: Vorlage \"{{name}}\" nicht gefunden.",
	unknownAction:          "Pythia: Unbekannte Aktion \"{{action}}\".",
	migrateAnthropicFailed: "Anthropic-API-Schlüssel konnte nicht migriert werden. Bitte in Einstellungen → Pythia neu eingeben.",
	migrateOpenAIFailed:    "OpenAI-API-Schlüssel konnte nicht migriert werden. Bitte in Einstellungen → Pythia neu eingeben.",

	// ── Services ──────────────────────────────────────────────────────────────
	anthropicKeyNotConfigured: "Anthropic-API-Schlüssel nicht konfiguriert. Trage ihn in Einstellungen → Pythia ein.",
	openaiKeyNotConfigured:    "OpenAI-API-Schlüssel nicht konfiguriert. Trage ihn in Einstellungen → Pythia ein.",
	contextNotesWarning:       "Warnung: {{count}} Kontextnotiz(en) nicht gefunden und übersprungen.",

	// ── Settings ─────────────────────────────────────────────────────────────
	settingsTitle:           "Pythia",
	anthropicSection:        "Anthropic",
	openaiSection:           "OpenAI",
	defaultsSection:         "Standardwerte",
	vaultFoldersSection:     "Vault-Ordner",
	behaviourSection:        "Verhalten",
	featuresSection:         "Funktionen",
	anthropicKeyName:        "Anthropic-API-Schlüssel",
	anthropicKeyDesc:        "Wähle ein Geheimnis aus Obsidians Secret Storage. Schlüssel werden nie als Klartext in data.json gespeichert.",
	defaultAnthropicModel:   "Standard-Anthropic-Modell",
	defaultAnthropicModelDesc:"Wird verwendet, wenn eine Vorlage kein Modell angibt.",
	openaiKeyName:           "OpenAI-API-Schlüssel",
	openaiKeyDesc:           "Wähle ein Geheimnis aus Obsidians Secret Storage. Schlüssel werden nie als Klartext in data.json gespeichert.",
	defaultOpenAIModel:      "Standard-OpenAI-Modell",
	defaultOpenAIModelDesc:  "Wird verwendet, wenn eine Vorlage kein Modell angibt.",
	defaultProviderName:     "Standardanbieter",
	defaultProviderDesc:     "Anbieter für neue Gespräche ohne Vorlage.",
	templatesFolderName:     "Vorlagenordner",
	templatesFolderDesc:     "Vault-Ordner, der nach pythia_template-Notizen durchsucht wird.",
	convsFolderName:         "Gesprächsordner",
	convsFolderDesc:         "Hier werden Gesprächszusammenfassungen gespeichert.",
	scratchFolderName:       "Scratch-Ordner",
	scratchFolderDesc:       "Hier werden spontane Gesprächsnotizen gespeichert.",
	inboxNoteName:           "Posteingangsnotiz",
	inboxNoteDesc:           "Notiz, die Einträge der Aktion 'Im Posteingang speichern' erhält.",
	autoSaveName:            "Zusammenfassung beim Schließen automatisch speichern",
	autoSaveDesc:            "Beim Schließen eines Gesprächs automatisch eine Zusammenfassungsnotiz erstellen.",
	resumeModeName:          "Standard-Fortsetzungsmodus",
	resumeModeDesc:          "Wie Gespräche fortgesetzt werden, sofern nicht pro Gespräch überschrieben.",
	resumeModeSummaryOpt:    "Zusammenfassung — geringere Token-Kosten",
	resumeModeFullOpt:       "Vollständiger Verlauf — höhere Genauigkeit",
	messageCapName:          "Nachrichtenlimit pro Sitzung",
	messageCapDesc:          "Maximale Nachrichtenanzahl pro Gespräch. Bei 0 unbegrenzt.",
	maxConversationsName:    "Gesprächsverlauf-Limit",
	maxConversationsDesc:    "Maximale Anzahl gespeicherter Gespräche. Älteste Gespräche ohne Favoriten werden entfernt. Bei 0 unbegrenzt.",
	outputLanguageName:      "Ausgabesprache",
	outputLanguageDesc:      "Sprache für KI-generierte Texte (Titel, Zusammenfassungen, Kapitel). Auto folgt der Gesprächssprache.",
	outputLanguageAuto:      "Auto (Gesprächssprache)",
	outputLanguageEnglish:   "Englisch",
	outputLanguageGerman:    "Deutsch",
	debugModeName:           "Debug-Modus",
	debugModeDesc:           "API-Aufrufe und Payloads in der Entwicklerkonsole protokollieren.",
	enableNoteCreationName:  "KI darf Notizen erstellen",
	enableNoteCreationDesc:  "Gibt der KI ein create_note-Tool, mit dem sie Vault-Notizen schreiben kann. Du kannst Pythia bitten, eine Notiz in natürlicher Sprache zu erstellen.",
	injectActiveNoteOnTemplateName: "Aktive Notiz bei Vorlagen einfügen",
	injectActiveNoteOnTemplateDesc: "Beim Starten einer Konversation aus einer Vorlage wird die aktuell geöffnete Notiz automatisch als zusätzlicher Kontext hinzugefügt (z. B. die Stellenanzeige, das Brief oder der Artikel, an dem du arbeiten möchtest).",
	chooseFolderBtn:         "Ordner wählen",
	customModelOption:       "Benutzerdefiniert…",
	providerAnthropic:       "Anthropic",
	providerOpenAI:          "OpenAI",

	// ── Suggest modals ────────────────────────────────────────────────────────
	searchConversations: "Gespräche durchsuchen…",
	searchFavorites:     "Favoriten durchsuchen…",
	searchFolders:       "Vault-Ordner durchsuchen…",
	searchNotes:         "Vault-Notizen durchsuchen…",
	searchTemplates:     "Vorlagen durchsuchen…",
	instrNavigate:       "zum Navigieren",
	instrOpen:           "zum Öffnen",
	instrDismiss:        "zum Schließen",
	instrSelect:         "zum Auswählen",
	instrAttach:         "zum Anhängen",
	instrUseTemplate:    "um Vorlage zu nutzen",

	// ── Delete file modal ─────────────────────────────────────────────────────
	deleteFileTitle:   "Datei löschen",
	deleteFileConfirm: "\"{{name}}\" aus dem Vault löschen? Dies kann nicht rückgängig gemacht werden.",
	deleteBtn:         "Löschen",
	cancelBtn:         "Abbrechen",
	deleteExchangeBtn: "✕ Löschen",
	exchangeDeleted:   "Austausch gelöscht",

	// ── Delete conversation modal ─────────────────────────────────────────────
	deleteConvTitle:   "Gespräch löschen",
	deleteConvConfirm: "\"{{name}}\" löschen? Dies kann nicht rückgängig gemacht werden.",

	// ── Resume mode modal ─────────────────────────────────────────────────────
	resumeConvTitle:  "Gespräch fortsetzen",
	resumeConvDesc:   "Wie möchtest du \"{{name}}\" fortsetzen?",
	summaryModeBtn:   "Zusammenfassung",
	summaryModeTitle: "KI-Zusammenfassung als Kontext senden — geringere Token-Kosten",
	fullModeBtn:      "Vollständiger Verlauf",
	fullModeTitle:    "Alle vorherigen Nachrichten erneut senden — höhere Genauigkeit, höhere Token-Kosten",
	resumeHint:       "Zusammenfassung empfohlen für lange Gespräche. Vollständiger Verlauf bewahrt alle Details.",

	// ── Sync / reload ─────────────────────────────────────────────────────────
	reloadComplete: "Pythia: Gespräche neu geladen.",

	// ── Conversation rename ────────────────────────────────────────────────────
	renameConvTooltip:   "Gespräch umbenennen",
	renameConvPlaceholder: "Gesprächsname…",
	renameLLMTooltip:    "Name mit KI generieren",
	renameLLMFailed:     "Name konnte nicht generiert werden – API-Schlüssel und Verbindung prüfen.",

	// ── Message bubble collapse ────────────────────────────────────────────────
	showMore: "Mehr anzeigen",
	showLess: "Weniger anzeigen",

	// ── Conversation settings modal ────────────────────────────────────────────
	convSettingsTitle: "Gesprächseinstellungen",
	providerLabel:     "Anbieter",
	modelLabel:        "Modell",
	saveBtn:           "Speichern",
	okBtn:             "OK",
};

export default de;
