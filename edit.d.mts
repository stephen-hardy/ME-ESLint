/**
 * Ensures the cache directory exists and returns its path.
 */
declare function getCacheDir(): Promise<string>;

/**
 * Saves content to a cache file in the system temp directory.
 */
declare function saveTemp(file: string, content: string): Promise<void>;

/**
 * Reads a cache file from the system temp directory.
 */
declare function getTemp(file: string): Promise<string | null>;

/**
 * Fetches a URL, strips multi-line comments, and saves it to the cache.
 */
declare function fetchAndCache(url: string, cacheFile: string): Promise<{ stripped: string; rawLength: number }>;

/**
 * Attempts to load and parse a cached JSON string. If successful, triggers a background revalidation.
 */
declare function getCache(url: string, cacheFile: string, logURL: string): Promise<Record<string, any> | null>;

/**
 * Fetches and parses a JSON file (stripping multi-line comments), prioritizing the cache.
 */
declare function getJson(url: string): Promise<Record<string, any>>;

/**
 * Wrapper around getJson for the configured GitHub repository.
 */
declare function git(file: string): Promise<Record<string, any>>;

/**
 * Tries to import a module locally, falling back to the global npm directory.
 */
declare function importFallback(specifier: string): Promise<any>;

/**
 * Detects if the current environment is for a browser/Cloudflare ('browser') or standard Node ('nodeBuiltin').
 */
declare function detectEnv(): Promise<'browser' | 'nodeBuiltin'>;

/**
 * The unified ESLint configuration array.
 */
declare const cfg: any[];
export default cfg;
