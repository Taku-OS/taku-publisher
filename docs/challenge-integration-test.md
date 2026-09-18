# Stax Challenge integration acceptance

The activity build starts from the official **0.3.21** source at `4eb91bf`.
The production plugin remains named `taku-publisher` and uses
the `standard` channel. Separate three-host acceptance packages are named `taku-publisher-challenge-integration-test`
and use a `0.3.22-stax-challenge.b<source-checksum>` version. They are not a new
production installation entry point. No npm or official Cursor store publication is included.

## What changed

Production's three-host runtime, Challenge handoff, normal Card, App, Skill and
Creator Center modes, and AI Burn normalization are retained. An ordinary
"create/generate Stax Card" request uses Challenge mode and opens the Review
page. The test LP is `http://localhost:3001`; API and draft operations keep the
production Worker `https://worker.taku.ai`. Skill choice stays in the current
Codex, Claude Code or Cursor Agent. No browser-to-local bridge, background
Agent, global latest-draft fallback or public auto-submit is included.

AI Burn uses the production-test interval `2026-09-17 00:00` through
`2026-09-20 23:59:59` in Asia/Shanghai. The official `2026-09-22` through
`2026-10-30` schedule is stored next to it, and switching periods is isolated
to the active schedule constant in `creator/scripts/activity-periods.mjs`.

## Run

Build with `npm ci && npm run build:challenge-test`. Independent marketplaces
and ZIPs are under `dist/challenge-test/{codex,claude,cursor}`. Cursor can use the
project-local `.cursor/skills/taku-publisher-challenge-integration-test` copied from this
build. Do not install into the production plugin name or overwrite global caches.
Open this test checkout and start a **new Agent chat**, so old Skill paths are
not reused. Invoke `taku-publisher-challenge-integration-test` explicitly; the
distinct name avoids the older `taku-publisher-stax-challenge-test` Skill.

First prompt:

```text
使用当前项目的 taku-publisher-challenge-integration-test，生成私有 Stax Card，打开 Stax Challenge Review 页面，同时列出候选 Skill。先不要上传或公开发布。
```

Expect one private Card/actual Challenge Review URL and Skill choices in the same response.
If the account lacks a valid grant, the plugin opens authorization and the same
command resumes after the user approves it. A valid scoped session is reused.
Opening/signing into the account and reviewing the Card remain user actions;
the user should not need to rerun CLI commands manually. With no candidates,
Card editing remains available without a required Skill selection.

Select one candidate (replace the placeholder):

```text
选择刚才的 <Skill名称或候选ID>，我确认有权发布它。请完成安全审查并在本地打包，先不要上传。发现风险就停下并说明。
```

Expect only that exact Skill to be staged, scanned and semantically reviewed
by the current Agent. Packaging requires real review decisions. A blocked scan
must not be bypassed. No other Skill source or remote draft should be modified.

Optional private-upload test, only after you authorize uploading this Skill:

```text
把刚才审查通过的这一个 Skill 上传为私有草稿，返回 Taku Web 审核地址，不要自动公开发布。
```

Expect normal icon/listing/auth/bundle gates and the actual Worker-returned
review URL. Repeating preparation must not create a second draft. Public Skill
submission is a separate user confirmation on Taku Web; local `status` is not
proof that a Skill was publicly published. `remote-status` verifies that claim.

Also test `跳过 Skill，只编辑 Card` before preparation, and make one explicit
Profile/Studio, App, or Creator Center request to confirm Challenge does not replace those routes.
Use a fresh production install on all three hosts for post-release acceptance;
checking an isolated test package does not verify the public installation entry point.
