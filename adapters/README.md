# Host adapters

Host adapters contain only host-specific plugin metadata. They do not own scanning, persona, security, or publishing logic.

Run `npm run build:adapters` from the repository root to create one portable
Skill under `dist/skills/` and thin self-contained Codex, Claude Code, and Cursor plugins
under `dist/plugins/`. The build copies the canonical Skill runtime into each
generated plugin so users do not need Taku Desktop or a separately installed
Taku CLI. Cursor uses the portable Skill with its current Agent.

Cursor's complete GitHub-importable marketplace is generated under
`dist/marketplaces/cursor/taku/`, with `.cursor-plugin/marketplace.json` at its
root. `npm run pack:cursor` also creates a self-contained, file-preserving
installer and local release archives. See [Cursor release gates](../docs/cursor-release.md).

The build also creates a repo-local Codex Marketplace under
`dist/marketplaces/codex/taku/`. Its `.agents/plugins/marketplace.json` points to
`./plugins/taku-publisher`, so the entire directory can be added with
`codex plugin marketplace add` and installed as `taku-publisher@taku`.
