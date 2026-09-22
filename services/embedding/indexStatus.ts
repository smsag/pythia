// What the settings tab says about the vault index (ADR-199). Pure: the service
// gathers the facts, this decides the words, and a test pins every state.
//
// The status used to be one string set as a side effect of the build, so the tab
// showed "Idle — the index builds on first use." for an index that was complete
// on disk and simply not loaded yet, and said nothing at all about a build that
// had been killed. Each state below is a distinct thing the user can act on.

import { t } from "../../i18n";
import { embeddingModelConfig, type EmbeddingModelId } from "../../models/embeddingModels";
import { foregroundDeaths, type BuildMarker } from "./buildGuard";

export type VaultIndexState =
	| "notBuilt"   // no usable file for this model
	| "loading"    // the model is downloading / loading, before the first note
	| "building"   // a build is running in this session
	| "ready"      // complete, under the current scope
	| "partial"    // rows on disk, the build that wrote them never finished
	| "outdated"   // complete, but for folders / limits that changed since
	| "failed"     // the last build in this session threw
	| "paused";    // builds kept dying; waits for the user (buildGuard)

export interface VaultIndexStatus {
	state: VaultIndexState;
	/** Indexed notes (ready / partial / outdated). */
	count: number;
	/** Progress while building. */
	done: number;
	total: number;
	/** The failure, verbatim, when `state === "failed"`. */
	error: string | null;
	outOfMemory: boolean;
	/** The interrupted-build record behind `paused`. */
	marker: BuildMarker | null;
	/** Which backend runs the model, once a build has resolved it. */
	backend: string | null;
	/** The model this device embeds with (see `effectiveEmbeddingModel`). */
	modelId: EmbeddingModelId;
	/** True when that is not the model the setting names — a phone. */
	modelSubstituted: boolean;
	/** The global default; a conversation can still switch vault context on. */
	enabledByDefault: boolean;
}

/** What a persisted file means under today's scope. */
export function stateFromFile(
	file: { count: number; complete: boolean; scope: string } | null,
	scope: string,
): "notBuilt" | "ready" | "partial" | "outdated" {
	if (!file || file.count === 0) return "notBuilt";
	if (!file.complete) return "partial";
	return file.scope === scope ? "ready" : "outdated";
}

/** Whether "Build now" has something to do — everything short of a live or finished build. */
export function canBuildNow(state: VaultIndexState): boolean {
	return state !== "loading" && state !== "building" && state !== "ready";
}

export function describeVaultIndexStatus(s: VaultIndexStatus): { headline: string; detail: string } {
	const model = embeddingModelConfig(s.modelId).label;
	const detail = [
		s.modelSubstituted ? t("vaultIndexDetailModelMobile", { model }) : t("vaultIndexDetailModel", { model }),
		s.backend ? t("vaultIndexBackend", { backend: s.backend }) : null,
		s.enabledByDefault ? null : t("vaultIndexDetailOff"),
	].filter(Boolean).join(" · ");
	return { headline: headline(s), detail };
}

function headline(s: VaultIndexStatus): string {
	switch (s.state) {
		case "loading":
			return t("vaultIndexStateLoading", { mb: embeddingModelConfig(s.modelId).downloadMb });
		case "building":
			return t("vaultIndexStateBuilding", { done: s.done, total: s.total });
		case "ready":
			return t("vaultIndexStateReady", { count: s.count });
		case "partial":
			return t("vaultIndexStatePartial", { count: s.count });
		case "outdated":
			return t("vaultIndexStateOutdated");
		case "failed":
			return s.outOfMemory
				? t("vaultIndexStateOutOfMemory")
				: t("vaultIndexStateFailed", { error: s.error ?? "?" });
		case "paused":
			return t("vaultIndexStatePaused", { count: foregroundDeaths(s.marker) });
		case "notBuilt":
			return t("vaultIndexStateNotBuilt");
	}
}
