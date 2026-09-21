# Taku Publisher 0.3.25 — Resumable authorization and runtime validation

Taku Publisher 0.3.25 makes browser authorization recoverable, guides users
through server-required registration and terms review, and validates declared
SubApp runtime capabilities before conversion advances.

## What changed

- Runs browser authorization through a resumable flow so an interrupted host
  command can continue after the user finishes signing in.
- Returns structured, trusted Taku Web handoffs when registration or updated
  terms require the user's review; Publisher never accepts terms or supplies
  age or consent on the user's behalf.
- Validates SubApp `runtimeCapabilities` declarations across the Converter,
  runtime manifest, and shared contract before a candidate can advance.
- Preserves the dedicated Flowchart authorization, Stax Challenge behavior,
  current multi-host commands, and the stable `latest` installer asset.

Legal-gate enforcement remains controlled by the compatible Taku Web, Worker,
and Desktop rollout. Shipping the client handling does not enable those gates.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.25/taku-publisher-0.3.25.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.25/taku-publisher-0.3.25.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
The supported public distribution is the GitHub `marketplace` branch and the
`v0.3.25` GitHub release assets. Taku Publisher is not published to npm or the
official Cursor Marketplace.
