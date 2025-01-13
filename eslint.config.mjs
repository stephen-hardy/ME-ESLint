// UTILITIES: git(), importFallback(), json(), asyncExec(), saveTemp(), getTemp()
	const gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/sh-eslint/refs/heads/main/'; // PUBLIC github repository containing JSONC files we will pull/cache, to be incorporated in the default export array
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
	async function json(url) { // fetch url, strip multi-line comments (syntax), return parsed JSON
		const cacheFile = url.split('/').at(-1);
		return fetch(url).then(r => r.text())
			.then(t => {
				const stripped = t.replaceAll(/\/\*.*?\*\//g, ''), parsed = JSON.parse(stripped); // remove ONLY multi-line comment syntax - cheap substitute for actual JSONC support, that doesn't require a dependency
				saveTemp(cacheFile, stripped);
				console.info(`Successfully parsed and cached ${url} (len=${t.length},type=${typeof parsed})`);
				return parsed;
			})
			.catch(async err => {
				console.error(`Error loading ${url}, falling back to cache or empty object`);
				console.error(err);
				return JSON.parse(await getTemp(cacheFile) || '{}'); // if there is an error, return an empty object in hopes that linting might continue. The main rules JSONC may be essential for a given file type. However, there will likely be multiple file types linted, and failure in one shouldn't block functionality of another. Plus, there may be supplemental rules JSONC for overrides, and their failure shouldn't block what we do have from working
			});
	} // NOTE: because single-line comment syntax ("//") is not uncommonly used outside of comments (ex: https://...), it isn't practical to strip those without a dedicated parser. Part of the goal with global eslint and web-hosted rules is to minimize setup and file duplication. Therefore, adding a JSONC parser dependency just to support single-line syntax - when we can get multi-line syntax cheaply - doesn't make a lot of sense
	async function git(file) { return json(gitRepo + file); }
	async function asyncExec(cmd) { // only known way to get the npm global directory path is through execution of a command. The child_process.exec function is naturally clunky and callback-oriented. Promisify exec and resolve with the string printed to the console
		const [{ default: util }, { exec }] = await Promise.all([import('node:util'), import('node:child_process')]);
		return (await util.promisify(exec)(cmd)).stdout;
	}
	async function importFallback(x) {
		return import(x)
			.catch(async _ => { // local import failed, try to import from global
				importFallback.global ??= await asyncExec('npm root -g'); // node has no native way to import a global library, as of Jan 2025, so we need to know the npm global file path in order to specify the import file. This global file path will not change during use, so first successful return should be cached
				return import(`${importFallback.global}/${x}`); // try import under the npm global directory
			})
			.catch(_ => { // local and global import failed. Log an error, suggesting an npm (global) install, but return empty objects in the hope that linting might continue
				console.error(`Unable to import "${x}", is it installed locally OR globally?`);
				return { default: {} }; // JavaScript linting should not require an import (just JSONC rules). And, if there is failure to import a dependency for linting non-JavaScript, that should not prevent JS linting from working. Always try to show what you can show, and error for notifications
			});
	}
export default [
	{
		languageOptions: {
			globals: {
				...(await importFallback('globals/index.js')).default.browser
				// ...globals.nodeBuiltin
			}
		},
		rules: await git('rules.jsonc'),
	},
	{
		files: ['src/**/*', 'test/**/*'],
		rules: {
			semi: ['warn', 'always']
		}
	},
];