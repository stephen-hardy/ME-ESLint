A shared ESLint configuration approach designed to pull rules dynamically from a central repository and gracefully handle missing dependencies.

## Features

- **Dynamic Rule Loading**: Fetches ESLint rules (JSONC files) from a remote GitHub repository.
- **Smart Caching**: Implements a "Stale-While-Revalidate" pattern that securely caches rules and global NPM paths in a user-isolated OS temporary folder (`os.tmpdir() + '/sh-eslint-' + username`). This ensures instant startup while updating in the background, avoiding shared CI permission errors.
- **Global & Local Plugin Resolution**: Attempts to resolve ESLint plugins locally, and falls back to global NPM resolution if they are not found.
- **Resilient Linting**: If a rule file or plugin fails to load, it will return an empty configuration object to allow linting of other file types to continue uninterrupted.
- **Manual Updates**: The configuration script can be updated by running it directly (e.g., `node eslint.config.mjs`). It will check the remote `eTag` and pull the latest version if needed.

## Setup

Place `eslint.config.mjs` in the root of your project.

## Legacy Migration

Previously, clients used separate `cloudflare.mjs` and `node.mjs` configuration files. These have been merged into a single, unified `eslint.config.mjs` that detects the environment dynamically. 

To migrate legacy clients seamlessly, the `cloudflare.mjs` and `node.mjs` files in this repository have been replaced with minimal auto-migration scripts. When a legacy client imports either of these files for linting, the script will automatically fetch the new unified `eslint.config.mjs` and overwrite itself. This allows clients to seamlessly transition to the unified configuration without requiring manual intervention.

## Note on Architecture

This configuration takes an unconventional approach to ESLint by loading rules over HTTP and dynamically executing module resolution via child processes (`npm root -g`). This allows for centralized rule management without requiring developers to constantly update `package.json` dependencies for rule changes. 

**Development Note for this Repository:** `edit.mjs` is the source of truth for the logic. Do not edit `eslint.config.mjs` directly in this repository. On commit, a Git hook automatically copies `edit.mjs` to `eslint.config.mjs`, which then propagates to GitHub for other clients to pull.

## Assumed Risks

The following technical limitations are acknowledged and accepted as assumed risks for the current architecture:

- **Brittle JSONC Parsing**: JSONC rule files are parsed using a simple regex (`replaceAll(/\/\*.*?\*\//g, '')`) to strip block comments. This may fail if block comments appear within strings or if single-line (`//`) comments are present.
- **Hardcoded Environment Detection**: `detectEnv()` is currently hardcoded to look for `wrangler.json`, making the environment detection Cloudflare-specific. A more robust, generic configuration override system is deferred for future consideration.
- **Global Module Resolution Assumption**: The configuration explicitly relies on `npm root -g` to find global modules for fallbacks. This may fail in environments using `pnpm`, `yarn`, or complex monorepo structures. This is an accepted limitation to maintain simplicity.
- **Security & Reproducible Builds**: Updates to the configuration script require a manual execution (`node eslint.config.mjs`). This intentional design mitigates "drive-by" Remote Code Execution (RCE) risks if the remote repository is compromised, and ensures your CI and local environments remain reproducible. However, unlike standard NPM packages, this approach does not use lockfiles (`package-lock.json`) or integrity hashes, meaning you are downloading and executing unpinned, mutable code when you choose to update.
