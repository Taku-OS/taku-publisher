# Taku Publisher for Claude Code

This directory is a Claude Code plugin marketplace package for Taku Publisher.

## Install

Add this marketplace directory to Claude Code, then install the plugin from the
`taku` marketplace:

```sh
claude plugin marketplace add /path/to/dist/marketplaces/claude/taku
claude plugin install taku-publisher@taku
```

For local testing from this repository, the marketplace path is:

```sh
claude plugin marketplace add ./dist/marketplaces/claude/taku
claude plugin install taku-publisher@taku
```

Start a new Claude Code session after installation so Claude Code can load the
plugin.

Do not paste the marketplace path into the chat as the workspace to scan. The
marketplace path is only for installation. To generate your Creator Profile,
open Claude Code in the project or workspace you want Taku Publisher to scan.

## Try It

Ask Claude Code:

```text
Use Taku Publisher to generate an editable Creator Profile preview.
```

Other useful prompts:

```text
Show my Taku Creator Center.
Find a tool in the Taku community.
Publish the tool in this workspace to Taku.
```

## What It Does

Taku Publisher lets Claude Code search the full Taku community catalog, inspect
community tools, scan local creator activity, generate an editable Creator Profile,
manage your Creator Center, and publish a workspace tool to Taku.

The plugin may open a browser sign-in flow when it needs Taku authorization.
Do not paste tokens into chat; sign in through the opened Taku page.

## Package Layout

- `.claude-plugin/marketplace.json` is the Claude Code marketplace index.
- `plugins/taku-publisher/` is the installable Claude Code plugin.
- `plugins/taku-publisher/README.md` has single-plugin usage notes.
- `plugins/taku-publisher/skills/taku-publisher/SKILL.md` contains the agent
  workflow instructions used by Claude Code.
