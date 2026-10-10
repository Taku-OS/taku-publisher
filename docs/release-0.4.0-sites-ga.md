# 0.4.0 complete Sites GA candidate (TAKU-527)

Status: local candidate only. No tag, release, Marketplace update, npm publication or production deployment is performed by this change. Parent review and the existing Git/CI rollout decide publication. Do not announce ordinary-account GA until the server, migrations, current policy and required distribution are verified.

## Source and compatibility

- Preserve native main `1dd49b5beea1e7bd9f31eef5e352d3df99e43151`, its three-host layouts and independent Publisher-only profile. Preserve the frozen image candidate `8a26744be6e67b1c2d403460bc037c47e19fa24c`; do not overwrite old tags or assets.
- Reuse the reviewed owner-material, publish recovery and source-integrity implementation from `01569ea8d4e09dbbc9cf27f77bcec7e20cfe87fd`, adding only that GA closure to the image candidate. Existing native scripts and stronger fixed-v1/budget-v2 regression tests remain.
- Generate the complete CLI/browser SDK using the existing sync from Platform `92e630ab536e9b4d60548ad9b19c8856e9533c26`, based on released main `27852d4d969894330a59c2b129a656a522d792a7`. Its entire source tree equals audited immutable `0300ad873a7194f51755dbf4b3cd5ef65c7a6aba`; provenance records the actual new commit, not the earlier image-only entrypoint.
- Preserve all already integrated/verified models, legacy fixed-v1 quotes/receipts, original storage APIs and SQL action IDs. No model, provider secret, client authority, capability permission or pricing policy is added. A v1 quote's `credits` is a fixed price; v2 `maximumCredits` is a user-approved ceiling, not a final charge. Only a settled receipt's `chargedCredits` is the actual debit, never more than the agreed maximum.

## Required server rollout

Workers owns ordinary-account eligibility, membership quotas and Free first-Site entitlement. Expand its approved schema and confirm the durable usage-admission, monthly quota/freeze/restore, capacity and owner-asset contracts before enabling the current production policy through reviewed Git/CI. Do not repeat already-applied image migrations.

Platform uses signed `database-admissions` admit/settle/status and Provisioner `immutable-v5-database-fence`, per-job/attempt database policy and migration begin/finish. Unknown SQL side effects hold admission; completed duplicates never replay SQL. A new SDK or claim protocol does not upgrade every legacy runtime. Retain the original reconciliation, legacy artifact binding and immutable-runtime rollback paths.

Owner operations require the separate live `owner_assets` contract, not visitor scopes. Media uploads bind the confirmed artifact-v2 manifest and use bounded 8 MiB parts; capacity is shared by the owner's account, not reset monthly. Personal/shared SQL quotas remain per Site/month. Existing 20 ms CPU/8 subrequest limits are unchanged. User-controlled identifiers and local checkpoints never authorize billing or ownership.

## Distribution candidate

Version **0.4.0** is a new numeric minor candidate, with equal Codex/Claude Code/Cursor manifests. Recheck tag/release occupancy immediately before the parent-authorized release. Publish both `taku-publisher` and `taku-sites`, not merely the independent Publisher-only native profile.

- `npm run pack:installer`: builds both portable Skills, all three standard host adapters, the versioned installer tarball/identical alias and Cursor-importable marketplace ZIP. Local `npm pack` is not npm registry publication.
- `npm run build:marketplace`: prepares the existing standard combined three-host GitHub layout. It does not push the Marketplace branch.
- Preserve `npm run build:native`, `smoke:native` and the existing native workflow; their Publisher-only output is not the complete GA release.
- Verify reviewed source commit/clean state, generated SDK hashes, package inventory and download hashes before distributing. Official store listing is separate; do not imply it exists. Retain trusted prior assets and source refs; the known defective v0.3.28 Sites path is not a verified rollback.

## Local verification scope

Relevant image/owner/publish/SQL/source integrity modules, runtime types, repository audit, two-Skill installer tests, copied-Skill executable examples and Node-only three-host pack smokes. BRIA sparse controls are explicitly rejected before quote/submit. No Electron, GUI, full user journey/ten-app suite, new paid provider call or invoice reconciliation is a local gate. Historical true-PG evidence belongs to the existing SDD and Workers review, not a claim that this CLI has exercised current production. Final SHAs, command results and archive hashes are recorded in the ignored local handoff for review.
