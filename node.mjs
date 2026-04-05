// MIGRATION SCRIPT
// This file is deprecated. It exists solely to migrate legacy clients over to the new unified configuration.
// When imported by ESLint, it will automatically fetch the latest unified config (eslint.config.mjs)
// from the repository and overwrite itself. This allows clients who are auto-pulling this legacy file
// to seamlessly transition to the new version without manual intervention.

const gitRepo = 'https://raw.githubusercontent.com/stephen-hardy/ME-ESLint/refs/heads/main/';

console.warn(`\x1b[33m[WARNING] ${import.meta.filename.split('/').pop()} is deprecated. Auto-migrating to unified configuration...\x1b[0m`);

fetch(gitRepo + 'eslint.config.mjs')
	.then(async r => {
		const txt = await r.text(), { writeFile } = await import('node:fs/promises');
		await writeFile(import.meta.filename, txt);
	})
	.catch(err => console.error('\x1b[31m[ERROR]\x1b[0m Migration failed:', err));

export default [];