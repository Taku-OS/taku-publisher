# Taku Publisher for Codex

This directory is a Codex plugin marketplace package for Taku Publisher.

## Install

Add this marketplace directory to Codex, then install the plugin from the
`taku` marketplace:

```sh
codex plugin marketplace add /path/to/dist/marketplaces/codex/taku
codex plugin add taku-publisher@taku
```

For local testing from this repository, the marketplace path is:

```sh
codex plugin marketplace add ./dist/marketplaces/codex/taku
codex plugin add taku-publisher@taku
```

Start a new Codex task after installation so Codex can load the plugin.

Do not paste the marketplace path into the chat as the workspace to scan. The
marketplace path is only for installation. To generate your Creator Profile,
open Codex in the project or workspace you want Taku Publisher to scan.

## Try It

Ask Codex:

```text
打开 Taku Publisher 创作者工作台，生成我的 Stax Card，并让我选择要发布的本地项目。
```

Other useful prompts:

```text
Find my recent Codex and Claude Code projects and help me import one into Taku.
Show my Taku Creator Center.
Find a tool in the Taku community.
Publish the tool in this workspace to Taku.
```

## What It Does

Taku Publisher lets Codex discover recent Codex/Claude Code workspaces from
local metadata, route one selected project to SubApp or Skill conversion,
search the full Taku community catalog, install compatible Skills, scan local
creator activity, generate an editable Creator Profile, manage your Creator
Center, and publish a workspace tool to Taku.

The plugin may open a browser sign-in flow when it needs Taku authorization.
Do not paste tokens into chat; sign in through the opened Taku page.

## Package Layout

- `.agents/plugins/marketplace.json` is the Codex marketplace index.
- `plugins/taku-publisher/` is the installable Codex plugin.
- `plugins/taku-publisher/README.md` has single-plugin usage notes.
- `plugins/taku-publisher/skills/taku-publisher/SKILL.md` contains the agent
  workflow instructions used by Codex.
