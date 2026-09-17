// Types for the test suite; the script itself is plain ESM JavaScript.
export interface UpstreamCost { input: number; output: number; cache_read?: number; cache_write?: number }
export interface UpstreamModel { cost?: UpstreamCost }
export type Upstream = Record<string, { models?: Record<string, UpstreamModel> }>;
export interface CatalogRow { id: string; provider: string }
export interface TableRow { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export const SOURCE_URL: string;
export const UPSTREAM_PROVIDERS: Record<string, string>;
export const UPSTREAM_IDS: Record<string, string>;
export const NO_UPSTREAM: Set<string>;
export function readCommittedTable(source: string): Record<string, TableRow>;
export function readCatalog(source: string): CatalogRow[];
export function buildTable(upstream: unknown, catalog: CatalogRow[], ids?: Record<string, string>, noUpstream?: Set<string>): Record<string, TableRow>;
/** Formats one price for emission into the generated block, and refuses
 *  anything that is not a usable number — `unknown` on purpose, because the
 *  point of the guard is that the caller cannot promise what upstream sent. */
export function fmt(n: unknown): string;
export function renderTable(table: Record<string, TableRow>, catalog: CatalogRow[], asOf: string): string;
export function spliceGenerated(source: string, block: string): string;
