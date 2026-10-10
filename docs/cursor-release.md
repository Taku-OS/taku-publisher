# Cursor and Agent Skills installer 0.4.0: complete Sites GA candidate

Version 0.4.0 is an unpublished complete Sites GA candidate for TAKU-527.
The source layers and required rollout are documented in
`docs/release-0.4.0-sites-ga.md`. Local module tests and packaging do not prove
production eligibility, distribution, live model readiness or billing.
Use the pinned assets below only after review and an authorized, verified
release. Preserve v0.3.30 Publisher-only native assets and all existing
Marketplace paths. The frozen 0.3.31 image-only candidate is historical,
not this complete version. Version 0.3.28 has a known publish-path defect and
is not a verified Sites rollback.

This release installs two Skills from one package: `taku-publisher` and
`taku-sites`. Taku Sites lets the host agent build and test a Site with its own
tools, then use the bundled CLI to sign in, read the live capability catalog,
validate, and publish to an exact, user-confirmed `*.taku.site` subdomain.
Sites access and capacity are decided by the current authenticated server
policy; the installed Skill version and email domain do not prove eligibility.
Pass `--skill taku-publisher` or `--skill taku-sites` to install only one.
The production plugin is still named
`taku-publisher`, without a test-version suffix. Distribution is through the
separate, pinned `v0.4.0` release assets after authorization. The reviewed GA
rollout must also deliver both Skills through the existing three-host GitHub
`marketplace` layout. No branch publication is performed by local packaging.
It is not published to npm or listed in the official Cursor Marketplace.

After that release exists, install only Sites from its pinned asset (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.4.0/taku-publisher-0.4.0.tgz taku-publisher install --host cursor --skill taku-sites --update
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.4.0/taku-publisher-0.4.0.tgz taku-publisher install --host agent-skills --skill taku-sites --update
```

Do not use `releases/latest` or replace v0.3.30 native assets. The local
`taku-publisher.tgz` alias is byte-for-byte identical to the versioned candidate,
but that local alias is not evidence of an uploaded stable installer.

Download `taku-publisher-0.4.0.tgz` from the trusted, reviewed release only once
[v0.4.0](https://github.com/Taku-OS/taku-publisher/releases/tag/v0.4.0) exists,
then run from the download directory (Node.js 20+):

```sh
npx --yes --package ./taku-publisher-0.4.0.tgz taku-publisher install --host cursor --skill taku-sites
npx --yes --package ./taku-publisher-0.4.0.tgz taku-publisher install --host agent-skills --skill taku-sites
```

The `agent-skills` target installs to `~/.agents/skills/taku-publisher` and
`~/.agents/skills/taku-sites`; the `cursor` target uses `~/.cursor/skills/`.
OpenCode discovers this shared directory by default. Its local adapter reads
bounded project metadata and explicit per-session Token counters without
querying prompts or messages. Quit and restart the host after installation so
it loads the new Skill.

## Build and install locally

This source branch prepares 0.4.0 locally. The remote download instructions
above are conditional, not an announcement that 0.4.0 is published. The
existing 0.3.30 Publisher-only native profile is a separate distribution; its
packaging layout and published assets are not replaced by this GA candidate.

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

The local candidate npm tarball is `dist/releases/taku-publisher-0.4.0.tgz`:

```sh
npx --yes --package ./dist/releases/taku-publisher-0.4.0.tgz taku-publisher install --host cursor --skill taku-sites
npx --yes --package ./dist/releases/taku-publisher-0.4.0.tgz taku-publisher install --host agent-skills --skill taku-sites
```

This tarball command uses a local file, not a released npm package. A public
`npx --yes --package @taku/publisher@0.3.29 taku-publisher install --host cursor`
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

## Post-release QA (not a local GA development gate)

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
