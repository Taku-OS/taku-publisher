# SubApp conversion product and artifact contract (phase 1)

## Decision

Publisher will orchestrate a conversion workflow; it will not absorb the converter's implementation into the existing Skill publishing pipeline. The shared boundary is `@taku/subapp-contract`, while analysis/conversion, trusted execution, upload/registration, and Desktop installation remain separate components.

The first implementation phase freezes the data exchanged between those components. It deliberately performs no repository cloning, Agent invocation, build, upload, registration, or Desktop installation.

## End-to-end states

| State | Owner | Required evidence | May advance to |
| --- | --- | --- | --- |
| `assessed / eligible` | Publisher + Converter adapter | `taku.subapp-assessment.v1`; route is `subapp-migration`; recommendation is `convertible` | workspace creation |
| `assessed / review-required` | Publisher + reviewer | Assessment findings have been reviewed explicitly | workspace creation or rejection |
| `assessed / rejected` | Publisher | Non-SubApp route, unsupported runtime, or hard blocker | native import, reference-only, or stop |
| `workspace` | Converter | Canonical template, frozen source/template provenance, workspace validation | Agent migration |
| `converted` | Agent + Converter validator | Product implementation, resolved risks, conversion-level validation | trusted publish admission |
| `publish-admitted` | Taku-controlled verifier | Known rights, static checks, secret scan, qualified execution, non-injectable authority | packaging/upload |
| `registered` | Publisher + Taku backend | App ID, version, source/build hashes and URLs, public manifests | Taku installation |
| `installed` | Packaged Taku Desktop | Source/build download and local installation succeeded | user launch |

No state implies the next. In particular, setting migration `status` to `converted` is a readiness claim, not proof that validation or publication passed.

## Assessment boundary

The assessment accepts either an absolute local project path or a GitHub repository locator. It is private, local-only data and may include a local path. It records:

- source identity and, when available, immutable revision information;
- detected project type, score, recommendation, reasons, risks, and conversion strategy;
- product route (`subapp-migration`, `native-import`, or `reference-only`);
- structured third-party service requirements and mappings to Taku proxy catalog IDs;
- normalized eligibility (`eligible`, `review-required`, or `rejected`);
- a machine-enforced next step and structured findings.

The score is diagnostic only. Conversion can start only from an eligible assessment or after an explicit review of a review-required assessment. `not-recommended` must not be overridden merely because the repository matches a known framework. A required service with no Taku mapping rejects conversion; a mapping that still needs semantic, data, write-effect, pricing, or authority review forces manual review.

Non-service warning review uses `taku.subapp-assessment-review.v1`. Its stable
assessment fingerprint binds the normalized source/ref and commit, Converter
source digest and version, service-catalog state, and exact findings. Every
warning needs an exact disposition: `not_applicable` with rationale, or
`accepted_with_remediation` with rationale and a concrete migration requirement.
The review cannot override blockers, rejected routes, `not-recommended`, or an
unresolved required service. Candidate preparation reassesses the source and
requires both the review-bound confirmation token and the same review document.
Accepted remediation remains unresolved until `.taku/migration.json` records
specific resolution evidence; conversion validation fails while any analyzed
risk remains unresolved.

## Supported routing in v1

| Detected type | Route | Meaning |
| --- | --- | --- |
| Next.js | SubApp migration | Port into the canonical template; never run the repository directly |
| Vite + React | SubApp migration | Port UI and product logic into the canonical Next.js runtime |
| FastAPI + Next | SubApp migration | Port supported server logic into Next server-only routes; no unsupported sidecar |
| Streamlit / Gradio | SubApp migration | Rewrite the UI/runtime into the canonical Next.js SubApp |
| Workflow / Skill | Native import | Use Taku's capability import, not SubApp conversion |
| Browser extension / external connector | Reference only | Existing runtime/auth lifecycle is not a Taku SubApp runtime |
| Python CLI / unknown | Reference only | Reject conversion until a native runtime contract exists |

## Candidate workspace contract

The candidate uses the converter's existing `taku.subapp-migration.v2` and `taku.subapp-validation.v1` contracts. The runtime manifest remains the existing `taku.manifest.json`; it must not contain migration provenance or conversion status.

The three validation gates keep their existing meaning:

- `workspace`: template structure, source/template provenance, policy payload, credit, skills, and file boundary.
- `conversion`: workspace plus real product implementation, Action/manifest consistency, migrated product tests, and no placeholder.
- `publish`: conversion plus rights, resolved risks, secret scanning, qualified install/test/type/lint/build evidence, and Taku-controlled authority.

Standalone converter execution cannot establish publish authority. A file path, CLI argument, environment variable, candidate-supplied key, or Agent assertion is never trusted authority.

## Runtime and third-party services

`taku.manifest.json` is the sole Host Action catalog. Converted apps use the canonical Host RPC boundary. Taku-managed AI and third-party services are called only through the template's server-only proxy helpers and Host-injected service base URL/token/application ID.

The assessment records semantic capability, operations, data classes, whether the operation mutates external state, and a mapping status. A successful mapping carries only `serviceId` and `endpointIds` from the `taku-ai-proxy-go` catalog. It never carries upstream URLs, service credentials, Host tokens, or environment values.

Publisher now queries the versioned public Proxy catalog when Converter output contains service requirements. It validates exact declared `serviceId` and `endpointIds`, records the current catalog digest outside the public App artifact, and binds that digest into candidate confirmation. It does not vendor the full catalog. For unresolved requirements it may query `taku.service-search.v1` with bounded semantic capability/operation text, but every result is filtered through the current Catalog and remains a suggestion. Selection requires a separate `taku.subapp-service-mappings.v1` review document; no search score or Agent assertion selects an endpoint automatically. Semantic matching, data handling, write effects, pricing, and application-level authority remain review gates until that explicit review. A stale, review-required, unavailable, or unauthorized required mapping cannot be treated as converted merely because an Agent wrote calling code.

## Release artifact

Inspection of the current Taku Desktop shows that App Store publishing and installation do not consume a `.takuapp` file. The current release is:

- `source.zip`: filtered project source, excluding build/cache directories, `.taku`, and environment files;
- `build.zip`: the `.next-preview` build rooted at `.next-preview`;
- `taku.manifest.json`: runtime metadata and Actions;
- publish metadata: hashes, sizes, scripts, release notes, and source rights;
- registration result: `appId`, `versionNumber`, `sourceUrl`, and `buildUrl`.

Therefore `taku.subapp-release.v1` models this two-archive release instead of introducing an unsupported extension. A single-file export can be added later as a separately versioned transport wrapper only after Desktop implements it; it must not replace or overload the current release semantics silently.

End users do not need a creator checkout or a manual download. Taku Desktop receives the registered release, downloads the two archives, installs them locally, and launches the SubApp through its existing application runtime.

## Privacy and publication boundary

Assessment locators and converter workspace paths are private. `.taku/migration.json` is conversion evidence and the current Desktop source packager excludes `.taku` from `source.zip`. The public release must reject:

- absolute user paths and `file://` URLs;
- environment payloads, cookies, sessions, credentials, and tokens;
- raw source content embedded in metadata;
- source/build hash or size mismatches;
- invalid source rights or non-HTTPS derived-source URLs.

## Acceptance gate for phase 1

Phase 1 is complete when the package builds and tests prove that:

1. Converter-shaped assessment, migration, and validation fixtures are accepted.
2. Eligibility and next-step invariants fail closed.
3. Runtime manifest Actions follow the current Desktop/template shape.
4. A registered dual-archive release is deterministic and public-safe.
5. Contract/package versions and all shipped JSON Schemas remain aligned.

## Phase 2 implementation status

Publisher now exposes the read-only `subapp-assess` adapter. It:

- accepts one absolute local directory or one public HTTPS GitHub repository URL;
- rejects relative paths, files, credentialed/non-GitHub URLs, unsafe Git refs, unbounded output, and timed-out Converter processes;
- runs `repo-to-stax analyze` without a shell in a private temporary work root;
- deletes its temporary remote checkout after assessment;
- projects Converter output through `taku.subapp-assessment.v1`;
- converts detected credential/API-key risk into a required Taku service-mapping review;
- validates exact Converter-declared service mappings against `taku.service-catalog.v1` and fails closed when the current catalog cannot confirm them;
- returns only the normalized assessment and never creates a candidate workspace or starts an Agent.

## Phase 3 implementation status

The generated Publisher plugin now includes the dependency-free Converter
assessment runtime. Publisher uses that exact bundled package by default and
requires protocol `repo-to-stax.analyze.v1` with Converter version `0.2.0`.
Missing or mismatched protocol/version metadata fails closed. Explicit
`--converter-bin` and `TAKU_REPO_TO_STAX_BIN` entries remain developer-only
diagnostic overrides; an installed package or `repo-to-stax` on `PATH` is a
last-resort compatibility fallback for workspace development.

The Converter source is kept as the independent
`packages/repo-to-stax-converter` workspace package, with its imported upstream
commit recorded in `UPSTREAM.json`. Publisher does not copy Analyzer rules into
its own runtime. Plugin packaging carries only the six-file assessment closure,
not the full conversion/validation runtime or its TypeScript dependency.

Candidate generation, Agent conversion, trusted execution, upload, registration, and Taku Desktop changes remain outside phase 3.

## Phase 4 implementation status

Publisher now exposes `subapp-prepare` as the candidate-only boundary. An
eligible or explicitly reviewed `subapp-assess` result includes a confirmation token bound to the
normalized assessment, Converter protocol/version, source identity, current
service catalog digest when required, and source
tree digest. Preparation:

- requires that exact token and reruns assessment against the same source/ref;
- rejects unreviewed `review-required`, `rejected`, stale, changed, or mismatched sources;
- revalidates the same bound `taku.subapp-assessment-review.v1` file when
  non-service warnings required manual review;
- writes only beneath one explicit existing absolute output directory;
- uses the bundled template tag `taku-3.0.2-template`, commit
  `7d4e525fcd35e0ce57745ea04b6e15642e4d57fb`, version `0.3.2`;
- copies source as inert upstream evidence and does not execute its install,
  build, test, or runtime commands;
- validates the workspace and its `taku.subapp-migration.v2` provenance before
  returning success;
- reports `candidate_only`, with Agent and publish execution explicitly false.

Generated Publisher plugins now carry the preparation runtime, pinned template,
and the TypeScript validator needed for self-contained Node.js execution.
Agent conversion, service-catalog resolution, trusted execution, Taku launch
validation, packaging, upload, registration, and Desktop installation remain
outside phase 4.

## Phase 5 implementation status

Publisher now exposes an explicit host-Agent loop:

1. `subapp-convert --candidate <path>` reruns workspace/provenance validation
   and returns `repo-to-stax.agent-handoff.v1`.
2. The handoff lists mandatory reads, immutable paths, the one editable
   workspace scope, forbidden actions, evidence report, and `conversion` gate.
3. The current Codex or Claude Agent performs the migration in place only after
   the creator explicitly asks to start or continue. Publisher does not spawn a
   hidden Agent process.
4. `subapp-conversion-check` returns
   `repo-to-stax.conversion-check.v1` and structured static findings. The Agent
   iterates until the gate passes or reports a genuine blocker.

Both CLI operations are read-only and report `scriptsExecuted: false`.
`upstream-source/` remains inert reference; the handoff forbids executing its
scripts, changing template authority files, adding client-side credentials or
generic proxies, and crossing into upload/registration/publication. The static
gate verifies candidate structure, immutable provenance, placeholder removal,
product-test discovery, Action consistency, and migration readiness. It does
not execute or attest install, tests, type checking, build, preview, or Taku
launch. Those remain the next trusted-runtime phase.

## Phase 6 implementation status

Publisher now exposes a two-step trusted runtime boundary:

1. `subapp-runtime-plan` reruns the static conversion gate and binds a
   confirmation token to the candidate digest, exact Node/pnpm requirements,
   and fixed command set.
2. `subapp-runtime-check` rejects missing or stale confirmation before any
   toolchain setup or candidate execution.
3. Publisher downloads only compiled allowlisted Node/pnpm artifacts, verifies
   their checksums, prefetches the frozen dependency graph with lifecycle
   scripts disabled, and installs it offline.
4. Converter copies the complete confirmed candidate into a disposable
   workspace, qualifies a no-network/no-loopback macOS Seatbelt profile, and
   runs install, tests, slots, type checking, CI checks, and production build.
5. The run rejects unexpected source-tree mutation, removes its execution copy,
   proves the original candidate unchanged, and keeps local evidence.

The publish validator remains admission-only and fail-closed. Runtime evidence
does not add production attestation authority, package or upload the candidate,
register it with Taku, or prove Taku Desktop launch. Those are later phases.

## Phase 7 implementation status

Publisher now preserves and packages the client-compatible preview build:

1. Trusted runtime executes the build with `TAKU_RUNTIME_KIND=preview`, requires
   the complete `.next-preview` marker set, and copies that output into local
   evidence before deleting the disposable workspace.
2. The build evidence records a deterministic tree digest, file count, and byte
   count. Publisher writes a local runtime receipt only after the complete
   trusted-runtime envelope and unchanged candidate are verified.
3. `subapp-package-plan` binds a second confirmation to the exact candidate,
   runtime receipt, preview-build digest, runtime manifest, and Desktop start
   scripts. Changed or arbitrary evidence fails closed.
4. `subapp-package` creates deterministic `source.zip` and `build.zip` archives
   matching the current Desktop install contract. Source excludes `.taku`,
   environment files, dependencies, and build/cache output; build entries are
   rooted at `.next-preview`.
5. Packaging rejects symlinks, unsupported entries, incomplete builds,
   hard-coded ports, size/file-count overflow, stale confirmation, and existing
   output targets. Final archive bytes are re-hashed after writing.

This phase is local-only. It does not create public URLs, an App ID or version,
does not upload/register/publish, and does not claim that a packaged Taku client
completed installation. Confirmed local packaged-client acceptance is the next
phase; remote registration remains an independent optional distribution phase.

## Phase 7.5 local Desktop installation status

Publisher and packaged Taku Desktop now expose a local-only handoff:

1. `subapp-install-plan` re-hashes the exact dual-archive release and binds a
   confirmation token to its canonical path, manifest, and archive hashes.
2. `subapp-install` validates that token before writing one owner-only handoff
   with a ten-minute expiry. Only a random opaque ID is passed through
   `taku://subapp/install`; the package path and bytes never enter the URL.
3. Packaged Taku claims the handoff once, shows a native install confirmation,
   and independently verifies the manifest, hashes, sizes, ZIP paths, file
   limits, excluded content, runtime scripts, and `.next-preview` marker set.
4. Taku extracts into its managed projects directory, creates a local
   Application with `buildStage=ready`, starts preview through the existing Core
   runtime, and returns the Application ID through an owner-only result file.
5. Publisher claims success only after the client reports
   `installed_and_opened`. Cancellation, expiry, stale bytes, an older client,
   or failed validation cannot be described as installation.

This phase requires the installed release build of Taku Desktop, not a source
checkout or development CLI. It performs no login, upload, App registration, or
publication.

## Phase 8 implementation status

Publisher now exposes a separate, confirmed private-registration boundary:

1. `subapp-register-plan` re-hashes `source.zip` and `build.zip`, validates the
   package/install manifest, listing fields, public HTTPS URLs, and source-rights
   declaration, and binds a confirmation token to that exact input.
2. Create and update are explicit modes. Update requires the exact existing App
   ID; create rejects an inferred or supplied App ID.
3. `subapp-register` validates confirmation before authentication or remote
   mutation, creates/updates an owner-scoped catalog row with status `draft`,
   allocates one version, and requests separate signed uploads for both archives.
4. The version record carries the archive hashes/sizes, runtime manifest,
   `.next-preview` install contract, release notes, and source-rights declaration.
5. Local registration state resumes an interrupted archive upload against the
   same App ID, version number, and storage paths. Completed state, changed
   package/metadata, uncertain version-creation state, mismatched signed paths,
   response identities, or version numbers fail closed instead of creating a
   duplicate version.
6. Archive bodies stream from disk, use the configured HTTP(S) proxy unless
   `NO_PROXY` applies, and have a separate 300-second default upload timeout.

This phase uploads and registers only a private draft. It does not set catalog
status to `published`, expose public download URLs, claim public release, or
claim packaged-client installation. Public release review/confirmation and the
final App Store install/launch test remain later phases.
