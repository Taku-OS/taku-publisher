# @taku/publisher-runtime

The canonical Node.js runtime for Taku Publisher. It owns local discovery,
staging, scanning, packaging, Marketplace installation, browser authorization,
and Worker API orchestration without requiring Python.

The runtime preserves the `taku.publisher.v1` JSON command contract. The legacy
Python entrypoint remains a compatibility shim during migration and is not
included in generated user plugins.

## Unified creator initialization

`creator-init` authorizes the Publisher account before the Stax Card scan, saves
an editable private draft to the production Worker Cloud Studio, and returns
the durable Studio URL, Creator Profile links, and recent Codex/Claude Code
projects in one response. Multi-project
selection is persisted with `creator-plan --select
<project-id=skill|subapp,...>`. The plan reviews the Stax Card first, then routes
projects through the existing single-project flows sequentially, so SubApp
conversion never delays the card.

Cloud Studio requires only `creator.profile.read` and
`creator.studio-draft.write`; it does not grant public card publishing. The
legacy loopback editor is available only through explicit `--local-editor`.

## Codex and Claude Code project import

`project-discover` reads bounded local session metadata to recover recent
workspace paths, deduplicates them, and returns lightweight root signals without
analyzing prompt bodies or recursively scanning source code. The creator must
select one project before `project-assess` routes it to `existing-skill`,
`subapp-migration`, `skill-generation`, or `reference-only`.

An eligible `skill-generation` route uses `skill-prepare`, `skill-convert`, and
`skill-conversion-check`. Preparation writes only an isolated candidate;
conversion is performed by the current Codex or Claude Agent under the returned
editable/read-only contract; and static validation executes no source or
candidate scripts. The generated candidate must still pass the normal Skill
staging, deterministic scan, semantic review, and package workflow.

Host applications that only need deterministic packaging should import
`@taku/publisher-runtime/core`. That subpath excludes CLI, browser authorization,
and host orchestration APIs while providing canonical archive path checks,
stable ZIP ordering, file modes, per-file digests, and artifact SHA-256.

Browser, preload, and shared clients that only need Publisher Draft route
builders should import `@taku/publisher-runtime/contract`. This subpath has no
Node.js imports and keeps host-provided URL segments encoded consistently.

## SubApp assessment and candidate preparation

`subapp-assess` is the read-only Publisher boundary for an existing application
repository. It accepts one absolute local directory or one public HTTPS GitHub
repository URL, invokes `repo-to-stax analyze` without a shell, validates the
result with `@taku/subapp-contract`, and returns `eligible`,
`review-required`, or `rejected` in the Publisher JSON envelope.

For non-service warnings, a `review-required` response includes a local
`taku.subapp-assessment-review.v1` template. Fill only each disposition's
`decision`, `rationale`, and `remediation`, then rerun assessment with
`--assessment-review /absolute/path/to/review.json`. The review fingerprint
binds the exact source/ref, resolved commit, Converter source digest, catalog
state, and findings. It cannot override blockers, rejected routes, or unresolved
service mappings. A successful review returns a review-bound confirmation token;
pass the same review file to `subapp-prepare`. Risks accepted with remediation
remain unresolved in the migration record and block conversion validation until
the Agent records concrete resolution evidence.

```sh
taku-publisher subapp-assess \
  --source /absolute/path/to/app
```

When Converter output contains third-party service requirements, Publisher
fetches the authoritative `taku.service-catalog.v1` projection from Taku Proxy,
checks every already-mapped `serviceId` and `endpointId`, and binds the catalog
digest into the assessment confirmation. An absent/disabled mapping rejects
conversion; an unavailable catalog downgrades a mapped requirement to manual
review. Projects without service requirements do not make this network request.
Production Proxy is the default. Local development may pass
`--service-catalog-url http://127.0.0.1:7819` or set
`TAKU_SERVICE_CATALOG_URL`; arbitrary remote origins are rejected.

For an unresolved requirement, Publisher also queries `taku.service-search.v1`
on the same trusted Proxy origin. Search receives only the bounded semantic
capability/operation query, never source files or credentials. Every result is
cross-checked against the active Catalog and returned as a suggestion; Publisher
never selects it automatically. After reviewing schema, pricing, data handling,
write effects, and authority, the creator or current Agent records an explicit
mapping document:

```json
{
  "schema_version": "taku.subapp-service-mappings.v1",
  "mappings": [
    {
      "requirement_id": "current-weather",
      "service_id": "weatherapi",
      "endpoint_ids": ["current"]
    }
  ]
}
```

Rerun assessment with `--service-mappings /absolute/path/to/mappings.json`.
Publisher validates the exact IDs against the current Catalog; if eligible, pass
the same mapping file to `subapp-prepare` so reassessment reproduces the same
reviewed decision. Mapping documents cannot contain upstream URLs or secrets.

Generated plugins bundle the compatible `repo-to-stax` runtime and
require protocol `repo-to-stax.analyze.v1` at Converter version `0.2.0`.
`--converter-bin` and `TAKU_REPO_TO_STAX_BIN` are developer-only diagnostic
overrides. Assessment returns a source-bound confirmation token for eligible
projects. The creator can then prepare one isolated candidate with:

```sh
taku-publisher subapp-prepare \
  --source /absolute/path/to/app \
  --output-root /absolute/path/to/existing-candidates \
  --confirm-assessment <token> \
  --assessment-review /absolute/path/to/same-review.json
```

Omit `--assessment-review` when the assessment was eligible without manual
review.

Preparation reassesses the source, rejects stale confirmations/source changes,
catalog digest changes, uses the bundled pinned Taku template, preserves provenance, and requires
workspace validation. It never runs an Agent or repository scripts, builds the
App, uploads data, registers it, or publishes it.

After the creator explicitly asks to continue, `subapp-convert --candidate
<absolute-path>` validates the candidate and returns the bounded migration
contract for the current Codex or Claude Agent. `subapp-conversion-check`
performs the post-edit static conversion gate. Neither command launches a child
Agent or executes install, test, build, preview, upload, registration, or
publishing commands; a static pass advances only to later trusted runtime
validation.

## Confirmed trusted runtime validation

After the static conversion gate passes, `subapp-runtime-plan` returns a
confirmation token bound to the candidate tree digest, exact `.nvmrc`, exact
`packageManager`, and the fixed validation command set. It is read-only:

```sh
taku-publisher subapp-runtime-plan --candidate /absolute/path/to/candidate
```

After explicit confirmation, `subapp-runtime-check` provisions only
checksum-pinned Publisher-managed Node/pnpm versions, prefetches frozen
dependencies without lifecycle scripts, and runs offline install, tests, slots,
type checking, Biome CI, and production build in a disposable qualified macOS
Seatbelt workspace:

```sh
taku-publisher subapp-runtime-check \
  --candidate /absolute/path/to/candidate \
  --confirm-runtime <token>
```

The execution workspace is removed, the original candidate must remain
unchanged, outbound and loopback network remain denied during candidate script
execution, and evidence stays local under the Publisher runtime state. A
successful run preserves the exact `.next-preview` output plus a digest-bound
local receipt. It remains non-authoritative for upload and publication.

## Confirmed local SubApp package

`subapp-package-plan` checks that the candidate digest, runtime receipt,
preserved preview build, runtime manifest, and `start:preview` / `start:edit`
contract still match:

```sh
taku-publisher subapp-package-plan \
  --candidate /absolute/path/to/candidate \
  --runtime-evidence /absolute/path/to/trusted/evidence
```

After explicit confirmation, `subapp-package` creates deterministic
Desktop-compatible `source.zip` and `build.zip` archives. The source archive
excludes environment files, `.taku`, dependencies, and build/cache output. The
build archive is rooted at `.next-preview` and must match the trusted build
digest:

```sh
taku-publisher subapp-package \
  --candidate /absolute/path/to/candidate \
  --runtime-evidence /absolute/path/to/trusted/evidence \
  --output-root /absolute/path/to/existing/output \
  --confirm-package <token>
```

This is a local delivery artifact only. It does not upload, register, install,
or publish the SubApp.

## Confirmed local Taku Desktop installation

`subapp-install-plan` re-hashes the package and binds confirmation to the exact
local release:

```sh
taku-publisher subapp-install-plan \
  --package-root /absolute/path/to/calculator-release
```

After confirmation, `subapp-install` writes an owner-only, short-lived handoff
and opens the installed Taku Desktop client through
`taku://subapp/install?handoff=<opaque-id>`:

```sh
taku-publisher subapp-install \
  --package-root /absolute/path/to/calculator-release \
  --confirm-install <token>
```

The package path is never placed in the deep link. Taku shows a local install
confirmation, independently checks the package manifest, archive hashes, ZIP
paths, file limits, runtime scripts, and `.next-preview` contract, installs the
Application into its managed projects directory, then opens preview. This path
does not authenticate, upload, register, or publish the SubApp.

## Confirmed private SubApp registration

`subapp-register-plan` re-hashes both archives, validates the Desktop install
contract, listing fields, public HTTPS assets, and source-rights declaration,
then binds an exact confirmation token to the package and metadata:

```sh
taku-publisher subapp-register-plan \
  --package-root /absolute/path/to/calculator-release \
  --metadata /absolute/path/to/registration-metadata.json \
  --mode create
```

Registration metadata has this shape:

```json
{
  "catalog": {
    "name": "Calculator",
    "author": "Creator name",
    "shortDescription": "A safe four-function calculator.",
    "description": "Detailed Marketplace description.",
    "categories": ["productivity"],
    "tags": ["calculator"],
    "iconUrl": "https://public.example/icon.png",
    "repoUrl": "https://github.com/owner/repository"
  },
  "releaseNotes": "Initial converted release.",
  "sourceRights": {
    "authorshipKind": "derived",
    "rightsBasis": "open_source_license",
    "sourceUrl": "https://github.com/owner/repository",
    "sourceAuthor": "Upstream author",
    "license": "MIT",
    "sourceNotes": "Converted into the Taku SubApp runtime."
  }
}
```

After explicit confirmation, `subapp-register` creates or updates an
owner-scoped private App catalog draft, allocates one version, uploads the
verified `source.zip` and `build.zip` through separate signed URLs, and records
the version with the exact hashes, sizes, runtime manifest, source rights, and
Desktop start contract. Update mode requires the exact existing App ID:

```sh
taku-publisher subapp-register \
  --package-root /absolute/path/to/calculator-release \
  --metadata /absolute/path/to/registration-metadata.json \
  --mode create \
  --confirm-registration <token>
```

Archive bodies are streamed from disk instead of being buffered in memory.
HTTPS uploads honor `HTTPS_PROXY` / `HTTP_PROXY` and `NO_PROXY`; their default
timeout is 300 seconds and can be changed with `--upload-timeout <seconds>`.
If an upload is interrupted, rerun `subapp-register-plan` with the exact same
package, metadata, mode, and App ID, then confirm again. Publisher resumes the
same allocated version and signed paths rather than creating a duplicate.
State that already reached version creation remains fail-closed because the
remote result may be ambiguous.

This command deliberately leaves the catalog item in `draft`. Public download
URLs remain unavailable and no public release is claimed. A later, separately
confirmed release/review phase must move the exact registered version public
before packaged-client installation can be tested through the catalog.

When the Worker supports Web release review, the command returns `review_url`.
Open that URL, sign in with the owning Taku account, verify the exact source and
build SHA-256 values plus the source-rights declaration, then explicitly publish
the version. The Publisher never performs that final public transition itself.
