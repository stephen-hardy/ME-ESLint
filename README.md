A shared ESLint configuration approach designed to pull rules dynamically from a central repository and gracefully handle missing dependencies.

## Features

- **Dynamic Rule Loading**: Fetches ESLint rules (JSONC files) from a remote GitHub repository.
- **Smart Caching**: Implements a "Stale-While-Revalidate" pattern that securely caches rules and global NPM paths in a user-isolated OS home folder (`os.homedir() + '/.cache/sh-eslint'`). This ensures instant startup while updating in the background, avoiding shared CI permission errors.
- **Global & Local Plugin Resolution**: Attempts to resolve ESLint plugins locally, and falls back to global NPM resolution if they are not found.
- **Resilient Linting**: If a rule file or plugin fails to load, it will return an empty configuration object to allow linting of other file types to continue uninterrupted.
- **Manual Updates**: The configuration script can be updated by running it directly (e.g., `node eslint.config.mjs`). It will check the remote `eTag` and pull the latest version if needed.

## Setup

Place `eslint.config.mjs` in the root of your project.

## Legacy Migration

Previously, clients used separate `cloudflare.mjs` and `node.mjs` configuration files. These have been merged into a single, unified `eslint.config.mjs` that detects the environment dynamically. 

To migrate legacy clients securely, the `cloudflare.mjs` and `node.mjs` files in this repository have been replaced with minimal migration scripts. When a legacy client imports either of these files for linting, a warning is emitted advising the user to migrate. To actually perform the migration, the user must run the file directly (e.g., `node eslint.config.mjs`). This will automatically fetch the new unified `eslint.config.mjs` and overwrite the legacy file, allowing clients to seamlessly transition to the unified configuration while mitigating "drive-by" remote code execution risks on import.

## Note on Architecture

This configuration takes an unconventional approach to ESLint by loading rules over HTTP and dynamically executing module resolution via child processes (`npm root -g`). This allows for centralized rule management without requiring developers to constantly update `package.json` dependencies for rule changes.

**Dynamic Module Resolution Context:** To remain resilient across different environments, the script uses a custom `importFallback()` function. It first attempts a standard dynamic `import(specifier)`. If that fails, it assumes the plugin might be installed globally and falls back to `import('file://${npmGlobal}/${specifier}')`. Furthermore, the final `cfg` array exported to ESLint is built dynamically using `Promise.all` and asynchronous IIFEs (Immediately Invoked Function Expressions). This structure guarantees that if an optional plugin (like `@eslint/markdown`) fails to load, it simply skips pushing that specific configuration block to the array, rather than crashing the entire linting process.

**Development Note for this Repository:** `edit.mjs` is the source of truth for the logic. Do not edit `eslint.config.mjs` directly in this repository. On commit, a Git hook automatically copies `edit.mjs` to `eslint.config.mjs`, which then propagates to GitHub for other clients to pull.

## Technical Trade-offs & Assumed Risks

Because of its unconventional architecture, this project makes several intentional technical trade-offs (such as dynamic evaluation over HTTP, `npm root -g` fallbacks, unpinned configuration versions, and manual update requirements) to maintain simplicity.

For a comprehensive list of these assumed risks, known technical limitations, and the rules guiding AI assistants that contribute to this repository, please consult the [`.roorules`](.roorules) file.
