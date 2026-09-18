import { Notice, Platform } from "obsidian";
import type { Conversation, Provider } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { abbreviateModel } from "../models/knownModels";
import { MODEL_PROFILE, profileLine, tierDots } from "../models/modelGuidance";
import { recommendModel, type Difficulty } from "../services/modelRecommendation";
import { debugLog, estimateTokensFromText } from "../services/messageUtils";
import { t, getLang } from "../i18n";

export interface ModelSuggestionDeps {
	getSettings(): PythiaSettings;
	getConversation(): Conversation | null;
	hasApiKeyFor(provider: Provider): boolean;
	registerDomEvent(el: HTMLElement, type: "click", cb: () => void): void;
}

interface Offer {
	conversationId: string;
	provider: Provider;
	model: string;
	accepted: boolean;
}

/**
 * The chip beside Send that carries the prompt optimizer's model suggestion
 * (ADR-181). The rule lives in `services/modelRecommendation.ts`; this owns
 * the chip, the offer and the one-send layer.
 *
 * - **Offered, never applied.** The chip reads `→ GPT-5.4 mini`; one tap
 *   accepts, a second tap withdraws. Sending without accepting drops the offer.
 * - **One send.** An accepted model shapes the next answer and is then spent,
 *   like an armed template (ADR-177). The conversation's own model is never
 *   written, so "follows the default" stays true.
 * - **Kept in memory, not on the conversation.** An offer is about the prompt in
 *   the box right now; it does not survive a conversation switch or a reload.
 */
export class ModelSuggestionController {
	private el!: HTMLButtonElement;
	private offer: Offer | null = null;

	constructor(private readonly d: ModelSuggestionDeps) {}

	mount(toolbar: HTMLElement): void {
		this.el = toolbar.createEl("button", { cls: "p-model-hint" });
		this.el.style.display = "none";
		this.d.registerDomEvent(this.el, "click", () => this.toggle());
	}

	/** Called with the optimizer's rating. Replaces any earlier offer. */
	consider(difficulty: Difficulty | null): void {
		const settings = this.d.getSettings();
		const conv = this.d.getConversation();
		this.offer = null;
		if (!conv || !settings.optimizerSuggestsModel) return this.render();
		if (difficulty === null) {
			// Not a failure the user needs to hear about — the prompt was still
			// optimized; the model just left out (or garbled) the rating line.
			debugLog(settings, "model suggestion: no DIFFICULTY line in the optimizer reply");
			return this.render();
		}
		const provider = settings.defaultProvider;
		if (!this.d.hasApiKeyFor(provider)) return this.render();

		const notes = [...(conv.contextNotes ?? []), ...(conv.pendingTemplate?.contextNotes ?? [])];
		const model = recommendModel({
			difficulty,
			provider,
			currentProvider: conv.pendingTemplate?.provider ?? conv.provider,
			currentModel: conv.pendingTemplate?.model ?? conv.model,
			historyTokens: conv.messages.reduce((sum, m) => sum + estimateTokensFromText(m.content), 0),
			contextNoteCount: new Set(notes).size,
			researchMode: conv.researchMode === true,
			hasPdf: notes.some((p) => p.toLowerCase().endsWith(".pdf")),
			templatePinsModel: conv.pendingTemplate?.model !== undefined,
		});
		debugLog(settings, "model suggestion:", difficulty, "→", model ?? "(none)");
		if (model) this.offer = { conversationId: conv.id, provider, model, accepted: false };
		this.render();
	}

	/** The conversation as the next send should see it: the accepted model
	 *  layered over a clone. Never mutates; unchanged when nothing is accepted. */
	layer(conv: Conversation): Conversation {
		const o = this.offer;
		if (!o?.accepted || o.conversationId !== conv.id) return conv;
		return { ...conv, provider: o.provider, model: o.model };
	}

	/** A send went out. An offer nobody accepted was about that prompt — gone. */
	sent(): void {
		if (this.offer && !this.offer.accepted) this.clear();
	}

	/** The answer committed: an accepted model is spent. Kept on an errored or
	 *  empty reply, so the retry is the same shape (as ADR-177). */
	spent(conversationId: string): void {
		if (this.offer?.conversationId === conversationId) this.clear();
	}

	/** Conversation switch, view teardown, setting turned off. */
	clear(): void {
		this.offer = null;
		this.render();
	}

	private toggle(): void {
		if (!this.offer) return;
		this.offer.accepted = !this.offer.accepted;
		this.render();
		if (this.offer.accepted && Platform.isMobile) {
			new Notice(t("modelHintAccepted", { model: abbreviateModel(this.offer.model) }), 4000);
		}
	}

	private render(): void {
		if (!this.el) return;
		const o = this.offer;
		const conv = this.d.getConversation();
		if (!o || !conv || o.conversationId !== conv.id) {
			this.el.style.display = "none";
			return;
		}
		const name = abbreviateModel(o.model);
		this.el.style.display = "";
		this.el.toggleClass("is-accepted", o.accepted);
		this.el.empty();
		this.el.createSpan({ text: o.accepted ? name : `→ ${name}` });
		// The cost as a tier, never dollars: ADR-163 removed the next-send
		// estimate, and a tier is what the model rows already show.
		const cost = MODEL_PROFILE[o.model]?.cost;
		if (cost) this.el.createSpan({ cls: "p-model-hint-cost", text: tierDots(cost) });
		const profile = profileLine(o.model, getLang());
		const text = o.accepted
			? t("modelHintAcceptedTooltip", { model: name })
			: t("modelHintTooltip", { model: name });
		this.el.setAttribute("aria-label", text);
		this.el.setAttribute("aria-pressed", String(o.accepted));
		this.el.setAttribute("title", profile ? `${text}\n${profile}` : text);
	}
}
