// MIGRATION SCRIPT
// This file is deprecated. It exists solely to migrate legacy clients over to the new unified configuration.
// To migrate, run this file directly (e.g., `node eslint.config.mjs`). It will fetch the latest unified config (eslint.config.mjs)
// from the repository and overwrite itself.

const gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/ME-ESLint/refs/heads/main/';

console.warn(`\x1b[33m[WARNING] ${import.meta.filename.split('/').pop()} is deprecated. Please run 'node ${import.meta.filename.split('/').pop()}' to migrate to the unified configuration.\x1b[0m`);

if (process.argv[1] === import.meta.filename) {
	fetch(gitRepo + 'eslint.config.mjs')
		.then(async r => {
			const txt = await r.text(), { writeFile } = await import('node:fs/promises');
			await writeFile(import.meta.filename, txt);
			console.info('\x1b[32m[SUCCESS]\x1b[0m Migration complete!');
		})
		.catch(err => console.error('\x1b[31m[ERROR]\x1b[0m Migration failed:', err));
}

export default [];