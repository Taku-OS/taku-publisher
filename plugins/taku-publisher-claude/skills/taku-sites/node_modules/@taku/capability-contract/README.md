# @taku/capability-contract

Canonical, host-neutral contracts for Taku Passport capability discovery and packaging.

The package exports:

- `taku.capability-snapshot.v1` private local discovery snapshots.
- `taku.package.v1` import/publish package manifests.
- Capability kind normalization, stable IDs, eligibility policy and publish projection.
- Runtime assertion, canonical JSON and SHA-256 helpers.
- JSON Schemas and a cross-repository canonical fixture.

Private snapshots may contain local locators. Public/package manifests must never contain absolute local paths, environment values, credentials, sessions, raw prompts or raw source content.

Publishing rules in v0.2.0:

- `workflow` projects to `action` only for the publish channel.
- `rule` is not publishable.
- `mcp` is local-only and not publishable.
- `plugin` publishing requires an approved review covering every requested permission.

`taku.ai-setup.v1` is read-only compatibility input. New snapshots are always generated as `taku.capability-snapshot.v1`.
