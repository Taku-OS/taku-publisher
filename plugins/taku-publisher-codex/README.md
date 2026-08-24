# Taku Publisher

Taku Publisher is a Codex plugin for finding, installing, managing, and
publishing Taku AI tools.

## Install

Most users should install this plugin from the Taku Codex marketplace package:

```sh
codex plugin marketplace add /path/to/dist/marketplaces/codex/taku
codex plugin add taku-publisher@taku
```

If you are testing this single plugin directory directly, add it through the
Codex plugin flow that accepts local plugin paths.

Start a new Codex task after installation.

Do not paste the plugin or marketplace path into the chat as the workspace to
scan. Those paths are only for installation. To generate your Creator Profile,
open Codex in the project or workspace you want Taku Publisher to scan.

## Try It

Ask Codex:

```text
Use Taku Publisher to generate an editable Creator Profile preview.
```

Other useful prompts:

```text
Find my recent Codex and Claude Code projects and help me import one into Taku.
Show my Taku Creator Center.
Find a tool in the Taku community.
Publish the tool in this workspace to Taku.
```

## What To Expect

- Project import first lists recent workspaces from local session metadata. It
  inspects source only after you choose one exact project, then routes it to
  SubApp conversion, existing Skill publishing, or bounded Skill generation.
- Creator Profile requests create a local editable preview page.
- Creator Center requests may ask you to sign in to Taku.
- Publishing requests scan and package the selected workspace before opening
  the Taku review flow.
- Marketplace search covers Apps, Skills, Tools, and Bundles. Codex Skill
  installs require an explicit confirmation before installing the selected item.
- In terminal sessions, App searches show a numbered list without raw Taku
  protocol links. Choose one item and the plugin will open it in Taku Desktop.

The agent reads `skills/taku-publisher/SKILL.md` for detailed workflow rules.
You usually do not need to run the bundled CLI commands yourself.
