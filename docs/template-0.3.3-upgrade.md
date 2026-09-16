# Bundled template 0.3.3 upgrade

Publisher now prepares new SubApp candidates from template tag `taku-3.0.3-template`, pinned to commit `fbe79d41ba1592336b9a915877bc6c2bbd1cfd03`. The vendored template is an unchanged copy of that commit. Publisher release versioning is separate from the template version.

## Compatibility changes

- Preserve and validate optional `runtimeCapabilities` declarations in both the converter and shared runtime manifest contract. Declarations use `taku.agent.run/v2`, with at most 64 unique operation/revision pairs. They do not authorize execution; the authenticated Host grant remains authoritative.
- Keep offline apps opted out by default. Reject provider/model/grant fields in declarations.
- Pin the new Host attestation route, Runtime SDK, proxy files, launch scripts and ordered rewrites to approved hashes. Authority-file reads remain bounded at 128 KiB to accommodate the SDK.
- Synchronize converter and Publisher agent read-only paths.
- Exclude unchanged upstream Runtime SDK tests from the migrated application's product-test requirement, including copies under other filenames.
- Use the bundled template by default in the canonical-template smoke test.
- Allow only the exact two additional synthetic upstream test literals in repository auditing; preserve upstream bytes.

## Validation and rollout boundary

Run `npm test`, `npm run audit:repo`, `npm run smoke:plugin`, `npm run smoke:contract`, and `npm run smoke:canonical-template --workspace repo-to-stax-converter` with Node 22 and a supported Python version. The upstream template also passes `release:check`, `type-check`, `ci:check`, `test`, and `build` under Node 22.

Existing generated candidates are not rewritten automatically. Regenerate or migrate them separately while preserving product code. This change does not publish a Publisher release or prove live Desktop Host grants, billed AI calls, or production runtime compatibility. Those require a Desktop integration check before release.
