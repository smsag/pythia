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
} from "./promptConstants";

/**
 * Builds the system prompt from a conversation's system prompt text and
 * optional summary.
 */
export function buildSystemPrompt(conversation: Conversation): string {
	const parts: string[] = [];

	const promptText = conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT;
	parts.push(
		`<${SYSTEM_PROMPT_TAG}>\n${promptText}\n</${SYSTEM_PROMPT_TAG}>`
	);

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
				`When a question is time-sensitive or you are not confident a fact is current, use the web_search tool rather than relying on memory. ` +
				`Base your answer on the results; do not add your own inline source markers or a sources list — Pythia lists the web sources for you automatically.\n` +
				`</${RECENT_CONTEXT_TAG}>`
		);
	}

	// A fork carries its source's summary as context in `forkedFromSummary`; a
	// conversation's own `summaryText` (once it has one) takes precedence.
	const priorSummary = conversation.summaryText ?? conversation.forkedFromSummary;
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
			`${FORKED_EXCERPT_INSTRUCTION}\n\n<${FORKED_EXCERPT_TAG}>\n${forkedExcerpt}\n</${FORKED_EXCERPT_TAG}>`
		);
	}

	if (conversation.contextNotes.length > 0) {
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
			const body = isExcerpt
				? `(Showing only the most relevant sections of this note — it has been shortened.)\n\n${text}`
				: text;
			return {
				notePath,
				part: `<${ATTACHED_NOTE_TAG} ${ATTACHED_NOTE_PATH_ATTR}="${notePath}"${isExcerpt ? ` ${ATTACHED_NOTE_EXCERPT_ATTR}="true"` : ""}>\n${body}\n</${ATTACHED_NOTE_TAG}>`,
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
