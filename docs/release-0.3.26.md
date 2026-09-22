# Taku Publisher 0.3.26 — Clearer Stax Challenge publishing guidance

Taku Publisher 0.3.26 makes the candidate Skill prompt explain why the creator
is choosing a Skill, how eligible Skills and Taku Apps relate to campaign
rewards, and that selection never publishes the Skill by itself.

## What changed

- Explains that choosing a candidate prepares one Skill for review and
  publishing.
- Points creators to the Challenge page for reward eligibility and terms instead
  of hard-coding campaign details.
- Preserves the separate creator confirmation required for final public release.
- Keeps the existing Stax Card, authorization, App, Skill, Creator Center, and
  multi-host behavior unchanged.

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
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.26/taku-publisher-0.3.26.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.26/taku-publisher-0.3.26.tgz taku-publisher install --host agent-skills --update
```

Start a new host session after installation so it loads the updated Skill.
