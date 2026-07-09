import { App, Notice, SuggestModal } from "obsidian";
import { t } from "../i18n";

export interface HubCommand {
	label: string;
	desc: string;
	action: () => void;
}

export class CommandHubModal extends SuggestModal<HubCommand> {
	private commands: HubCommand[];

	constructor(app: App, commands: HubCommand[]) {
		super(app);
		this.commands = commands;
		this.setPlaceholder(t("searchHub"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrSelect") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getSuggestions(query: string): HubCommand[] {
		const q = query.toLowerCase();
		if (!q) return this.commands;
		return this.commands.filter(
			(c) =>
				c.label.toLowerCase().includes(q) ||
				c.desc.toLowerCase().includes(q)
		);
	}

	renderSuggestion(item: HubCommand, el: HTMLElement): void {
		el.createEl("div", { text: item.label, cls: "pythia-hub-label" });
		el.createEl("div", { text: item.desc,  cls: "pythia-hub-desc"  });
	}

	onChooseSuggestion(item: HubCommand): void {
		// item.action() may be an async fn (assignable to () => void) — catch
		// rejections here so no command can fail completely silently.
		Promise.resolve(item.action()).catch((e) => {
			console.error("[Pythia] command failed:", e);
			new Notice(t("commandFailed", { error: e instanceof Error ? e.message : String(e) }));
		});
	}
}
