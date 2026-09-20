# Taku Passport

Taku Passport is the canonical local capability platform for discovering, reviewing, packaging, installing, publishing, and managing creator capabilities on Taku.

**Passport is the product and platform boundary. Publisher is the publishing module and user workflow inside Passport.** Existing `taku-publisher` plugin names, CLI commands, package paths, and local directory names remain supported during the compatibility period.

The repository deliberately separates reusable implementation from host-specific delivery:

- `packages/capability-contract`: canonical TypeScript/ESM contract for private capability snapshots and public package manifests.
- `packages/passport-core`: host-independent TypeScript/ESM core for deterministic Snapshot, inventory and privacy rules.
- `packages/creator-core`: deprecated compatibility alias for `@taku/passport-core`.
- `packages/publisher-runtime`: canonical TypeScript/ESM runtime for discovery,
  Codex/Claude Code/Cursor/OpenCode project import, bounded Skill generation, staging,
  scanning, packaging, authorization, Marketplace installation, and Worker
  orchestration.
- `packages/publisher-cli`: stable Node.js workspace entrypoints for the creator
  and publisher runtimes.
- `adapters/portable/taku-publisher`: portable Skill distribution notes.
- `adapters/codex/taku-publisher`: thin Codex plugin manifest source.
- `adapters/claude/taku-publisher`: thin Claude Code plugin manifest source.
- `adapters/opencode`: OpenCode installation guidance for the portable Agent Skill.
- `creator/` and `scripts/taku_publisher/`: current implementation and backward-compatible entrypoints.

The canonical entrypoint is:

```bash
node scripts/taku-publisher.mjs --help
```

Recent local projects can be discovered from Codex, Claude Code, Cursor, or OpenCode
metadata and assessed without executing them:

```bash
node scripts/taku-publisher.mjs project-discover --host all
node scripts/taku-publisher.mjs project-discover --host cursor
node scripts/taku-publisher.mjs project-discover --host opencode
node scripts/taku-publisher.mjs project-assess --source /absolute/path/to/project
```

Cursor discovery reads bounded `workspaceStorage` metadata. Its local usage
reader uses only explicit token counters in `state.vscdb`; missing counters are
reported as unavailable and are never estimated from conversation text. A
Cursor-compatible host uses the portable Skill with its current Agent; it does
not ship an independent AI runner.

OpenCode discovery reads only project paths and activity timestamps from its
local database, with a bounded legacy project-metadata fallback. Its usage
reader selects only explicit session model and token columns; it never queries
message, prompt, account, or credential tables and never estimates missing
usage.

The assessment routes one selected project to existing Skill publishing,
SubApp migration, bounded Skill generation, or reference-only handling.

The legacy `python3 scripts/taku_publisher.py` entrypoint remains available in
the source repository during the compatibility window, but generated user
plugins contain no Python files and never invoke Python.

Creator Center commands are available through the same host-neutral CLI:

```bash
node scripts/taku-publisher.mjs creator-center-list --json
node scripts/taku-publisher.mjs creator-center-show --json --item-id <item-id>
node scripts/taku-publisher.mjs creator-center-stats --json
node scripts/taku-publisher.mjs creator-center-update --json --item-id <item-id> --name "Updated name"
```

They use short-lived, scoped Taku Web authorization and never treat local files as proof of ownership. Published item updates continue through the existing Publisher review flow.

Build self-contained host plugins without installing Taku Desktop:

```bash
npm run build:adapters
```

The host-neutral Skill is written to `dist/skills/taku-publisher/`. Generated
plugins are written to `dist/plugins/`; each contains thin host metadata around
a self-contained copy of that canonical Skill runtime. `dist/` is generated
output and should not be edited.

Build and verify the immutable capability contract artifact:

```bash
npm run smoke:contract
```

This creates a versioned `.tgz`, a SHA-256 checksum, and provenance metadata
under `dist/packages/`, then installs the archive into a clean temporary
project and verifies its ESM exports and TypeScript declarations. Tagged
releases named `capability-contract-v<version>` attach the same three files to
a GitHub Release. Desktop consumes the pinned archive at build time; end users
do not need registry access at runtime.

The same build also creates installable Codex and Claude Code Marketplaces under
`dist/marketplaces/`:

```bash
codex plugin marketplace add ./dist/marketplaces/codex/taku
codex plugin add taku-publisher@taku

claude plugin marketplace add ./dist/marketplaces/claude/taku
claude plugin install taku-publisher@taku
```

Start a new Codex task or Claude Code session after installation so it picks up
the Taku Publisher Skill. Version 0.3.22 adds bounded OpenCode project discovery
and exact local Token counters, fixes Publisher session authentication for
Studio drafts, and ships the current Stax Challenge and SubApp conversion flow
through the file-preserving multi-host installer:

```sh
npm run pack:installer
node dist/installers/cursor/bin/taku-publisher.mjs install --host cursor
node dist/installers/cursor/bin/taku-publisher.mjs install --host agent-skills
```

Start a new Cursor Agent chat and invoke `/taku-publisher`. The generic target
installs to `~/.agents/skills/taku-publisher`, which OpenCode loads by default;
start a new host session after installation. GitHub production distribution
uses the `marketplace` branch and `v0.3.22` release assets, not
the npm registry or the official Cursor store. `npm run build:marketplace`
generates the combined three-host GitHub bundle. Stax Challenge is an explicit,
optional Card-to-one-Skill workflow; ordinary Card, Skill and SubApp routes remain available. See
[Cursor installation and release gates](docs/cursor-release.md).

OpenCode can load the portable artifact from its global
`~/.config/opencode/skills/taku-publisher` directory or a project's
`.opencode/skills/taku-publisher` directory. The public `--host agent-skills`
installer uses the shared `~/.agents/skills/taku-publisher` directory, which
OpenCode also discovers automatically. Gemini CLI and other Agent Skills
compatible hosts can use that same standard directory when supported. Core Stax
Card, SubApp conversion, and Skill publishing workflows remain available;
OpenCode recent-project discovery and explicit local usage statistics are also
available when its local database schema is present.

Creator-facing scans default to a bounded local usage-file budget so large
session histories remain responsive. Pass `--max-usage-files <n>` only when a
larger explicit scan is required. Host-facing text scans should use `--compact`;
the editable Creator Profile flow keeps its full inventory in local private
state and returns only the editor URL and a public-safe summary to the host.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership and migration boundaries.

## Repository verification

Run the same baseline checks used by CI:

```bash
npm ci
npm run audit:repo
npm test
npm run build:adapters
npm run smoke:plugin
npm run smoke:contract
npm run checksum:source
```

After the first commit exists, `npm run smoke:clean` exports `HEAD` into a temporary clean directory and repeats the repository audit, tests, and Adapter build without depending on Taku Desktop.
For an uncommitted integration candidate, use `npm run smoke:clean -- --working-tree`
to test a clean export of the actual current sources rather than old HEAD.

Generated `dist/` content is never canonical source and must not be committed. See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## Licensing and asset notices

- Source code is licensed under the [Apache License 2.0](LICENSE), with
  `Copyright 2026 Taku` recorded in [NOTICE](NOTICE).
- [Third-party notices](THIRD_PARTY_NOTICES.md) cover bundled fonts, Superpowers, TypeScript, the QR generator, and optional network behavior.
- [Trademark and visual asset terms](TRADEMARKS.md) cover third-party product logos and Taku persona artwork.
- The complete [SIL Open Font License 1.1](creator/assets/fonts/OFL-1.1.txt) is distributed with the bundled fonts.

The Apache-2.0 license applies to Taku-owned source code and documentation. It
does not relicense third-party components, product logos, Taku trademarks, or
Taku persona artwork; those materials remain subject to the separate notices
linked above.
