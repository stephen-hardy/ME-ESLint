const eTag = 'W/"516c5a4063301b924b8e26046ad62db6dc046d7982e3b45ffc7db8904b0c315c"',
	variant = 'cloudflare.mjs', // support variants for Cloudflare, Node, etc. All variants can be housed in the same repo, and updated, hopefully minimizing custom variations per project
	gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/ME-ESLint/refs/heads/main/', // PUBLIC github repository containing JSONC files we will pull/cache, to be incorporated in the default export array
	npmGlobal = await import('node:child_process')
		.then(({ exec }) => new Promise(res => { exec('npm root -g', (error, stdout, stderr) => res({ error, stdout, stderr })); }))
		.then(({ stdout, stderr, error }) => {
			if (stderr || error) { throw new Error(stderr || error); }
			console.info(`npmGlobal = ${stdout}`);
			return stdout;
		})
		.catch(err => console.error('Unable to get npmGlobal', err));
// UTILITIES: git(), importFallback(), getJson(), saveTemp(), getTemp()
	async function saveTemp(file, content) { // cache specified content into a file of specified name, in an OS temp folder of name "sh-eslint"
		const [fs, os, path] = await Promise.all([import('node:fs/promises'), import('node:os'), import('node:path')]),
			dir = path.join(os.tmpdir(), 'sh-eslint');
		await fs.mkdir(dir, { recursive: true }); // create the temp folder for this "application"
		const filePath = path.join(dir, file);
		await fs.writeFile(filePath, content);
		console.log(`ToCache: ${filePath}`);
	}
	async function getTemp(file) { // read specified file from OS temp folder
		const [fs, os, path] = await Promise.all([import('node:fs/promises'), import('node:os'), import('node:path')]),
			filePath = path.join(os.tmpdir(), 'sh-eslint', file),
			content = await fs.readFile(filePath, 'utf8');
		if (content) { console.info(`FromCache: ${filePath} (len=${content.length})`); }
		return content;
	}
	async function getJson(url) { // fetch url, strip multi-line comments (syntax), return parsed JSON
		const cacheFile = url.split('/').at(-1), logURL = url.startsWith(gitRepo) ? '[git]' + url.slice(gitRepo.length - 1) : url;
		return fetch(url).then(r => r.text())
			.then(t => {
				const stripped = t.replaceAll(/\/\*.*?\*\//g, ''), parsed = JSON.parse(stripped); // remove ONLY multi-line comment syntax - cheap substitute for actual JSONC support, that doesn't require a dependency
				saveTemp(cacheFile, stripped);
				console.info(`Loaded (json=http): ${logURL} (len=${t.length},type=${typeof parsed})`);
				return parsed;
			})
			.catch(async err => {
				console.error(`Error loading ${url}, falling back to cache or empty object`);
				console.error(err);
				const cache = await getTemp(cacheFile);
				if (cache) { // try cache for offline scenarios
					const parsed = JSON.parse(cache);
					console.info(`Loaded (json=cache): ${logURL} (len=${cache.length},type=${typeof parsed})`);
					return parsed;
				}
				return {}; // if there is an error, return an empty object in hopes that linting might continue. The main rules JSONC may be essential for a given file type. However, there will likely be multiple file types linted, and failure in one shouldn't block functionality of another. Plus, there may be supplemental rules JSONC for overrides, and their failure shouldn't block what we do have from working
			});
	} // NOTE: because single-line comment syntax ("//") is not uncommonly used outside of comments (ex: https://...), it isn't practical to strip those without a dedicated parser. Part of the goal with global eslint and web-hosted rules is to minimize setup and file duplication. Therefore, adding a JSONC parser dependency just to support single-line syntax - when we can get multi-line syntax cheaply - doesn't make a lot of sense
	async function git(file) { return getJson(gitRepo + file); }
	async function importFallback(x) {
		return import(x)
			.then(m => console.info(`Loaded (import=local): ${x} (keys: ${Object.keys(m)})`) || m)
			.catch(_ => import(`${npmGlobal}/${x}`)) // try import under the npm global directory
			.then(m => console.info(`Loaded (import=global): ${x} (keys: ${Object.keys(m)})`) || m)
			.catch(_ => { // local and global import failed. Log an error, suggesting an npm (global) install, but return empty objects in the hope that linting might continue
				console.error(`Failed import: ${x} - is it installed locally OR globally?`);
				return {}; // JavaScript linting should not require an import (just JSONC rules). And, if there is failure to import a dependency for linting non-JavaScript, that should not prevent JS linting from working. Always try to show what you can show, and error for notifications
			});
	}
const cfg = [
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: {
			globals: {
				...(await importFallback('globals/index.js')).default?.browser
				// ...globals.nodeBuiltin
			}
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
	await importFallback('@eslint/css/dist/esm/index.js').then(async ({ default: css }) => { // don't use a "normal" import statement because it doesn't fallback to global, and will tank the whole process if unfound. Always lint as much as we can - never fail A because of an error in B
		if (!css) { return; } // plugin not found. importFallback doesn't error, because we are trying to return some type of workable config at all costs. But, when the plugin isn't found json will be undefined
		const rules = await git('rules/css.jsonc');
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
	fetch(gitRepo + variant).then(async r => {
		const newETag = r.headers.get('eTag');
		if (eTag === newETag) { console.info('config.mjs: template up to date'); return; }
		console.info('config.mjs: update template to ' + newETag);
		const txt = await r.text(), { writeFile } = await import('node:fs/promises');
		await writeFile('eslint.config.mjs', txt.replace(/eTag = '.+/, `eTag = '${newETag}',`));
	});