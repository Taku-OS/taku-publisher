# Taku Publisher 0.3.24 — OpenCode Flowchart authorization

Taku Publisher 0.3.24 fixes automatic Flowchart generation for standalone
Publisher hosts such as OpenCode.

## What changed

- Uses a dedicated, short-lived Flowchart token returned by Taku Web
  authorization instead of sending the general Publisher token.
- Refreshes older Publisher sessions before creating a draft when automatic
  Flowchart generation is enabled.
- Preserves direct Taku Desktop session compatibility.
- Requires no Fly or AI Proxy secret changes.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.24/taku-publisher-0.3.24.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.24/taku-publisher-0.3.24.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.24` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.
