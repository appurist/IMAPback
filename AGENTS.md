# Repository Guidelines

## Project Structure & Module Organization

This is a small Bun-based IMAP diagnostic and backup tool. The main program lives in `index.js` and implements CLI parsing, IMAPS connection handling, folder reports, message listing, and backup output. `README.md` is the user-facing command reference. `package.json` defines the Bun package metadata and scripts.

Repository-root `.cfg` files such as `jon.cfg` are local configuration examples or working configs. Text files such as `folders.txt`, `backup-*.txt`, and `search-*.txt` are captured command output. Avoid treating those output files as source modules.

## Build, Test, and Development Commands

- `bun install`: install dependencies if any are added later and refresh Bun metadata.
- `bun run index.js --help`: print CLI usage and verify the program starts.
- `bun run index.js --config jon.cfg --counts`: run a count report using a local config file.
- `bun run index.js mail.example.com password --user user@example.com --folders`: list folders against a specific server.
- `bun run start`: run the `start` script, equivalent to `bun run index.js`.

There is no separate build step; this project runs directly with Bun.

## Coding Style & Naming Conventions

Use modern JavaScript ES modules, as configured by `"type": "module"`. Keep indentation at two spaces, prefer `const` unless reassignment is required, and use descriptive camelCase names for functions, variables, and option fields. Keep CLI option names kebab-case, matching the existing flags such as `--connect-host` and `--output`.

Preserve the current single-file style unless a change creates enough complexity to justify extracting helpers. Keep error messages actionable because many users will redirect output to logs.

## Testing Guidelines

No automated test framework is currently configured. For changes, at minimum run `bun run index.js --help` and one non-destructive report command such as `--folders`, `--counts`, or `--list` against a test mailbox. When adding tests later, prefer Bun’s built-in test runner and name files `*.test.js`.

## Commit & Pull Request Guidelines

This repository has no existing commit history, so use concise imperative commit messages, for example `Add date range validation` or `Handle folder fetch errors`. Pull requests should describe the CLI behavior changed, include the exact command used for manual verification, and note whether the change touches backup output on disk.

## Security & Configuration Tips

Do not commit real mailbox passwords, private server addresses, or personal backup output. Prefer `IMAPSAVE_USER` and `IMAPSAVE_PASSWORD` for credentials, or keep local config files outside version control when they contain secrets.
