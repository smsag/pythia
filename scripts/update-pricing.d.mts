// Types for the test suite; the script itself is plain ESM JavaScript.
export interface UpstreamCost { input: number; output: number; cache_read?: number; cache_write?: number }
export interface UpstreamModel { cost?: UpstreamCost }
export type Upstream = Record<string, { models?: Record<string, UpstreamModel> }>;
import type { CatalogRow } from "./modelsDev.mjs";
export type { CatalogRow };
export interface TableRow { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export { SOURCE_URL, UPSTREAM_PROVIDERS, UPSTREAM_IDS, NO_UPSTREAM, readCatalog } from "./modelsDev.mjs";
export function readCommittedTable(source: string): Record<string, TableRow>;
export function buildTable(upstream: unknown, catalog: CatalogRow[], ids?: Record<string, string>, noUpstream?: Set<string>): Record<string, TableRow>;
/** Formats one price for emission into the generated block, and refuses
 *  anything that is not a usable number — `unknown` on purpose, because the
 *  point of the guard is that the caller cannot promise what upstream sent. */
export function fmt(n: unknown): string;
export function renderTable(table: Record<string, TableRow>, catalog: CatalogRow[], asOf: string): string;
export function spliceGenerated(source: string, block: string): string;
