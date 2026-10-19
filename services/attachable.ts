/**
 * Which vault files a picker offers to attach — the ONE list, read by the
 * `#` suggestions, the note picker, a folder's attach-all and a drop.
 *
 * Five pickers kept their own copy of "md or pdf", so a spreadsheet export
 * could not be attached anywhere, and adding it meant finding all five.
 * What happens to an attachment is decided by kind further on: a PDF goes as
 * a document block (`buildAttachedPdfs`), everything else as text
 * (`buildAttachedNotesContent`) — so a type listed here must be text, or a PDF.
 */
export const ATTACHABLE_EXTENSIONS: ReadonlySet<string> = new Set(["md", "pdf", "csv", "tsv"]);

export function isAttachable(file: { extension: string }): boolean {
	return ATTACHABLE_EXTENSIONS.has(file.extension.toLowerCase());
}
