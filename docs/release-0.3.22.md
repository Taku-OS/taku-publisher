# Taku Publisher 0.3.22 — OpenCode and Stax Challenge release

Taku Publisher 0.3.22 brings the current Stax Challenge and SubApp conversion
flow to the production multi-host plugin, adds OpenCode local discovery and
usage support, and fixes Studio draft authentication.

## What changed

- Adds bounded OpenCode project discovery from local project metadata.
- Reads only OpenCode's explicit per-session model and Token counters; prompts,
  messages, accounts, credentials, and raw session content are not queried.
- Adds the shared `agent-skills` installer target used by OpenCode and compatible
  hosts, while keeping the existing Codex, Claude Code, and Cursor packages.
- Fixes `creator-draft` authorization by preferring the active Publisher session
  over a stale legacy Supabase token.
- Uses the official Stax Challenge AI Burn period: September 22 through October
  30, 2026, in Asia/Shanghai.
- Includes the flowchart generation path, stricter template-service detection,
  Node.js 20 host validation, and Taku SubApp template 0.3.4.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.22/taku-publisher-0.3.22.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.22/taku-publisher-0.3.22.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.22` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.
