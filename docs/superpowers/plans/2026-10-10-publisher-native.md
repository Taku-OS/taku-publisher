# Publisher native update implementation plan

> **For agentic workers:** Use superpowers:executing-plans; the user authorized native execution and one independent final reviewer.

**Goal:** Prepare an independently promotable Publisher-only native plugin update for Codex, Claude Code and Cursor, with controlled local acceptance evidence.

**Architecture:** Keep the standard two-Skill adapters and installer compatible. Add a Publisher-only build profile in a separate generated directory; preserve the trusted main runtime and server authorization restrictions. Generate inventories, source checksum, and deterministic host archives before preparing an isolated marketplace branch.

**Tech Stack:** Node.js ESM, TypeScript, node:test, existing Python regression suite, existing ZIP and installer tooling.

**Spec:** User delegation in this task and the short implementation design recorded in chat.

## Global constraints

- Base main: defd24a649338e32c15ea89c19104aaea7f2eeb9; marketplace: e7ee4c7bef7625725ca8069340c7d235acad9436.
- Candidate 0.3.30; no push, external PR, merge, deployment or public release.
- Native profile includes only taku-publisher; default installer retains taku-sites and its current internal eligibility gate.
- No PR 51/52/53, Sites GA changes, Translator changes, credentials, paid calls or production writes.
- Temporary configuration only; no installed host plugins or user App restarts.

## Review focus

- Native build must not overwrite standard generated outputs or include the Sites Skill.
- Host manifests, marketplace paths and skill versions must agree; common runtime inventories must agree.
- Corrupt/missing archives, changed content or dirty provenance must not be accepted as a promotable bundle.
- Existing managed install updates preserve backups; edited/unmanaged installs are protected.
- Web confirmation remains required and local/package status must not be described as publicly published.

## Task 1: Packaging checks and native profile

Files: scripts/build-adapters.mjs, scripts/challenge-test-smoke.mjs, scripts/native-release.test.mjs, package.json, adapters/*/taku-publisher/*/plugin.json.

- [x] Run baseline tests and reproduce the Challenge smoke version failure.
- [x] Add failing native profile test asserting one Skill, version identity, runtime equality, and unchanged standard output.
- [x] Add isolated --publisher-only profile and 0.3.30 candidate manifest versions.
- [x] Replace stale Challenge smoke literals with expectations from the independently built standard version and exact next-patch arithmetic; retain all workflow assertions.
- [x] Run regression and profile tests.

## Task 2: Promotable marketplace artifacts

Files: scripts/build-marketplace-release.mjs, scripts/native-release.test.mjs, scripts/native-release-smoke.mjs, .github/workflows/publisher-native.yml, docs/release-0.3.30-native.md.

- [x] Add failing assertions for source checksum, clean source, per-file integrity and archive contents.
- [x] Extend marketplace builder for native profile, deterministic host ZIPs and provenance.
- [x] Validate runtime and archive identity, including negative corruption/version cases.
- [x] Add manually dispatched build/verify/upload workflow with read-only repository permissions and no marketplace write.
- [x] Document Kristen acceptance, explicit production gaps and promotion/rollback steps.

## Task 3: Controlled acceptance and local delivery

- [x] Run complete tests, standard installer and native no-Python smoke on three hosts.
- [x] Run packaged Card/candidate/scan/package/draft/status/Web-confirmation flow against loopback fixtures only.
- [x] Test fresh installs and upgrade/rollback to actual 0.3.27 bundle in isolated directories; retain old artifacts.
- [ ] Commit source; run clean-copy smoke from git archive HEAD with task-local npm cache.
- [ ] Generate final clean artifacts; prepare marketplace branch/diff on verified marketplace base.
- [ ] Independent reviewer examines source and generated marketplace patch; resolve important findings and repeat affected checks.
- [ ] Deliver commits, worktrees, tests, checksums, unverified production checks and minimal release confirmation.
