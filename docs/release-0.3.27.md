# Taku Publisher 0.3.27 — Local authorization host compatibility

Taku Publisher 0.3.27 documents the separate authorization-site override in
the packaged creator CLI and aligns the legacy Python compatibility entrypoint
with the Node runtime. Local and preview testing can keep browser authorization
on the selected test site without changing the Publisher product site.

## What changed

- Shows `--auth-site-url` in the creator draft, editor, and publish help text.
- Makes the legacy Python `auth-login` and creator draft paths honor an explicit
  `--auth-site-url` value.
- Keeps `--site-url` responsible for the Publisher product site while the
  authorization host can be configured independently.
- Preserves the existing Node runtime, production endpoints, Stax Challenge,
  Card, Skill, App, Creator Center, and multi-host behavior.

## Install

Codex:

```sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin marketplace upgrade taku
codex plugin add taku-publisher@taku
```

Claude Code:

```sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
```

Cursor (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.27/taku-publisher-0.3.27.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.27/taku-publisher-0.3.27.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
