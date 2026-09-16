/**
 * Vault-path helpers.
 *
 * `noteBasename` is the display name of a vault file: the last path segment
 * with the `.md` extension stripped. Used wherever a path has to be shown to
 * the user (citation chips, context inspector, reference pills, the template
 * caption on an assistant turn).
 */

/** Display name for a vault path: last segment, `.md` stripped. */
export function noteBasename(path: string): string {
	return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** Characters no file system accepts in a name, replaced by `-`. The one
 *  sanitizer for conversation-derived file names (summary notes, saved
 *  transcripts, renamed notes) — it was copied into three files before and the
 *  copies would eventually have disagreed. */
export function safeNoteName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
}

/**
 * Normalize a vault path the way Obsidian's `normalizePath` does — forward
 * slashes, no leading/trailing slash, no empty or `.` segments — without the
 * Obsidian import, so it can run in pure unit tests. `..` is NOT resolved: the
 * writers reject it outright, and resolving it here would turn a traversal
 * attempt into a valid-looking path.
 */
export function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.split("/")
		.filter((seg) => seg !== "" && seg !== ".")
		.join("/");
}

/** Quote a scalar for a YAML frontmatter value. A JSON string literal is a
 *  valid YAML double-quoted scalar, so a title containing `: `, `#` or a quote
 *  can no longer break the block. */
export function yamlString(value: string): string {
	return JSON.stringify(value);
}
