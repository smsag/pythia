// Types for the test suite; the module itself is plain ESM JavaScript.
export interface CatalogRow { id: string; provider: string }
export const SOURCE_URL: string;
export const UPSTREAM_PROVIDERS: Record<string, string>;
export const UPSTREAM_IDS: Record<string, string>;
export const NO_UPSTREAM: Set<string>;
export function readCatalog(source: string): CatalogRow[];
export function upstreamModels(upstream: unknown, provider: string): Record<string, unknown>;
export function upstreamId(id: string, ids?: Record<string, string>): string;
export function nearbyIds(models: Record<string, unknown>, id: string): string[];
export function fetchUpstream(): Promise<unknown>;
