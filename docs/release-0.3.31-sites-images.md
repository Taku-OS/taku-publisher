# TAKU-527: limited Sites images candidate 0.3.31

This is an unpublished local candidate, not proof of installed clients or a
production model's readiness. It adds authenticated image model metadata,
browser image execution/quote recovery, parameter/input contract support and
guidance to the existing two-Skill installer.

The three host manifests use numeric version 0.3.31. Preserve the existing
v0.3.30 Publisher-only native release and Marketplace branch; do not use the
native Publisher-only build for Sites. No owner material, quota, publication
authorization or SQL admission feature is included.

## Source layers

The vendored CLI core and browser SDK are generated with the existing sync
script from Taku-OS/taku-sites-platform commit
`1495a49d6aff41e3119294edbcda982d0b997b20`. The provenance records that exact
source and both generated bundle hashes. This image-only release source retains
main's SQL and other non-image entrypoints. Its common image sources match the
immutable full SDK source `0300ad873a7194f51755dbf4b3cd5ef65c7a6aba`, but four
mixed Platform files deliberately exclude non-image GA changes. Do not claim
the complete SDK entrypoint or bundle has the same hash as 0300ad8, or merge that
source branch to publish this candidate. The original Publisher feature branch
and frozen full SDK remain separate and are not replaced.

Quote v1 `credits` remains a fixed quote. Quote v2 `maximumCredits` is a maximum
budget confirmed before submission, not a final price or an already charged
amount. Only a settled receipt's `chargedCredits` is the actual charge; preserve
the original request/execution/quote identity during recovery.

## Local gates and delivery

Run `npm run test:sites-images`, the Publisher runtime TypeScript no-emit check,
`npm run audit:repo`, `npm run pack:installer`, `npm run smoke:installer`,
`node scripts/sites-skill-smoke.mjs`, all-host Node-only plugin smoke and
`npm run checksum:source`. Rebuild packages from the reviewed clean candidate
commit. These module/fixture/package checks are not full Harness, live billing,
GUI or a complete formal distribution matrix.

`pack:installer` builds the standard two-Skill adapters and creates local
`dist/releases/taku-publisher-0.3.31.tgz`, its identical local
`taku-publisher.tgz` alias and the Cursor Marketplace ZIP. It does not publish to
npm, GitHub Releases or the Marketplace branch. Do not upload that alias as a
latest release or replace v0.3.30 native assets.

After root review and explicit distribution authorization, a distinct pinned
v0.3.31 GitHub prerelease/non-latest asset may deliver this limited installer.
Verify the exact source commit, hashes and versioned asset before advertising it.
Until then, no remote install command is a completed delivery claim. Node.js 20+
and `--skill taku-sites` select Sites without changing an existing Publisher
installation; managed edits/unmanaged installs still require the installer's
existing safety gates. Restart the host/new Agent session to load a new Skill.
