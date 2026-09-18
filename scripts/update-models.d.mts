// Types for the test suite; the script itself is plain ESM JavaScript.
export interface CatalogDetail { id: string; provider: string; contextWindow: number; hidden: boolean }
export interface WindowChange { id: string; from: number; to: number }
export interface NewModel { id: string; provider: string; releaseDate: string; row: any }
export function readCatalogDetails(source: string): CatalogDetail[];
/** `unknown` on purpose: the point of the guard is that the caller cannot
 *  promise what upstream sent. */
export function formatWindow(n: unknown): string;
export function syncContextWindows(source: string, upstream: unknown, catalog: CatalogDetail[], ids?: Record<string, string>, noUpstream?: Set<string>): { source: string; changes: WindowChange[] };
export function findDeprecated(upstream: unknown, catalog: CatalogDetail[], ids?: Record<string, string>, noUpstream?: Set<string>): { id: string; provider: string }[];
export function findNewModels(upstream: unknown, catalog: CatalogDetail[], ids?: Record<string, string>, noUpstream?: Set<string>): NewModel[];
export function suggestRow(model: NewModel): string;
export function renderReport(input: { newModels: NewModel[]; deprecated: { id: string; provider: string }[]; asOf: string }): string;
