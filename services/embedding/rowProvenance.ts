// Which rows of a shared index a device may reuse (ADR-201).
//
// ADR-200 names index files by VECTOR FAMILY, so a phone on the Latin-script
// variant and a desktop on the full multilingual model read and write the same
// file. That is exact for Latin-script text — the variant's vectors are the full
// model's there — and only there. A note or conversation that contains a
// Cyrillic, Greek or CJK word is embedded differently by the variant (those words
// fall back to single characters). Keyed by content hash alone, such a row looked
// "unchanged" to the other device and was reused forever: the desktop ranked it
// with the phone's degraded vector until the text happened to change.
//
// So a row records, through its hash, whether it could differ from the family's:
//  - a variant writes `<hash>~<tag>` for text it cannot reproduce exactly, and the
//    plain hash for text it can (those rows really are interchangeable);
//  - the full model accepts only the plain hash, so it re-embeds a tagged row;
//  - the variant accepts the plain hash too — the full model's vector is the better
//    one, and refusing it would make the two devices overwrite each other forever.
//
// The index format is unchanged: the tag lives inside the hash string both
// services already compare, so an existing file stays valid.

import { conversationContentHash } from "./embeddingIndex";
import { embeddingModelConfig, type EmbeddingModelId } from "../../models/embeddingModels";

export interface HashPolicy {
	/** The hash this device writes for a row built from `chunks`. */
	rowHash(chunks: string[]): string;
	/** Whether a stored row with `stored` may be reused for `chunks` instead of re-embedding. */
	accepts(stored: string, chunks: string[]): boolean;
}

/** A letter that is not Latin script — the text the Latin-script variant cannot
 *  segment the way the full model does. Deliberately a letter test: digits,
 *  punctuation, symbols and marks are kept by the pruning rule and change nothing. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

/** Whether the Latin-script variant embeds `chunks` exactly like the full model. */
export function isLatinExact(chunks: string[]): boolean {
	return !chunks.some((c) => NON_LATIN_LETTER.test(c));
}

const FULL: HashPolicy = {
	rowHash: (chunks) => conversationContentHash(chunks),
	accepts: (stored, chunks) => stored === conversationContentHash(chunks),
};

/** The policy for the model this device embeds with. */
export function hashPolicyFor(modelId: EmbeddingModelId): HashPolicy {
	const config = embeddingModelConfig(modelId);
	if (!config.variantOf) return FULL;
	const tag = `~${config.variantNote ?? "variant"}`;
	const exact = config.variantNote === "latinScript" ? isLatinExact : () => false;
	return {
		rowHash: (chunks) => conversationContentHash(chunks) + (exact(chunks) ? "" : tag),
		accepts: (stored, chunks) => {
			const plain = conversationContentHash(chunks);
			return stored === plain || stored === plain + tag;
		},
	};
}

/** The one reuse decision both index services make: keep the stored row's hash
 *  when this device accepts it, otherwise the hash a fresh embed would carry. */
export function resolveRowHash(policy: HashPolicy, stored: string | undefined, chunks: string[]): { hash: string; reuse: boolean } {
	if (stored !== undefined && policy.accepts(stored, chunks)) return { hash: stored, reuse: true };
	return { hash: policy.rowHash(chunks), reuse: false };
}
