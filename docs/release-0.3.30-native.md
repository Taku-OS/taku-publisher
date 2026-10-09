# Publisher 0.3.30 native channel candidate

This is local release preparation, not a published release. Source base is main
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
This candidate advances versions and packaging, without changing Publisher
business logic or importing unmerged features.

`release.json` records the source commit, source tree SHA-256, clean/dirty state,
all host file inventories and archive checksums. Each host archive has its own
marketplace entry and provenance. `npm run smoke:native` refuses dirty source
provenance by default and verifies archive contents and host runtime parity.
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

## Kristen acceptance on approved production installation

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

Production steps 2, 4 and 5 remain unverified in local preparation. Paid icon or
Flowchart generation requires explicit approval before testing. Do not infer a
production launch date from local checks.

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

No push, PR, merge, release, deployment, paid call, production login, public
publication or user App restart is authorized by this preparation itself.
