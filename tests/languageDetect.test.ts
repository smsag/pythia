import { describe, it, expect } from "vitest";
import { detectLanguage } from "../services/languageDetect";

// ADR-166: the glossary decides what language an answer and a stored definition
// are in without a model call. Wrong is worse than unknown, so the tests pin
// both the calls it must make and the ones it must refuse.

describe("detectLanguage", () => {
	it("recognises an answer in each of the dropdown's languages", () => {
		expect(detectLanguage("Der Zähler wird monatlich abgelesen, und danach folgt die Abrechnung für das Jahr.")).toBe("de");
		expect(detectLanguage("The counter is read every month, and the bill for the year is based on it.")).toBe("en");
		expect(detectLanguage("Il contatore viene letto ogni mese e la bolletta per l'anno si basa su questo.")).toBe("it");
		expect(detectLanguage("El contador se lee cada mes y la factura del año se basa en esta lectura.")).toBe("es");
	});

	it("recognises French, Portuguese and Dutch too", () => {
		expect(detectLanguage("Le compteur est relevé chaque mois et la facture de l'année est calculée sur cette base.")).toBe("fr");
		expect(detectLanguage("O contador é lido todos os meses e a fatura do ano é calculada com base nisso.")).toBe("pt");
		expect(detectLanguage("De meter wordt elke maand afgelezen en de rekening voor het jaar is daarop gebaseerd.")).toBe("nl");
	});

	it("calls a short German definition German although 'das' is also Portuguese", () => {
		expect(detectLanguage("Ein Gerät, das diskrete Ereignisse erfasst.")).toBe("de");
	});

	it("keeps a German answer German when it quotes an English phrase", () => {
		expect(detectLanguage("Der Begriff „state of the art“ wird im Deutschen oft für den Stand der Technik verwendet, und das ist auch hier gemeint.")).toBe("de");
	});

	it("refuses to call a text too short or too mixed to tell", () => {
		expect(detectLanguage("")).toBeNull();
		expect(detectLanguage("Zähler")).toBeNull();
		expect(detectLanguage("the Zähler der counter")).toBeNull();
	});
});
