// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationService } from "../services/ConversationService";
import { DEFAULT_SETTINGS } from "../models/settings";
import type { Conversation } from "../models/types";

// ADR-173: the archive offered beside Delete. The contract the caller depends
// on is the return value — false means the note is NOT on disk, so the
// conversation must survive.

const conv = (): Conversation => ({
	id: "c1",
	name: "Mietvertrag",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-09-15T04:39:00.000Z",
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-5",
	messages: [],
	favorites: [],
});

const makePlugin = (over: Record<string, unknown> = {}) => ({
	settings: { ...DEFAULT_SETTINGS },
	noteWriter: { archiveConversationNote: vi.fn().mockResolvedValue("Pythia/Archive/2026-09-15-Mietvertrag.md") },
	...over,
});

let plugin: ReturnType<typeof makePlugin>;
let service: ConversationService;

beforeEach(() => {
	plugin = makePlugin();
	service = new ConversationService(plugin as never);
});

describe("ConversationService.archiveConversation", () => {
	it("writes the note into the configured folder and reports success", async () => {
		plugin.settings.archiveFolder = "Archiv/Gespräche";

		await expect(service.archiveConversation(conv())).resolves.toBe(true);

		expect(plugin.noteWriter.archiveConversationNote).toHaveBeenCalledWith(
			expect.objectContaining({ id: "c1" }),
			"Archiv/Gespräche",
		);
	});

	it("falls back to the default folder when the setting was cleared", async () => {
		plugin.settings.archiveFolder = "";

		await service.archiveConversation(conv());

		expect(plugin.noteWriter.archiveConversationNote.mock.calls[0][1]).toBe(DEFAULT_SETTINGS.archiveFolder);
	});

	it("returns false instead of throwing when the note cannot be written", async () => {
		// The caller deletes only on true. Throwing here would either lose the
		// conversation (if the caller swallowed it) or leave the dialog stuck.
		plugin.noteWriter.archiveConversationNote = vi.fn().mockRejectedValue(new Error("read-only vault"));

		await expect(service.archiveConversation(conv())).resolves.toBe(false);
	});
});
