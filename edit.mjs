// --- CONFIGURATION & GLOBAL STATE ---
const eTag = '', // Tracks the currently installed version hash for the self-update mechanism to avoid unnecessary file writes
	gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/ME-ESLint/refs/heads/main/', // Defines the single source of truth for remote rulesets, centralizing rule management across projects
	npmGlobalCached = await getTemp('npmGlobal.txt'), // Caching avoids the ~500ms+ penalty of shelling out to npm on every ESLint run
	npmGlobal = npmGlobalCached ? npmGlobalCached.trim() : await (async () => { // OS-agnostic way to find global modules, as paths differ between Windows/macOS/Linux
		// [Risk 6] `npm root -g` Overhead & Global Assumption
		try {
			const { exec } = await import('node:child_process'), // Required to execute the shell command since Node has no built-in API for npm's config
				{ stdout, stderr, error } = await new Promise(resolve => { // Promisify the callback-based exec to fit cleanly into the async init flow
					exec('npm root -g', (execError, execStdout, execStderr) => { // Asks npm where its global modules live, critical for fallback module resolution
						resolve({ error: execError, stdout: execStdout, stderr: execStderr }); // Bundle all outputs so we can handle both success and failure in one place
					});
				});
			if (stderr || error) { throw new Error(stderr || error); } // Fail fast on errors so we can fallback to local-only resolution instead of crashing

			const trimmed = stdout.trim(); // stdout inherently includes trailing newlines (\n) from shell execution, which breaks file paths
			await saveTemp('npmGlobal.txt', trimmed); // Persist the discovered path so IDE on-save linting remains snappy
			console.info(`npmGlobal (cli) = ${trimmed}`); // Provide transparency into what global path was discovered for debugging
			return trimmed; // Expose the clean path to the rest of the script
		}
		catch (err) {
			console.error('Unable to get npmGlobal', err); // Log but don't throw, allowing the linter to limp along with local dependencies
			return ''; // Empty string ensures we cleanly skip global resolution attempts later instead of throwing undefined errors
		}
	})();

if (npmGlobalCached) { console.info(`npmGlobal (cached) = ${npmGlobal}`); } // Verifies the cache is actually being hit for performance debugging

// --- UTILITIES ---
let cacheDirPromise = null; // Singleton prevents a race condition where multiple async calls try to create the cache dir simultaneously
async function getCacheDir() { // Encapsulates the directory path logic so we only compute and create it once per execution
	if (cacheDirPromise) { return cacheDirPromise; } // Return existing promise to ensure we don't duplicate fs operations
	cacheDirPromise = Promise.all([import('node:fs/promises'), import('node:os'), import('node:path')]).then(async ([fs, os, path]) => { // Lazy-load modules only when cache is first needed to speed up initial boot
		const dir = path.join(os.homedir(), '.cache', 'sh-eslint'); // Use home directory instead of OS temp to persist across reboots, and instead of project dir to avoid cluttering git
		await fs.mkdir(dir, { recursive: true }).catch(() => false); // Ensure the folder exists, ignoring errors (like it already existing) to avoid crashes
		return dir; // Provide the resolved path back to the caller
	});
	return cacheDirPromise; // Fulfill the singleton promise
}

async function saveTemp(file, content) { // Centralized function for writing cache files to ensure consistent atomic writes
	const [fs, path, crypto] = await Promise.all([import('node:fs/promises'), import('node:path'), import('node:crypto')]), // Lazy load fs, path, and crypto for performance
		dir = await getCacheDir(), // Ensure the destination directory exists before we try to write
		filePath = path.join(dir, file), // Construct the final destination path
		tempPath = filePath + '.tmp' + crypto.randomBytes(8).toString('hex'); // Use crypto for a random suffix to prevent collisions if multiple ESLint processes run simultaneously

	try {
		await fs.writeFile(tempPath, content); // Write to a temp file first to prevent corruption if the process crashes mid-write
		await fs.rename(tempPath, filePath); // Atomic rename ensures any reader only ever sees the complete file, never a partial one
	}
	catch (err) { console.warn(`\x1b[33m[WARNING]\x1b[0m Failed to save cache file ${filePath}:`, err.message); } // Non-fatal error; failure to cache shouldn't break the linter
}

async function getTemp(file) { // Centralized function for reading cache files
	const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]), // Lazy load modules to keep initial boot fast
		dir = await getCacheDir(), // Need to know where the cache lives
		filePath = path.join(dir, file); // Target specific cache file

	try { return await fs.readFile(filePath, 'utf8'); } // utf8 ensures we get a string back instead of a raw Buffer
	catch { return null; } // Catch errors (like file not found) and return null so the caller knows it needs to fetch fresh data
}

async function fetchAndCache(url, cacheFile) { // Handles network requests and ensures the result is always saved for next time
	// [Risk 13] Unauthenticated Rate Limiting (GitHub API IP Bans)
	const response = await fetch(url), // Native fetch is used to avoid external dependencies for network requests
		text = await response.text(), // Extract text because we are downloading raw JSON/JSONC files
		// [Risk 9] Brittle JSONC Parsing
		stripped = text.replaceAll(/\/\*[\s\S]*?\*\//g, ''); // We use a regex to strip comments because standard JSON.parse fails on JSONC, and adding a real parser dependency is too heavy

	saveTemp(cacheFile, stripped); // Save the sanitized string so we don't have to parse JSONC next time
	return { stripped, rawLength: text.length }; // Return the raw length for logging so we can see how much bandwidth we are using
}

async function getCache(url, cacheFile, logURL) { // Implements stale-while-revalidate caching to keep IDEs instantly responsive
	const cache = await getTemp(cacheFile); // Try to load from disk first
	if (!cache) { return null; } // Miss means we must fetch synchronously
	try {
		const parsed = JSON.parse(cache); // Convert the cached string back into an object
		console.info(`Loaded (json=cache): ${logURL} (len=${cache.length},type=${typeof parsed})`); // Verify cache hits visually in the console
		// [Risk 11] Event Loop Kept Alive by Background Caching
		fetchAndCache(url, cacheFile).catch(() => false); // Fire-and-forget background update so the NEXT run gets fresh data without blocking THIS run
		return parsed; // Immediately return the stale data to unblock the linter
	}
	catch { return null; } // If the cache is corrupted or empty, treat it as a miss
}

async function getJson(url) { // Main entrypoint for loading configuration JSONs, handling the cache/fetch priority
	const cacheFile = url.split('/').at(-1), // Use the filename from the URL as a simple unique key for the cache
		logURL = url.startsWith(gitRepo) ? '[git]' + url.slice(gitRepo.length - 1) : url, // Shorten GitHub URLs in the logs to reduce console spam
		cache = await getCache(url, cacheFile, logURL); // Attempt the fast path (disk cache) first

	if (cache) { return cache; } // If we got cached data, we are done

	// [Risk 8] Unpinned Remote Configurations
	try {
		const { stripped, rawLength } = await fetchAndCache(url, cacheFile), // Synchronously fetch if we had no cache
			parsed = JSON.parse(stripped); // Parse the stripped string into a JavaScript object for ESLint

		console.info(`Loaded (json=http): ${logURL} (len=${rawLength},type=${typeof parsed})`); // Log the slow path for performance debugging
		return parsed; // Return the fresh data
	}
	catch (err) {
		console.error(`\x1b[31m[ERROR]\x1b[0m Loading ${url} failed, falling back to empty object. (Lint results may be incomplete)`); // Warn the user their config is degraded
		console.error(err); // Provide the stack trace so they can debug network issues
		return {}; // Return empty object so ESLint doesn't crash entirely, allowing other valid rules to still run
	}
}

async function git(file) { return getJson(gitRepo + file); } // Syntactic sugar to make the core configuration array much easier to read

async function importFallback(specifier) { // Resolves plugins dynamically, trying local node_modules first, then global
	// [Risk 12] Fragile Deep Internal Imports
	try {
		const localModule = await import(specifier); // Always prefer local dependencies for project-specific pinning
		console.info(`Loaded (import=local): ${specifier} (keys: ${Object.keys(localModule)})`); // Log where it came from for debugging
		return localModule; // Success
	}
	catch {
		try {
			const globalModule = await import(`file://${npmGlobal}/${specifier}`); // Fallback to global allows zero-install linting across new projects
			console.info(`Loaded (import=global): ${specifier} (keys: ${Object.keys(globalModule)})`); // Log global fallback
			return globalModule; // Success
		}
		catch {
			console.error(`\x1b[31m[ERROR]\x1b[0m Failed to import: ${specifier}. (Ensure it's installed locally or globally via npm)`); // Warn about missing plugins
			return {}; // Return empty object so destructuring (e.g. { default: plugin }) doesn't crash the script
		}
	}
}

async function detectEnv() { // Heuristic to guess the project type so we inject the correct global variables
	// [Risk 10] Hardcoded Environment Detection
	const fs = await import('node:fs/promises'); // Lazy load fs
	try {
		await fs.access('wrangler.json'); // Cloudflare Workers use a specific config file; its presence is a strong signal
		return 'browser'; // Workers use browser-like globals (fetch, Request) rather than Node globals (process, Buffer)
	}
	catch { return 'nodeBuiltin'; } // If no specific environment is detected, default to standard Node.js globals
}

// --- CORE CONFIGURATION ---
const cfg = [ // The foundational ESLint config array that will be exported
	{
		files: ['**/*.js', '**/*.mjs'], // Apply these baseline rules to all standard JavaScript files
		languageOptions: {
			globals: { ...(await importFallback('globals/index.js')).default?.[await detectEnv()] } // Inject environment globals so ESLint doesn't complain about undefined variables
		},
		rules: await git('rules/javascript.jsonc'), // Load our centralized, remote JavaScript opinions
	},
];

// --- PLUGIN RESOLUTION ---
await Promise.all([ // Load all language plugins concurrently to minimize total startup time
	(async () => { // JSON Plugin Block
		const { default: json } = await importFallback('@eslint/json/dist/esm/index.js'); // Deep import bypasses module exports restrictions if needed
		if (!json) { return; } // Silently skip if not installed; degrades gracefully instead of crashing
		cfg.unshift({ plugins: { json } }); // Register plugin globally via unshift so it's available to all subsequent configs
		const rules = await git('rules/json.jsonc'); // Fetch our JSON opinions
		cfg.push({ files: ['**/*.json'], language: 'json/json', rules }); // Apply rules specifically to standard JSON
		cfg.push({ files: ['**/*.jsonc', '.vscode/*.json'], language: 'json/jsonc', rules }); // Apply relaxed rules (allowing comments) to JSONC files
	})(),
	(async () => { // Markdown Plugin Block
		const { default: markdown } = await importFallback('@eslint/markdown/dist/esm/index.js'); // Deep import for markdown plugin
		if (!markdown) { return; } // Silently degrade
		const rules = await git('rules/markdown.jsonc'); // Fetch Markdown opinions
		cfg.push({ files: ['**/*.md'], plugins: { markdown }, language: 'markdown/commonmark', rules }); // Bind the plugin and rules to .md files
	})(),
	(async () => { // CSS Plugin Block
		const { default: css } = await importFallback('@eslint/css/dist/index.js'); // Deep import for CSS plugin
		if (!css) { return; } // Silently degrade
		const rules = await git('rules/css.jsonc'); // Fetch CSS opinions
		if (rules['css/require-baseline'] && !css.rules['require-baseline'] && css.rules['use-baseline']) { // Handle upstream breaking changes dynamically
			rules['css/use-baseline'] = rules['css/require-baseline']; // Migrate deprecated rule to new name to avoid ESLint crashes on newer plugin versions
			delete rules['css/require-baseline']; // Clean up the old rule
		}
		cfg.push({ files: ['**/*.css'], plugins: { css }, language: 'css/css', rules }); // Bind plugin and rules to .css files
	})(),
	(async () => { // HTML Plugin Block
		const { default: html } = await importFallback('@html-eslint/eslint-plugin/lib/index.js'); // Deep import for HTML plugin
		if (!html) { return; } // Silently degrade
		const rules = await git('rules/html.jsonc'), // Fetch HTML opinions
			{ default: parser } = await importFallback('@html-eslint/parser/lib/index.js'); // HTML linting requires a specific custom parser

		cfg.push({ // Bind plugin, parser, and rules to .html files
			files: ['**/*.html'], rules, plugins: { '@html-eslint': html }, // Standard bindings
			languageOptions: { parser }, // Inject the custom parser specifically for HTML processing
		});
	})()
]);

export default cfg; // Provide the resolved, dynamic configuration to ESLint

// --- SELF-UPDATE MECHANISM ---
// [Risk 7] Security & Reproducible Builds (Self-Update)
if (process.argv[1] === import.meta.filename) { // Ensures update logic ONLY runs when manually executed (node edit.mjs), preventing drive-by updates during linting
	try {
		const response = await fetch(gitRepo + 'eslint.config.mjs'), // Fetch the master copy of this very script
			newETag = response.headers.get('eTag'); // Use the server's ETag to cheaply check for changes without comparing full bodies

		if (eTag === newETag) { console.info('config.mjs: template up-to-date'); } // Skip write if identical to save disk I/O
		else {
			console.info('config.mjs: update template to ' + newETag); // Notify user an update is occurring
			const text = await response.text(), // Read the new source code
				{ writeFile } = await import('node:fs/promises'); // Lazy load fs

			await writeFile(import.meta.filename, text.replace(/eTag = '.+/, `eTag = '${newETag}',`)); // Overwrite ourselves, injecting the new ETag so we don't endlessly update
		}
	}
	catch (err) { console.error('Failed to self-update:', err); } // Catch network/fs errors so the manual run doesn't exit with an ugly stack trace
}