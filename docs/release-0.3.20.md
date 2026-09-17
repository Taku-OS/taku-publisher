# Taku Publisher 0.3.20 — AI Burn and portable Agent Skills

Taku Publisher 0.3.20 preserves the Codex, Claude Code, and Cursor publishing
workflows, publishes the recent-90-day usage data required by the AI Burn
leaderboard, and adds portable Agent Skills support for OpenCode, Gemini CLI,
and compatible hosts.

Production authorization remains on `https://taku.ai`; the default Worker
remains `https://worker.taku.ai`. No preview authorization origin is included.

## What changed

- Adds the `taku.creator.ai-burn-usage.v2` usage schema to newly generated and
  updated Stax Cards.
- Includes model-level token details for the most recent 90 days without
  uploading prompts, raw session logs, or local filesystem paths.
- Adds portable installation, discovery, Stax Card identification, and
  Marketplace Skill installation for compatible Agent Skills hosts.
- Preserves the existing Codex, Claude Code, and Cursor publishing workflows.

## How to refresh AI Burn data

1. Install or update Taku Publisher to 0.3.20.
2. Start a new Codex, Claude Code, Cursor, or compatible Agent Skills session.
3. Generate or update a Stax Card, select the most recent 90 days, and publish
   the Card.
4. Wait about 2–5 minutes for leaderboard cache refresh, then reload AI Burn.

Publishing a Card with an older Publisher version does not backfill the new
model-level usage fields. Existing creators must update the Publisher and
publish the Card again.

## Install

Codex:

```sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin add taku-publisher@taku
```

Claude Code:

```sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
```

Cursor (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.20/taku-publisher-0.3.20.tgz taku-publisher install --host cursor
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.20/taku-publisher-0.3.20.tgz taku-publisher install --host agent-skills
```

The generic command installs into `~/.agents/skills/taku-publisher`, which
OpenCode discovers automatically. Start a new host session after installation.

The installer refuses to overwrite unmanaged or locally edited Skills. Managed
updates require `--update`; migration of an unmanaged copy requires the
explicit `--backup-existing` option. Backups remain outside Skill discovery
directories.

## Distribution

The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.20` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace. After installation, run the version command from
the active Skill directory; it must report `taku-publisher 0.3.20 (standard)`.
