# Taku Publisher 0.3.21 — AI Burn draft normalization fix

Taku Publisher 0.3.21 fixes the Stax draft step that dropped the complete
recent-90-day model usage collected by version 0.3.20 before publication.

## What changed

- Preserves the `taku.creator.ai-burn-usage.v2` marker through draft creation
  and refresh.
- Preserves period and per-host input, output, cache-read, cache-creation, and
  reasoning Token counts.
- Preserves up to 20 model rows per host, matching the Worker import limit, so
  AI Burn can calculate the complete API-equivalent USD value.
- Keeps the existing privacy boundary: prompts, raw session logs, and local
  filesystem paths are not uploaded.

## How to refresh AI Burn data

1. Install or update Taku Publisher to 0.3.21.
2. Start a new Codex, Claude Code, or Cursor session so it loads the new Skill.
3. Generate or update and publish the Stax Card again.
4. Wait about 2–5 minutes for leaderboard cache refresh, then reload AI Burn.

Cards published with 0.3.20 are not backfilled automatically because their
published snapshots may already be missing the model breakdown.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.21/taku-publisher-0.3.21.tgz taku-publisher install --host cursor --update
```

The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.21` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.
