# Publisher 0.3.30 native release and QA

This release updates the Publisher-only native channel independently of Sites.
The authoritative release status and downloadable archives are on the
[v0.3.30 GitHub release](https://github.com/Taku-OS/taku-publisher/releases/tag/v0.3.30).
Source base is main
`defd24a649338e32c15ea89c19104aaea7f2eeb9`; production marketplace base is
`e7ee4c7bef7625725ca8069340c7d235acad9436` (0.3.27). PRs 51–53 are excluded.

## Independent channel

`npm run build:native` creates `dist/native-publisher/marketplace-release` and
three `dist/native-publisher/releases/taku-publisher-<host>-0.3.30-native.zip`
archives. The native profile registers only `taku-publisher`. Its runtime is
shared with the standard adapter build. No Sites Skill or new Sites GA code is
included; existing runtime Sites commands still require the dedicated session
and server-verified internal eligibility. The standard two-Skill adapters and
Cursor/Agent Skills installer remain available through their existing commands.
This release advances versions and packaging, without changing Publisher
business logic or importing unmerged features.

`release.json` records the source commit, source tree SHA-256, clean/dirty state,
all host file inventories and archive checksums. Each host archive has its own
marketplace entry and provenance. `npm run smoke:native` refuses dirty source
provenance by default and verifies archive contents and host runtime parity.
The native adapter build removes stale compiled outputs and rebuilds the runtime
before recording each adapter inventory. Marketplace generation checks those
inventories before packaging, so changed generated adapters cannot acquire fresh
source provenance. Clean-copy smoke also verifies the source checksum stays
unchanged after tests and builds, excluding the converter's generated test workspaces.
Use `node scripts/native-release-smoke.mjs --allow-dirty` only during local
implementation; those bundles must not be promoted.

The manually dispatched **Prepare Publisher native candidate** workflow verifies
and uploads reviewable build artifacts with read-only repository permissions.
It does not sync/push marketplace, publish an npm/GitHub release or deploy.
A Publisher native update can therefore be reviewed and promoted independently
of the full Sites release.

## Local verification

Run with Node.js 20+ and Python 3.10+ (CI uses Node 22 / Python 3.11). Use a
fresh HOME and TAKU_PUBLISHER_HOME, not the creator's real install/configuration.

```sh
npm ci
npm run audit:repo
npm test
npm run build:native
npm run smoke:native
for host in codex claude cursor; do
  node scripts/no-python-plugin-smoke.mjs "$host" \
    "dist/native-publisher/marketplace-release/plugins/taku-publisher-$host/skills/taku-publisher"
done
npm run smoke:clean
```

The controlled acceptance smoke uses copied plugins, documentation-only local
Skill fixtures, a minimal environment without user credentials/GitHub CLI, and
loopback Worker endpoints. It verifies discovery, real Card generation and
renderer save, offered candidate selection, scan/review/package, private draft,
byte-verified upload, final Web-confirmation action and remote status. A separate
simulated Web actor changes the fixture to published; the Publisher CLI does not
submit a release. This does not verify production login, live legal/rights
acceptance, generated icon/Flowchart billing, real host plugin loader/update UI,
or an actual public release.

The existing default installer smoke and installer unit tests verify complete
payload installation, idempotency, protected unmanaged/edited installs and
backup-preserving updates. Native host cache replacement/rollback is tested only
in temporary directories against the actual marketplace 0.3.27 bundle; user
host restart or real installation needs separate approval. Old Sites credentials
are not a verified rollback path.

## Verification and QA follow-up

The reviewed implementation passed 576 local regressions and clean-copy smoke.
Codex and Claude's actual plugin managers verified isolated install, upgrade,
rollback and restoration; Codex app-server loaded the installed Publisher Skill.
Cursor 3.23.12's native loader verified install and update. The isolated Cursor
3.24.9 workbench did not complete extension-host startup, including with fresh
user-data and normal launch flags; its native rollback loading and UI remain
unverified. This does not establish a Publisher plugin failure.

Production browser sign-in succeeded, but the private draft request from the
test account was rejected before upload with `creator_profile_required`.
Production private draft/upload, Web review/status, session recovery, legal
confirmation, paid generation and public Skill submission remain QA follow-ups.
The release owner authorized formal native publication with these disclosed
items assigned to QA; they are not claimed as passing production checks.

## Kristen QA on approved production installation

1. Confirm the exact installed `taku-publisher` version is 0.3.30, with only the
   Publisher Skill exposed by this native plugin. Start a new Agent session.
2. Ask: “生成我的私有 Stax Card，打开 Challenge Review，列出候选 Skill，
   让我选择一个或跳过。先不要上传或公开发布。” Finish browser authorization
   personally; verify account identity, Card renderer and candidate list.
3. Skip once without remote publication. In a fresh Card flow, select one exact
   offered Skill. Review the immutable staged files and scan dispositions;
   package it and inspect the result before requesting any upload.
4. Only after separate authorization, upload/register one private draft. Verify
   the listing, scan and bundle refer to that Skill, and the returned URL points
   to that draft. The CLI must stop at `review_and_submit_on_taku_web`.
5. Only the creator may accept legal/license terms and confirm the public
   release in Web. Read `remote-status` afterward; do not resubmit because a
   local state still says awaiting confirmation.

Use an existing Creator account for steps 2, 4 and 5. Confirm private draft/upload
and Web review/status before any public business submission. Also verify native
install/update/rollback in Cursor 3.24.9 and session recovery after expiry.
Paid icon or Flowchart generation requires explicit approval before testing.

## Promotion and rollback

After source and generated diff approval, publish/review the source commit and
update the existing marketplace paths in a separate marketplace PR, following
PR 47's pattern. Recheck both remote heads before promotion and resolve drift;
never overwrite concurrent updates. Keep `release.json.sourceDirty=false` and
its exact source commit/checksum. Verify host archive SHA-256 before import.
Retain the previous marketplace commit and verified host archives outside host
Skill discovery directories; the updater must preserve user modifications.
Rollback the native plugin to the retained 0.3.27 artifact after user approval,
then start a fresh Agent session. This restores Publisher plugin bytes and does
not establish Sites service/session compatibility.

This release guide does not itself authorize paid calls, public Skill submission,
new credential permissions or a user App restart. Native GitHub publication and
business Skill publication are separate actions.
