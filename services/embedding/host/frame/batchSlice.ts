// Splitting one pooled feature-extraction result into per-input vectors.
//
// Lives apart from `model.ts` so it can be unit-tested: `model.ts` imports
// @huggingface/transformers at module scope, which no test environment can load.

/**
 * Cut a batched pipeline result into `count` vectors of equal width.
 *
 * `dims` is the tensor shape — `[batch, dim]` for a pooled batch, and possibly
 * `[dim]` or `[1, dim]` for a single input, so the width is read off the tail
 * either way.
 *
 * Throws when the result is too short for the batch. Slicing past the end
 * silently yields zero-length vectors, which survive quantization and only fail
 * at `serializeIndex` as `chunk dim 0 != 384` — an error naming neither the
 * batch nor the model.
 */
export function sliceBatch(data: Float32Array, dims: number[], count: number): Float32Array[] {
	const dim = dims[dims.length - 1];
	if (!dim || dim < 1 || data.length < count * dim) {
		throw new Error(`embed: batch of ${count} returned ${data.length} values at dim ${dim}`);
	}
	return Array.from({ length: count }, (_, i) => data.slice(i * dim, (i + 1) * dim));
}
