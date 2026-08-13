# Taku Passport Architecture

## Product boundary

Taku Passport is the product and capability-platform boundary. Publisher is one Passport module responsible for review, packaging, authorization, upload, and publication.

Users currently install a compatibility host adapter named **Taku Publisher for Codex** or **Taku Publisher for Claude Code**. They do not install or interact with `creator-core` directly. Taku Desktop can consume the same core/runtime as an embedded build dependency. Existing Publisher names remain compatible until a separately reviewed distribution migration.

```text
Codex plugin ---------\
Claude Code plugin ----> Taku Passport runtime ---> Taku Worker / Taku Web
Taku Desktop ---------/            |
                                   +-- Publisher module
```

## Source ownership

| Area | Canonical source | Responsibility |
| --- | --- | --- |
| Capability contract | `packages/capability-contract/` | Own `taku.capability-snapshot.v1`, `taku.package.v1`, capability kinds, stable IDs, eligibility, JSON Schemas, canonical JSON and hashes |
| SubApp conversion contract | `packages/subapp-contract/` | Own the versioned assessment boundary, existing converter migration/validation shapes, runtime manifest boundary, dual-archive release projection, privacy checks, JSON Schemas, canonical JSON and hashes |
| Repo-to-Stax Converter | `packages/repo-to-stax-converter/` | Own framework analysis, capability routing, source snapshots, pinned template, candidate generation and validation; Publisher plugins ship its assessment/preparation runtime |
| Passport Core | `packages/passport-core/` | Own deterministic Snapshot, inventory, privacy, Persona identity and Usage summary composition without host I/O |
| Creator compatibility runtime | `creator/scripts/` | Discover local host data, perform compatibility I/O, build persona/profile drafts, render the local editor and expose the Creator Center client |
| Legacy core alias | `packages/creator-core/` | Re-export `@taku/passport-core` for compatibility; it must not import Creator runtime implementation |
| Publishing runtime | `packages/publisher-runtime/` | Canonical TypeScript/ESM discovery, SubApp assessment adaptation, trusted runtime receipts, deterministic dual-archive SubApp packaging, owner-only packaged-Taku local install handoff, confirmed private App registration, capability staging/scan/package, authorization, Marketplace and Worker orchestration |
| Legacy publishing pipeline | `scripts/taku_publisher/` | Source-only Python compatibility implementation during the migration window; never shipped in generated plugins |
| CLI facade | `packages/publisher-cli/` | Give workspace consumers stable Node.js executable entrypoints |
| Codex delivery | `adapters/codex/taku-publisher/` | Codex plugin metadata |
| Claude delivery | `adapters/claude/taku-publisher/` | Claude Code plugin metadata |

## Compatibility policy

The root `SKILL.md`, `scripts/taku_publisher.py`, `scripts/taku_publisher/`, and
`creator/scripts/` remain supported during the migration. New Publisher
consumers use `packages/publisher-runtime`; Core consumers use
`packages/passport-core` or a generated Host Adapter.
`packages/creator-core` is a deprecated compatibility alias.

Passport Core accepts discovered values and returns deterministic normalized
values. It must not read host directories, execute host commands, depend on
Electron, call Worker APIs or infer trusted server state. The existing Creator
runtime temporarily owns those effects until P4 moves them into explicit Host
Adapters.

`taku.ai-setup.v1` is accepted only as legacy read input. New snapshots are
always generated as `taku.capability-snapshot.v1`. A workflow remains a
`workflow` during discovery and import; it becomes an `action` only when the
contract creates a publish-channel `taku.package.v1` projection.

Private snapshots may contain local locators and scan-only metadata. Public
package manifests reject local paths, environment payloads, credentials,
tokens, raw prompts, and raw source content. Rules are not publishable, MCP is
local-only, and plugins require an approved permission review before
publication.

SubApp conversion is a separate orchestration path from capability packaging.
Its private assessment may contain a local project locator, while its public
release must not. The existing Desktop App protocol uses `source.zip` and
`build.zip` plus a runtime manifest and registered URLs; no `.takuapp` format is
assumed until a Desktop consumer implements and versions one. The contract does
not itself clone repositories, run Agents or untrusted code, authorize publish,
upload artifacts, register Apps, or install them.

The Publisher adapter invokes the bundled, reviewed `repo-to-stax` Analyzer,
candidate preparer, Agent handoff, and static conversion validator as separate
processes and projects their evidence through
`@taku/subapp-contract`. It does not duplicate framework-detection or workspace
validation rules. Candidate preparation requires a source-digest-bound
confirmation, reruns assessment, uses the pinned bundled template, and stops
before Agent execution. An explicit creator request lets the current host Agent
edit only the candidate under a returned protected-path contract; Publisher
does not launch an opaque child process. Static conversion success does not
claim runtime execution. The plugin carries the runtime and validator it needs
and pins exact protocols/versions. Explicit entries and `PATH` resolution remain
development fallbacks, not creator installation requirements.

## Distribution

`scripts/build-adapters.mjs` creates self-contained, Node-only plugin artifacts
under `dist/plugins/<host>/taku-publisher`. It also packages installable Codex
and Claude Code Marketplaces at `dist/marketplaces/<host>/taku`, with canonical
Marketplace metadata sourced from `adapters/<host>/marketplace.json`. Generated
artifacts use an explicit runtime allowlist and omit Python, tests, TypeScript
sources, declarations, source maps, and repository build utilities. They are
not a second source of truth and must never be edited directly.

The plugin can authenticate through Taku Web, manage owner-scoped Creator Center data, and publish through Taku Worker. Taku Desktop is not a dependency of either host adapter.

`scripts/package-contract.mjs` produces an immutable versioned
`@taku/capability-contract` archive, checksum, and source provenance record.
The `release-capability-contract.yml` workflow publishes those files from a
clean, version-matching Git tag. Build consumers must pin the exact archive and
checksum; application runtime must not depend on access to a private package
registry.

## Repository identity

- Recommended repository name: `taku-passport`.
- Compatibility names retained in P1: `taku-publisher`, `taku-creator`, current package names, CLI commands, and Adapter IDs.
- Renaming public package or plugin identifiers is a separate migration because installed hosts and documentation may depend on them.
- Git source is canonical. `dist/`, copied Desktop runtimes, archives, and installed plugins are derived artifacts.
