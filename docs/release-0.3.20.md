# Taku Publisher 0.3.20 — AI Burn 90-day usage

Taku Publisher 0.3.20 publishes the complete recent-90-day usage data required
by the AI Burn leaderboard for Codex and Claude Code.

## What changed

- Adds the `taku.creator.ai-burn-usage.v2` usage schema to newly generated and
  updated Stax Cards.
- Includes model-level token details for the most recent 90 days so Taku can
  calculate comparable USD burn values.
- Keeps the existing privacy boundary: prompts, raw session logs, and local
  filesystem paths are not uploaded.
- Preserves the existing Codex, Claude Code, and Cursor publishing workflows.

## How to refresh AI Burn data

1. Install or update Taku Publisher to 0.3.20.
2. Start a new Codex, Claude Code, or Cursor session so it loads the new Skill.
3. Generate or update a Stax Card, select the most recent 90 days, and publish
   the Card.
4. Wait about 2–5 minutes for leaderboard cache refresh, then reload AI Burn.

Publishing a Card with an older Publisher version does not backfill the new
model-level usage fields. Existing creators must update the Publisher and
publish the Card again.

## Distribution

The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.20` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.

For Cursor, download `taku-publisher-0.3.20.tgz` from the trusted GitHub release
and run from the download directory with Node.js 20+:

```sh
npx --yes --package ./taku-publisher-0.3.20.tgz taku-publisher install --host cursor
```

After installation, run the version command from the active Skill directory.
It must report `taku-publisher 0.3.20 (standard)`.
