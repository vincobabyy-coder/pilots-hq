// core/constants.ts
// Shared platform constants — single source of truth for values used across multiple files

/** Default page size for list endpoints */
export const DEFAULT_PAGE_LIMIT = 20

/** Maximum allowed page size for list endpoints */
export const MAX_PAGE_LIMIT = 100

/** Earth radius in km (WGS-84 mean) — used for haversine calculations */
export const EARTH_RADIUS_KM = 6371

/** Redis sentinel default port */
export const REDIS_SENTINEL_DEFAULT_PORT = 26379

/** HSTS max-age (1 year in seconds) */
export const HSTS_MAX_AGE_SECONDS = 31_536_000
