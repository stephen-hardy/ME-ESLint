const eTag = '',
	gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/ME-ESLint/refs/heads/main/', // PUBLIC github repository containing JSONC files we will pull/cache, to be incorporated in the default export array
	npmGlobalCached = await getTemp('npmGlobal.txt'),
	npmGlobal = npmGlobalCached ? npmGlobalCached.trim() : await import('node:child_process')
		.then(({ exec }) => new Promise(res => exec('npm root -g', (error, stdout, stderr) => res({ error, stdout, stderr }))))
		.then(({ stdout, stderr, error }) => {
			if (stderr || error) { throw new Error(stderr || error); }
			const trimmed = stdout.trim();
			saveTemp('npmGlobal.txt', trimmed);
			console.info(`npmGlobal (cli) = ${trimmed}`);
			return trimmed;
		})
		.catch(err => console.error('Unable to get npmGlobal', err));

	if (npmGlobalCached) { console.info(`npmGlobal (cached) = ${npmGlobal}`); }

// UTILITIES: git(), importFallback(), getJson(), saveTemp(), getTemp()
	async function getCacheDir() {
		const [fs, os, path] = await Promise.all([import('node:fs/promises'), import('node:os'), import('node:path')]),
			dir = path.join(os.tmpdir(), `sh-eslint-${os.userInfo().username}`);
		await fs.mkdir(dir, { recursive: true }).catch(() => false);
		return dir;
	}
	async function saveTemp(file, content) { // cache specified content into a file of specified name, in an OS temp folder
		const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]),
			dir = await getCacheDir(),
			filePath = path.join(dir, file);
		await fs.writeFile(filePath, content).catch(() => false);
		// console.log(`ToCache: ${filePath}`);
	}
	async function getTemp(file) { // read specified file from OS temp folder
		const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]),
			dir = await getCacheDir(),
			filePath = path.join(dir, file);
		return fs.readFile(filePath, 'utf8').catch(() => null);
	}
	async function fetchAndCache(url, cacheFile) {
		const r = await fetch(url),
			t = await r.text(),
			stripped = t.replaceAll(/\/\*.*?\*\//g, '');
		saveTemp(cacheFile, stripped);
		return { stripped, rawLength: t.length };
	}
	async function getCache(url, cacheFile, logURL) {
		const cache = await getTemp(cacheFile);
		if (!cache) { return null; }
		try {
			const parsed = JSON.parse(cache);
			console.info(`Loaded (json=cache): ${logURL} (len=${cache.length},type=${typeof parsed})`);
			// Background update (Stale-While-Revalidate)
			fetchAndCache(url, cacheFile).catch(() => false);
			return parsed;
		}
		catch {
			return null;
		}
	}
	async function getJson(url) { // fetch url, strip multi-line comments (syntax), return parsed JSON
		const cacheFile = url.split('/').at(-1), logURL = url.startsWith(gitRepo) ? '[git]' + url.slice(gitRepo.length - 1) : url,
			cache = await getCache(url, cacheFile, logURL);

		if (cache) { return cache; }

		try {
			const { stripped, rawLength } = await fetchAndCache(url, cacheFile),
				parsed = JSON.parse(stripped); // remove ONLY multi-line comment syntax - cheap substitute for actual JSONC support, that doesn't require a dependency
			console.info(`Loaded (json=http): ${logURL} (len=${rawLength},type=${typeof parsed})`);
			return parsed;
		}
		catch (err) {
			process.exitCode = 1;
			console.error(`\x1b[31m[ERROR]\x1b[0m Loading ${url} failed, falling back to empty object. (Lint results may be incomplete)`);
			console.error(err);
			return {}; // if there is an error, return an empty object in hopes that linting might continue
		}
	} // NOTE: because single-line comment syntax ("//") is not uncommonly used outside of comments (ex: https://...), it isn't practical to strip those without a dedicated parser. Part of the goal with global eslint and web-hosted rules is to minimize setup and file duplication. Therefore, adding a JSONC parser dependency just to support single-line syntax - when we can get multi-line syntax cheaply - doesn't make a lot of sense
	async function git(file) { return getJson(gitRepo + file); }
	async function importFallback(x) { // try to import a module locally, falling back to the npm global directory if not found. NOTE: this bypasses standard Node resolution and assumes npm is the global package manager.
		return import(x)
			.then(m => console.info(`Loaded (import=local): ${x} (keys: ${Object.keys(m)})`) || m)
			.catch(_ => import(`file://${npmGlobal}/${x}`)) // try import under the npm global directory
			.then(m => console.info(`Loaded (import=global): ${x} (keys: ${Object.keys(m)})`) || m)
			.catch(_ => { // local and global import failed. Log an error, suggesting an npm (global) install, but return empty objects in the hope that linting might continue
				process.exitCode = 1;
				console.error(`\x1b[31m[ERROR]\x1b[0m Failed to import: ${x}. (Ensure it's installed locally or globally via npm)`);
				return {}; // JavaScript linting should not require an import (just JSONC rules). And, if there is failure to import a dependency for linting non-JavaScript, that should not prevent JS linting from working. Always try to show what you can show, and error for notifications
			});
	}
	async function detectEnv() {
		const fs = await import('node:fs/promises');
		try {
			await fs.access('wrangler.json');
			return 'browser';
		}
		catch {
			return 'nodeBuiltin';
		}
	}
const cfg = [
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: {
			globals: { ...(await importFallback('globals/index.js')).default?.[await detectEnv()] }
		},
		rules: await git('rules/javascript.jsonc'),
	},
	// {
	//	files: ['src/**/*', 'test/**/*'],
	//	rules: {
	//		semi: ['warn', 'always']
	//	}
	// },
];
// plugins
	await importFallback('@eslint/json/dist/esm/index.js').then(async ({ default: json }) => { // don't use a "normal" import statement because it doesn't fallback to global, and will tank the whole process if unfound. Always lint as much as we can - never fail A because of an error in B
		if (!json) { return; } // plugin not found. importFallback doesn't error, because we are trying to return some type of workable config at all costs. But, when the plugin isn't found json will be undefined
		cfg.unshift({ plugins: { json } });
		const rules = await git('rules/json.jsonc');
		cfg.push({ files: ['**/*.json'], language: 'json/json', rules }); // lint JSON files
		cfg.push({ files: ['**/*.jsonc', '.vscode/*.json'], language: 'json/jsonc', rules }); // lint JSONC files
	});
	await importFallback('@eslint/markdown/dist/esm/index.js').then(async ({ default: markdown }) => { // don't use a "normal" import statement because it doesn't fallback to global, and will tank the whole process if unfound. Always lint as much as we can - never fail A because of an error in B
		if (!markdown) { return; } // plugin not found. importFallback doesn't error, because we are trying to return some type of workable config at all costs. But, when the plugin isn't found json will be undefined
		const rules = await git('rules/markdown.jsonc');
		cfg.push({ files: ['**/*.md'], plugins: { markdown }, language: 'markdown/commonmark', rules });
	});
	await importFallback('@eslint/css/dist/index.js').then(async ({ default: css }) => { // don't use a "normal" import statement because it doesn't fallback to global, and will tank the whole process if unfound. Always lint as much as we can - never fail A because of an error in B
		if (!css) { return; } // plugin not found. importFallback doesn't error, because we are trying to return some type of workable config at all costs. But, when the plugin isn't found json will be undefined
		let rules = await git('rules/css.jsonc');
		if (rules['css/require-baseline'] && !css.rules['require-baseline'] && css.rules['use-baseline']) { // workaround for rule name change in @eslint/css
			rules['css/use-baseline'] = rules['css/require-baseline'];
			delete rules['css/require-baseline'];
		}
		cfg.push({ files: ['**/*.css'], plugins: { css }, language: 'css/css', rules });
	});
	await importFallback('@html-eslint/eslint-plugin/lib/index.js').then(async ({ default: html }) => { // don't use a "normal" import statement because it doesn't fallback to global, and will tank the whole process if unfound. Always lint as much as we can - never fail A because of an error in B
		if (!html) { return; } // plugin not found. importFallback doesn't error, because we are trying to return some type of workable config at all costs. But, when the plugin isn't found json will be undefined
		const rules = await git('rules/html.jsonc');
		cfg.push({
			files: ['**/*.html'], rules, plugins: { '@html-eslint': html },
			languageOptions: { parser: (await importFallback('@html-eslint/parser/lib/index.js')).default },
		});
	});
export default cfg;
// auto update
	fetch(gitRepo + 'eslint.config.mjs').then(async r => {
		const newETag = r.headers.get('eTag');
		if (eTag === newETag) { console.info('config.mjs: template up-to-date'); return; }
		console.info('config.mjs: update template to ' + newETag);
		const txt = await r.text(), { writeFile } = await import('node:fs/promises');
		await writeFile(import.meta.filename, txt.replace(/eTag = '.+/, `eTag = '${newETag}',`));
	});