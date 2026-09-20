# Taku Publisher 0.3.23 — Flowcharts enabled by default

Taku Publisher 0.3.23 enables automatic Flowchart generation for new Publisher
drafts by default, so newly published Skills receive a Flowchart without extra
environment configuration.

## What changed

- Enables automatic Flowchart generation when
  `TAKU_PUBLISHER_GENERATE_FLOWCHART` is unset.
- Preserves a creator-provided valid Flowchart instead of replacing it.
- Supports an explicit operator opt-out with `0`, `false`, `no`, `off`, or
  `disabled`.
- Keeps Flowchart generation failure fail-closed so an item is not silently
  published without the expected Flowchart.

Existing published items are not backfilled automatically and must be updated
separately.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.23/taku-publisher-0.3.23.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.23/taku-publisher-0.3.23.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.23` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.
