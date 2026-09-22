# Cursor and Agent Skills installer 0.3.27

This documents the separate `--auth-site-url` override in the creator CLI and
aligns the legacy Python compatibility entrypoint with the Node runtime. Local
and preview authorization can target their own Web host without changing the
Publisher product site. The production plugin is still named
`taku-publisher`, without a test-version suffix. Distribution is through the
GitHub `marketplace` branch and the `v0.3.27` release assets. It is not
published to npm or listed in the official Cursor Marketplace.

Install or update to the latest release directly from GitHub (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/latest/download/taku-publisher.tgz taku-publisher install --host cursor --update
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/latest/download/taku-publisher.tgz taku-publisher install --host agent-skills --update
```

The stable `taku-publisher.tgz` asset is byte-for-byte identical to the
versioned installer in that release. Use the versioned asset below when an
installation must be pinned for reproducibility or rollback.

Download `taku-publisher-0.3.27.tgz` from the trusted
[GitHub release](https://github.com/Taku-OS/taku-publisher/releases/tag/v0.3.27),
then run from the download directory (Node.js 20+):

```sh
npx --yes --package ./taku-publisher-0.3.27.tgz taku-publisher install --host cursor
npx --yes --package ./taku-publisher-0.3.27.tgz taku-publisher install --host agent-skills
```

The `agent-skills` target installs to `~/.agents/skills/taku-publisher`.
OpenCode discovers this shared directory by default. Its local adapter reads
bounded project metadata and explicit per-session Token counters without
querying prompts or messages. Quit and restart the host after installation so
it loads the new Skill.

## Build and install locally

Requires Node.js 20+ (npm is only needed to build or use a tarball).
Exact local Cursor and OpenCode token reading additionally uses the optional
`sqlite3` command. If it is missing or a host has no explicit counters, token
usage is reported as unavailable; Card editing, project discovery and publishing
remain usable.

```sh
npm ci
npm run pack:installer
node dist/installers/cursor/bin/taku-publisher.mjs install --host cursor
node dist/installers/cursor/bin/taku-publisher.mjs install --host agent-skills
```

The last command installs the complete Skill into the current user's
`.cursor/skills/taku-publisher`. To keep testing project-local:

```sh
node dist/installers/cursor/bin/taku-publisher.mjs install --host cursor --scope project --project /absolute/path/to/project
```

Existing unmanaged Skills or locally edited managed installs are refused.
For an unmodified managed install, explicit `--update` creates a recoverable
backup under `.cursor/publisher-backups` outside Cursor's Skill discovery tree.
Reinstalling identical bytes is idempotent. Do not delete an existing Skill
just to force an installation; use a clean project or review and back it up.
For a previously manually copied, unmanaged Skill, explicit `--backup-existing`
moves the entire old directory to a recoverable backup before installing.
It does not bypass protections for edited managed installs.

The local npm tarball is `dist/releases/taku-publisher-0.3.27.tgz`:

```sh
npx --yes --package ./dist/releases/taku-publisher-0.3.27.tgz taku-publisher install --host cursor
npx --yes --package ./dist/releases/taku-publisher-0.3.27.tgz taku-publisher install --host agent-skills
```

This tarball command uses a local file, not a released npm package. A public
`npx --yes --package @taku/publisher@0.3.27 taku-publisher install --host cursor`
command must not be advertised until package ownership and npm publication
are confirmed. Installation checks bundled file hashes; hashes detect
corruption, not publisher authenticity. Obtain the package from a trusted source.

## Cursor plugin / GitHub distribution

`dist/marketplaces/cursor/taku` is the complete GitHub-importable bundle with
its root `.cursor-plugin/marketplace.json`. The ZIP in `dist/releases` has the
same structure. `npm run build:marketplace` also creates the combined
three-host distribution at `dist/marketplace-release`, preserving the existing
Codex/Claude production paths and adding `plugins/taku-publisher-cursor`.
The GitHub `marketplace` branch exposes all three marketplace manifests at
their required root paths. Select that branch for GitHub import; source-only
`main` does not expose the Cursor marketplace manifest at its root.

Official store submission is separate from both GitHub and npm distribution.
Use the current Cursor submission checklist before submitting.

## Minimal acceptance test

Open the chosen project in Cursor, start a new Agent chat, and use
`/taku-publisher`. Confirm the executed Skill path, not just the project title.
Check its version from that same Skill directory:

```sh
node scripts/taku-publisher.mjs --version
```

1. “使用 Taku Publisher 开始 Stax Challenge，扫描 Cursor 最近 30 天使用记录，生成私有 Stax Card，返回可编辑 Studio 地址，同时列出候选 Skill，让我选择一个或跳过；先不要上传或公开发布。” With a valid session, generation proceeds automatically. First use opens browser sign-in; after authorization the same command resumes. Missing recorded token counts must remain unavailable, not estimated.
2. “把我选定的这个 Skill 准备发布到 Taku，先做安全检查和打包，不要公开发布。” Confirm exact source selection, review, packaging and private review/Studio handoff. Public release still requires confirmation in Taku Web.
3. “评估这个本地 App 能否转为 Taku SubApp，先只评估。” Preparation, current-Agent migration, static verification and Desktop installation each retain their confirmation gates.

No new AI runner is launched. Marketplace buyer Skill installation currently
targets Codex only. Public SubApp release remains unsupported. Local fixture
tests do not establish that a real App renders in Taku Desktop or that a real
Skill has been uploaded; those need a selected source and explicit authority.

## Release gate

Run audit, Node/Python tests, adapter validation, all-host Node-only smoke,
installer tests, packaging checks and `npm run smoke:clean` after committing.
For an uncommitted candidate, add `-- --working-tree` to export the current
sources rather than old HEAD. Final release builds must use the reviewed
release commit. Follow CONTRIBUTING.md for delivery tracking. Preserve production
authorization and endpoints; do not import the old preview-only Challenge package.
