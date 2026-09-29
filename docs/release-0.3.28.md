# Taku Publisher 0.3.28 — Taku Sites Skill

Taku Publisher 0.3.28 ships the `taku-sites` Skill in the standalone installer
next to `taku-publisher`. The host agent builds, runs, and tests the Site in its
own harness. The bundled CLI only handles the parts that need Taku.
During internal testing, the server limits Sites to verified @taku.ai accounts.

## What changed

- The installer installs both `taku-publisher` and `taku-sites` by default.
  Use `--skill taku-publisher|taku-sites` to install only one.
- The Sites flow is: `sites-login` → `sites-contract` → build and test in the
  host harness → `sites-validate` → the user enters an exact subdomain →
  availability check → explicit confirmation → `sites-publish` →
  `sites-status`.
- `sites-contract` returns the server's live capability catalog
  (`GET /v1/sites/capabilities`) unchanged. It has no offline fallback: without
  a session or network it fails with a clear error.
- The Publisher-side `sites-preview` command has been removed. Preview and
  testing now happen in the host agent's own harness. The Skill explains that
  `/__taku/*` capabilities must be stubbed locally.
- The Skill references cover the project contract, the browser SDK vs Worker
  boundary, scopes and credits, storage choices, and local testing.
- The bundled Sites CLI core and browser SDK are synced from
  `taku-sites-platform` 716bed6. Use `npm run sync:sites-core` to sync again.

## Install

Cursor (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.28/taku-publisher-0.3.28.tgz taku-publisher install --host cursor --update
```

OpenCode and compatible Agent Skills hosts (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.28/taku-publisher-0.3.28.tgz taku-publisher install --host agent-skills --update
```

Codex and Claude Code marketplace installs are unchanged (see 0.3.27). Start a
new host session after installation so it loads the updated Skills.
