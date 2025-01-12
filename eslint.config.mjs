const cfgGist = 'https://gist.githubusercontent.com/stephen-hardy/1ac7e09585d2193fcfe40be91f74343a/raw/';
async function json(url) {
	const t = await (await fetch(url)).text();
	return JSON.parse(t.replaceAll(/\/\*.*?\*\//g, '')); // remove ONLY multi-line comment syntax - cheap substitute for actual JSONC support, that doesn't require a dependency
}
async function gist(file) { return json(cfgGist + file); }
async function asyncExec(cmd) {
	const [{ default: util }, { exec }] = await Promise.all([import('node:util'), import('node:child_process')]);
	return (await util.promisify(exec)(cmd)).stdout;
}
async function importFallback(x) {
	return import(x)
		.catch(async _ => {
			importFallback.global ??= await asyncExec('npm root -g');
			return import(`${importFallback.global}/${x}`);
		})
		.catch(_ => {
			console.error(`Unable to import "${x}", is it installed locally OR globally?`);
			return { default: {} };
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
		rules: await gist('javascript'),
	},
	{
		files: ['src/**/*', 'test/**/*'],
		rules: {
			semi: ['warn', 'always']
		}
	},
];