import { describe, it, expect } from "vitest";
import { composerKeyAction, composerPlaceholder } from "../ui/composerKeys";

// ADR-175: Enter writes a line break in the composer; Cmd/Ctrl+Enter sends.
describe("composerKeyAction", () => {
	it("treats a bare Enter as a line break", () => {
		expect(composerKeyAction({ key: "Enter" })).toBe("insert");
	});

	it("treats Shift+Enter as a line break too — there is no send modifier but Cmd/Ctrl", () => {
		expect(composerKeyAction({ key: "Enter", metaKey: false, ctrlKey: false })).toBe("insert");
	});

	it("sends on Cmd+Enter and on Ctrl+Enter", () => {
		expect(composerKeyAction({ key: "Enter", metaKey: true })).toBe("send");
		expect(composerKeyAction({ key: "Enter", ctrlKey: true })).toBe("send");
	});

	it("never sends while an IME is composing", () => {
		// A Japanese/Chinese IME commits its candidate with Enter. Sending there
		// would fire mid-word, with the composition text still uncommitted.
		expect(composerKeyAction({ key: "Enter", isComposing: true })).toBe("insert");
		expect(composerKeyAction({ key: "Enter", metaKey: true, isComposing: true })).toBe("insert");
	});

	it("ignores every other key", () => {
		for (const key of ["a", "Escape", "Tab", "ArrowDown", "NumpadEnter"]) {
			expect(composerKeyAction({ key, metaKey: true })).toBe("insert");
		}
	});
});

describe("composerPlaceholder", () => {
	it("names the send shortcut on desktop and not on a phone", () => {
		expect(composerPlaceholder(false)).toMatch(/Enter/);
		expect(composerPlaceholder(true)).not.toMatch(/Enter/);
	});
});
