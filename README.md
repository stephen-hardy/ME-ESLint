A shared ESLint configuration approach designed to pull rules dynamically from a central repository and gracefully handle missing dependencies.

## Features

- **Dynamic Rule Loading**: Fetches ESLint rules (JSONC files) from a remote GitHub repository.
- **Smart Caching**: Implements a "Stale-While-Revalidate" pattern that securely caches rules and global NPM paths in a user-isolated OS temporary folder (`os.tmpdir() + '/sh-eslint-' + username`). This ensures instant startup while updating in the background, avoiding shared CI permission errors.
- **Global & Local Plugin Resolution**: Attempts to resolve ESLint plugins locally, and falls back to global NPM resolution if they are not found.
- **Resilient Linting**: If a rule file or plugin fails to load, it will return an empty configuration object to allow linting of other file types to continue uninterrupted.
- **Self-Updating**: Automatically updates its own configuration script by comparing remote `eTag` headers.

## Setup

Place `eslint.config.mjs` in the root of your project.

## Note on Architecture

This configuration takes an unconventional approach to ESLint by loading rules over HTTP and dynamically executing module resolution via child processes (`npm root -g`). This allows for centralized rule management without requiring developers to constantly update `package.json` dependencies for rule changes. 

**Development Note for this Repository:** `edit.mjs` is the source of truth for the logic. Do not edit `eslint.config.mjs` directly in this repository. On commit, a Git hook automatically copies `edit.mjs` to `eslint.config.mjs`, which then propagates to GitHub for other clients to pull.
