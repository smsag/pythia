import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import { estimateTokensFromText, arrayBufferToBase64 } from "./messageUtils";
import { selectRelevantChunks } from "./noteChunking";
import {
	SYSTEM_PROMPT_TAG,
	PREVIOUS_SUMMARY_TAG,
	PRIOR_SUMMARY_INSTRUCTION,
	FORKED_EXCERPT_TAG,
	FORKED_EXCERPT_INSTRUCTION,
	ATTACHED_NOTE_TAG,
	ATTACHED_NOTE_PATH_ATTR,
	ATTACHED_NOTE_EXCERPT_ATTR,
	RECENT_CONTEXT_TAG,
	MAX_PDF_FILE_SIZE_BYTES,
	DEFAULT_SYSTEM_PROMPT,
	GROUNDING_INSTRUCTION,
	WEB_CITATION_INSTRUCTION,
	NO_SOLICITATION_INSTRUCTION,
	CUSTOM_INSTRUCTIONS_TAG,
	UNTRUSTED_CONTENT_INSTRUCTION,
} from "./promptConstants";

/** Pythia's own structural wrapper tags. If any of these appears verbatim inside
 *  untrusted content (a note body, a summary, a forked excerpt), the content could
 *  close its wrapper early and inject a forged <system_prompt> or <attached_note>
 *  block — a prompt-injection delimiter escape. */
const CONTROL_TAGS = [
	SYSTEM_PROMPT_TAG,
	CUSTOM_INSTRUCTIONS_TAG,
	ATTACHED_NOTE_TAG,
	PREVIOUS_SUMMARY_TAG,
	FORKED_EXCERPT_TAG,
	RECENT_CONTEXT_TAG,
];
const CONTROL_TAG_RX = new RegExp(`</?\\s*(?:${CONTROL_TAGS.join("|")})\\b`, "gi");

/** Defang Pythia's structural tags inside untrusted text so it cannot break out
 *  of its delimited block. The opening `<` is swapped for a visually-similar
 *  single-guillemet (‹, U+2039) that carries no markup meaning — the text stays
 *  readable for the model while the tag no longer parses as a Pythia delimiter. */
export function neutralizeControlTags(text: string): string {
	return text.replace(CONTROL_TAG_RX, (m) => m.replace("<", "‹"));
}

/** Escape a value interpolated into a tag attribute so a crafted path cannot
 *  break out of the quoted attribute and inject sibling attributes or tags. */
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Builds the system prompt from a conversation's system prompt text and
 * optional summary. `customInstructions` (from settings) are appended as
 * standing user guidance after the conversation's own system prompt.
 */
export function buildSystemPrompt(
	conversation: Conversation,
	customInstructions = "",
	/** Whether note text is actually being inlined into this turn's system prompt.
	 *  This can exceed `conversation.contextNotes` — e.g. vault-RAG auto-retrieved
	 *  notes (ADR-116) are appended to the request but never stored on the
	 *  conversation. The citation instruction and the untrusted-content injection
	 *  guard must key off the content that is really present, not just the manual
	 *  context list, or auto-retrieved notes would be injected uncited AND without
	 *  the ADR-115 "treat as data" framing. */
	opts: { hasAttachedNotes?: boolean } = {}
): string {
	const parts: string[] = [];
	const hasAttachedNotes = opts.hasAttachedNotes === true;

	const promptText = conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT;
	parts.push(
		`<${SYSTEM_PROMPT_TAG}>\n${promptText}\n</${SYSTEM_PROMPT_TAG}>`
	);

	// User's global standing instructions, if any — treated as authoritative
	// preferences layered on top of the system prompt.
	const custom = customInstructions.trim();
	if (custom) {
		parts.push(`<${CUSTOM_INSTRUCTIONS_TAG}>\n${custom}\n</${CUSTOM_INSTRUCTIONS_TAG}>`);
	}

	// Always suppress the assistant's boilerplate closing offer to save-as-note /
	// continue (independent of the user's own system prompt, since the behavior is
	// driven by the KB framing + note tools, not the prompt text).
	parts.push(NO_SOLICITATION_INSTRUCTION);

	// Prompt-injection guard — added whenever untrusted context (attached notes/
	// PDFs, a prior summary, a forked excerpt, or web results in research mode)
	// will accompany this request, so the model is told upfront to treat that
	// content as data rather than commands. Placed high in the system prompt so
	// it frames every context block that follows.
	const priorSummaryRaw = conversation.summaryText ?? conversation.forkedFromSummary;
	const hasUntrustedContext =
		conversation.contextNotes.length > 0 ||
		hasAttachedNotes ||
		conversation.researchMode === true ||
		!!priorSummaryRaw ||
		!!conversation.forkedFromSelection?.trim();
	if (hasUntrustedContext) {
		parts.push(UNTRUSTED_CONTENT_INSTRUCTION);
	}

	// Recency grounding — only when research mode is on, i.e. when the
	// web_search tool is available. Injected here (not in promptConstants,
	// which holds only literal contracts) because the date is computed at
	// build time. Gating on researchMode also keeps the block out of the
	// default prompt so plain conversations are unchanged.
	if (conversation.researchMode) {
		const today = new Date().toISOString().slice(0, 10);
		parts.push(
			`<${RECENT_CONTEXT_TAG}>\n` +
				`Current date: ${today}.\n` +
				`Your training data has a cutoff, so anything after it — recent events, current prices, latest versions, people's present roles — may be outdated or unknown to you. ` +
				`Default to the web_search tool whenever a question is time-sensitive or you are not fully confident a fact is still current: search first, then answer from the results rather than from memory. ` +
				`Base your answer on the results. ${WEB_CITATION_INSTRUCTION}\n` +
				`</${RECENT_CONTEXT_TAG}>`
		);
	}

	// A fork carries its source's summary as context in `forkedFromSummary`; a
	// conversation's own `summaryText` (once it has one) takes precedence.
	// Neutralized so a summary can't forge or close a control block (both are
	// model-generated, but the source material they summarize is untrusted).
	const priorSummary = priorSummaryRaw ? neutralizeControlTags(priorSummaryRaw) : priorSummaryRaw;
	if (priorSummary) {
		parts.push(
			`${PRIOR_SUMMARY_INSTRUCTION}\n\n<${PREVIOUS_SUMMARY_TAG}>\n${priorSummary}\n</${PREVIOUS_SUMMARY_TAG}>`
		);
	}

	// A fork also carries the exact passage it was branched from. The summary
	// above gives the topic; this names the specific point the opening question
	// refers back to, so a fork's first "name others like this" stays anchored.
	const forkedExcerpt = conversation.forkedFromSelection?.trim();
	if (forkedExcerpt) {
		parts.push(
			`${FORKED_EXCERPT_INSTRUCTION}\n\n<${FORKED_EXCERPT_TAG}>\n${neutralizeControlTags(forkedExcerpt)}\n</${FORKED_EXCERPT_TAG}>`
		);
	}

	if (conversation.contextNotes.length > 0 || hasAttachedNotes) {
		parts.push(GROUNDING_INSTRUCTION);
	}

	return parts.join("\n\n");
}

export async function buildAttachedNotesContent(
	app: App,
	attachedNotes: string[],
	/** The user's in-progress message — used to pick the most relevant sections of long notes. */
	query = ""
): Promise<{ content: string; missingNotes: string[]; estimatedTokens: number }> {
	if (attachedNotes.length === 0) return { content: "", missingNotes: [], estimatedTokens: 0 };
	// Reads are independent of each other — parallelize, then assemble in the
	// original attachedNotes order so prompt content stays deterministic.
	const results = await Promise.all(
		attachedNotes.map(async (notePath): Promise<{ notePath: string; part?: string }> => {
			const file = app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) return { notePath };
			const raw = await app.vault.read(file);
			const { text, isExcerpt } = selectRelevantChunks(raw, query);
			// Note bodies are untrusted: defang any Pythia control tags so a note
			// cannot close its <attached_note> wrapper early and inject a forged
			// <system_prompt> block (prompt-injection delimiter escape).
			const safeText = neutralizeControlTags(text);
			const body = isExcerpt
				? `(Showing only the most relevant sections of this note — it has been shortened.)\n\n${safeText}`
				: safeText;
			return {
				notePath,
				part: `<${ATTACHED_NOTE_TAG} ${ATTACHED_NOTE_PATH_ATTR}="${escapeAttr(notePath)}"${isExcerpt ? ` ${ATTACHED_NOTE_EXCERPT_ATTR}="true"` : ""}>\n${body}\n</${ATTACHED_NOTE_TAG}>`,
			};
		})
	);
	const parts: string[] = [];
	const missingNotes: string[] = [];
	for (const r of results) {
		if (r.part !== undefined) parts.push(r.part);
		else missingNotes.push(r.notePath);
	}
	const content = parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
	return {
		content,
		missingNotes,
		estimatedTokens: estimateTokensFromText(content),
	};
}

export interface PdfAttachment {
	path: string;
	filename: string;
	base64: string;
	mediaType: "application/pdf";
}

/**
 * Reads attached PDFs as base64 for native document/file content blocks —
 * sent whole to the model (no local text extraction, no chunking; the model's
 * own PDF understanding handles that). Kept separate from
 * buildAttachedNotesContent rather than merged into it: the two file kinds
 * are fundamentally different at the wire level (inline text vs. a binary
 * content block), and each function classifying its own paths independently
 * means a third attachment kind later doesn't require touching either.
 */
export async function buildAttachedPdfs(
	app: App,
	attachedPaths: string[]
): Promise<{ pdfs: PdfAttachment[]; missingPdfs: string[]; oversizedPdfs: string[] }> {
	if (attachedPaths.length === 0) return { pdfs: [], missingPdfs: [], oversizedPdfs: [] };
	const results = await Promise.all(
		attachedPaths.map(async (path): Promise<
			{ path: string; pdf?: PdfAttachment; missing?: true; oversized?: true }
		> => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return { path, missing: true };
			if (file.stat.size > MAX_PDF_FILE_SIZE_BYTES) return { path, oversized: true };
			const buf = await app.vault.readBinary(file);
			return {
				path,
				pdf: {
					path,
					filename: file.name,
					base64: arrayBufferToBase64(buf),
					mediaType: "application/pdf",
				},
			};
		})
	);
	const pdfs: PdfAttachment[] = [];
	const missingPdfs: string[] = [];
	const oversizedPdfs: string[] = [];
	for (const r of results) {
		if (r.pdf) pdfs.push(r.pdf);
		else if (r.oversized) oversizedPdfs.push(r.path);
		else missingPdfs.push(r.path);
	}
	return { pdfs, missingPdfs, oversizedPdfs };
}
