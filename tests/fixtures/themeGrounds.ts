/**
 * The ground a Pythia panel actually sits on, in the themes we can measure.
 *
 * `.p-history` paints `--background-primary`, so that is the colour a rule
 * drawn on the search row has to stand clear of. A plugin cannot know what a
 * theme will set it to, and this file does not pretend otherwise: it is the
 * evidence behind the two percentages in `styles.css`, not a claim about every
 * theme. Read in Obsidian 1.13.7 over the debugging port, the same way
 * `obsidianButtonRules.ts` was.
 *
 * Klartext is here because it is the theme this plugin is developed against
 * and because it is the BINDING case in both modes — its text is softer than
 * Obsidian's, so a mix of --text-normal lands paler and needs more of it.
 */
export const GROUNDS_MEASURED_IN = "Obsidian 1.13.7";

export interface ThemeGround {
	/** `--background-primary` — what `.p-history` paints. */
	background: string;
	/** `--text-normal` — what the rule is mixed from. */
	text: string;
}

export const THEME_GROUNDS: Record<"light" | "dark", Record<string, ThemeGround>> = {
	light: {
		"Obsidian default": { background: "#ffffff", text: "#222222" },
		Klartext: { background: "#ffffff", text: "#333333" },
	},
	dark: {
		"Obsidian default": { background: "#1C1C1C", text: "#dadada" },
		Klartext: { background: "#1a1a1a", text: "#d4d4d0" },
	},
};

/** WCAG 2.2, 1.4.11: the boundary of a user-interface component. */
export const UI_BOUNDARY_CONTRAST = 3;
