# Host adapters

Host adapters contain only host-specific plugin metadata. They do not own scanning, persona, security, or publishing logic.

Run `npm run build:adapters` from the repository root to create self-contained Codex and Claude Code plugins under `dist/plugins/`. The build copies the canonical skill runtime into each generated plugin so users do not need Taku Desktop or a separately installed Taku CLI.

The build also creates a repo-local Codex Marketplace under
`dist/marketplaces/codex/taku/`. Its `.agents/plugins/marketplace.json` points to
`./plugins/taku-publisher`, so the entire directory can be added with
`codex plugin marketplace add` and installed as `taku-publisher@taku`.
