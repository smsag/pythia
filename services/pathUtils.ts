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
