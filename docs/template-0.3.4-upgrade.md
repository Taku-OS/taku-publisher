# Bundled template 0.3.4 upgrade

Publisher now prepares new SubApp candidates from template tag `taku-3.0.4-template`, pinned to commit `834f1103599fe96ba1e98878bd5890b0d72d0b34`. The vendored template is an unchanged copy of that commit. Publisher release versioning is separate from the template version.

Taku Desktop creates new Planner apps from the same `taku-3.0.4-template` tag, so Publisher candidates and Planner apps share one Host Agent Runtime contract.

## Compatibility changes

- Preserve and validate optional `runtimeCapabilities` declarations in both the converter and shared runtime manifest contract. Declarations use `taku.agent.run/v2`, with at most 64 unique operation/revision pairs. They do not authorize execution; the authenticated Host grant remains authoritative.
- Keep offline apps opted out by default. Reject provider/model/grant fields in declarations.
- Pin the new Host attestation route, Runtime SDK, proxy files, launch scripts and ordered rewrites to approved hashes. Authority-file reads remain bounded at 128 KiB to accommodate the SDK.
- Synchronize converter and Publisher agent read-only paths.
- Exclude unchanged upstream Runtime SDK tests from the migrated application's product-test requirement, including copies under other filenames.
- Use the bundled template by default in the canonical-template smoke test.
- Allow only the exact two additional synthetic upstream test literals in repository auditing; preserve upstream bytes.

## Changes from 0.3.3

`taku-3.0.4-template` changes 14 files relative to `taku-3.0.3-template`. None of the pinned authority files changed: the launch scripts, `next.config.ts`, Host RPC, manifest and attestation routes, Runtime SDK sources and proxy files are byte-identical. The converter therefore only updates:

- the upstream Runtime SDK test digests: `src/lib/taku-runtime/contract.test.ts` changed, and the new `src/lib/taku-runtime/qa-cancellation.test.ts` is excluded from the product-test requirement in the same way as the other upstream SDK tests;
- the pinned provenance, the canonical-template smoke check and the prepare test expectation.

## Validation and rollout boundary

Run `npm test`, `npm run audit:repo`, `npm run smoke:plugin`, `npm run smoke:contract`, and `npm run smoke:canonical-template --workspace repo-to-stax-converter` with Node 22 and a supported Python version. The upstream template also passes `release:check`, `type-check`, `ci:check`, `test`, and `build` under Node 22.

Existing generated candidates are not rewritten automatically. Regenerate or migrate them separately while preserving product code. This change does not publish a Publisher release or prove live Desktop Host grants, billed AI calls, or production runtime compatibility. Those require a Desktop integration check before release.
