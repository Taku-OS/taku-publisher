# Taku Publisher

Taku Publisher is a Claude Code plugin for converting existing repositories
into local Taku SubApps, and for finding, installing, managing, and publishing
Taku AI tools.

## Install

Most users should install this plugin from the Taku Claude Code marketplace
package:

```sh
claude plugin marketplace add /path/to/dist/marketplaces/claude/taku
claude plugin install taku-publisher@taku
```

If you are testing this single plugin directory directly, add it through the
Claude Code plugin flow that accepts local plugin paths.

Start a new Claude Code session after installation.

Do not paste the plugin or marketplace path into the chat as the workspace to
scan. Those paths are only for installation. To generate your Creator Profile,
open Claude Code in the project or workspace you want Taku Publisher to scan.

## Try It

Ask Claude Code:

```text
Use Taku Publisher to generate an editable Creator Profile preview.
```

Other useful prompts:

```text
Convert this repository into a Taku SubApp and install it locally.
Show my Taku Creator Center.
Find a tool in the Taku community.
Publish the tool in this workspace to Taku.
```

## What To Expect

- Creator Profile requests create a local editable preview page.
- SubApp conversion assesses the selected source, prepares an isolated
  candidate, validates it in a trusted runtime, and packages it before asking
  Taku Desktop to install. Nothing is publicly published by this local flow.
- Creator Center requests may ask you to sign in to Taku.
- Publishing requests scan and package the selected workspace before opening
  the Taku review flow.
- Marketplace search covers Apps, Skills, Tools, and Bundles. Search and details
  work in Claude Code, while Codex Skill installation remains Codex-only.

The agent reads `skills/taku-publisher/SKILL.md` for detailed workflow rules.
You usually do not need to run the bundled CLI commands yourself.
