import { Setting, type ButtonComponent } from "obsidian";
import { t } from "../i18n";
import { buildNowEnabled, describeVaultIndexStatus, type VaultIndexStatus } from "../services/embedding/indexStatus";

/** What the status row needs from the plugin — narrow, so a test can hand it a fake. */
export interface VaultIndexStatusSource {
	vaultIndexStatus(): Promise<VaultIndexStatus>;
	/** Subscribe to status changes; returns the unsubscribe. */
	onVaultIndexChange(listener: () => void): () => void;
	buildVaultIndexNow(): void;
	reindexVault(): Promise<void>;
}

/**
 * The "Index status" row in settings (ADR-199): a headline naming the state and
 * what to do about it, a detail line (model · engine · default), and two actions —
 * "Build now" finishes or updates the index keeping its rows, "Rebuild index"
 * starts over.
 *
 * Live: it follows the build through `onVaultIndexChange`. The settings tab has
 * no teardown hook that runs on every re-render, so the row unsubscribes itself
 * the first time it is told about a change after it has left the DOM.
 *
 * Returns `refresh`, for the controls above it whose change the status reflects
 * (the default toggle, the model).
 */
export function renderVaultIndexStatus(containerEl: HTMLElement, source: VaultIndexStatusSource): () => void {
	const row = new Setting(containerEl).setName(t("vaultIndexStatusName"));
	let buildNow: ButtonComponent | null = null;
	row.addButton((btn) => {
		buildNow = btn;
		btn.setButtonText(t("vaultIndexBuildNow"))
			.setTooltip(t("vaultIndexBuildNowTooltip"))
			.onClick(() => { source.buildVaultIndexNow(); void refresh(); });
	});
	row.addButton((btn) =>
		btn.setButtonText(t("vaultContextReindexBtn"))
			.setTooltip(t("vaultIndexRebuildTooltip"))
			.onClick(() => { void source.reindexVault().then(refresh); })
	);

	// Status reads are async (a header read on first open); a slow one must never
	// overwrite a newer one, so only the latest request may paint.
	let latest = 0;
	const refresh = async (): Promise<void> => {
		const ticket = ++latest;
		let status: VaultIndexStatus;
		try {
			status = await source.vaultIndexStatus();
		} catch (e) {
			console.warn("[Pythia] settings: could not read the vault index status", e);
			return;
		}
		if (ticket !== latest) return;
		const { headline, detail } = describeVaultIndexStatus(status);
		row.setDesc(statusFragment(headline, detail));
		buildNow?.setDisabled(!buildNowEnabled(status));
	};

	const unsubscribe = source.onVaultIndexChange(() => {
		if (!row.settingEl.isConnected) { unsubscribe(); return; }
		void refresh();
	});
	void refresh();
	return () => { void refresh(); };
}

function statusFragment(headline: string, detail: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const head = document.createElement("div");
	head.className = "p-index-status-headline";
	head.textContent = headline;
	const sub = document.createElement("div");
	sub.className = "p-index-status-detail";
	sub.textContent = detail;
	frag.append(head, sub);
	return frag;
}
