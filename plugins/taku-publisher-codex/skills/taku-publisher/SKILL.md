---
name: taku-publisher
description: Discover recent Codex and Claude Code projects, route a selected local project to Taku SubApp conversion, existing Skill publishing, or bounded Skill generation; generate a Taku Stax Card or AI Builder Profile; assess and convert an existing local App or GitHub repository into a Taku SubApp; safely package and publish one installable Taku Skill; manage Creator Center items; and search or install compatible Marketplace items. Public SubApp release remains a separate unsupported confirmation phase.
---

# Taku Publisher

Run every command from this skill directory with `node scripts/taku-publisher.mjs`. Treat CLI JSON as the workflow authority. Parse `ok`, `status`, `requires_action`, and `action_type` before responding.

When the user asks generally to open the Taku Publisher creator workspace without already choosing one exact source, start with `creator-init`. It confirms the Taku Publisher account before scanning, saves an editable private Stax Card draft to Taku Cloud Studio, and returns the durable Studio URL, Creator Profile links, and recent local projects in one response. Present projects as a numbered multi-select list with the recommended `skill` or `subapp` target, then ask which projects to process and whether to accept or change each recommendation.

After the creator selects projects, create one persistent plan with `creator-plan --select <project-id=skill|subapp,...>`. Lead with Stax Card review/publishing, then process selected projects sequentially through the existing single-project import flows. Never make the Stax Card wait for SubApp migration, runtime validation, packaging, or registration. After a project receives an authoritative Taku item identity, offer to sync it into the Stax Card; never expose a selected local project publicly before that point.

In Claude Code or Codex shell calls, always change into the directory that contains this `SKILL.md` in the same command before invoking the CLI, for example `cd <this-skill-directory> && node scripts/taku-publisher.mjs ...`. Never run `node scripts/taku-publisher.mjs ...` from the user's project or workspace directory.

This skill has six product surfaces:

- Project import flow: discover recent Codex and Claude Code workspaces from local session metadata, let the creator select one exact project, assess it locally, and route it to existing Skill publishing, SubApp migration, bounded Skill generation, or reference-only handling.
- Creator profile flow: confirm the Taku account, scan local AI tooling and behavior, generate the public-safe persona summary, save a private cloud Stax Card / Creator Page draft, and open its durable Worker Studio URL. The local loopback editor is an explicit development fallback only.
- Creator Center flow: list and search the signed-in creator's Taku items, read trusted server-side stats, inspect one owned item, and edit the listing metadata of a private draft.
- Marketplace consumer flow: search and inspect public community Apps, Skills, Tools, and Bundles; show an install preflight and safely install one compatible confirmed Skill into Codex.
- Marketplace publisher flow: package and publish one installable Skill with staged files, deterministic scan, semantic review, and remote artifact verification. Action, Agent, and Plugin publishing are not currently available.
- SubApp conversion flow: assess one existing App directory or public GitHub repository, prepare an isolated candidate after exact confirmation, migrate it with the current Codex or Claude Agent under a bounded contract, run confirmed trusted validation, create the deterministic Desktop dual-archive release, install/open it locally through the packaged Taku Desktop client after separate confirmation, and optionally upload/register one private App draft version. Public release and packaged-client catalog installation are not yet supported.

## User-Facing Response Rules

The creator should not see the internal pipeline unless they ask for technical details. Translate CLI fields and paths into plain language, and make the next action obvious.

Default user response shape:

1. One sentence status in product language.
2. One clear next step, usually "open this page", "log in to Taku", "choose the item", or "I need to fix these files first".
3. Optional short safety note when useful.

Do not lead with or emphasize local draft IDs, bundle paths, artifact IDs, SHA-256 hashes, JSON file paths, command names, or internal statuses like `packaged`, `missing_auth`, `remote-create`, `remote-scan`, `remote-upload`, `stage_sha256`, `bundle_sha256`, `requires_action`, or `action_type`. These are debugging details.

Allowed when useful:

- Give a review URL verbatim.
- Mention a draft/item name or the selected local folder.
- Say "I prepared the package locally" instead of `stage` / `package`.
- Say "Taku needs you to log in before I can upload it" instead of `missing_auth`.
- Say "Taku found a security blocker" instead of `deterministic_scan_blocked`.
- Say "The final confirmation page is ready" instead of `review_and_submit_on_taku_web`.

Only show debug fields when the creator explicitly asks "show details", "what command", "where is the bundle", "what draft ID", "why failed", or similar.

Field translation:

| Internal field / command | Say to the creator |
|---|---|
| `creator-init` / `creator_ready` | "Your creator workspace is ready; choose one or more local projects and confirm Skill/SubApp for each." |
| `creator-init` / `login_required` | "Taku account confirmation did not complete, so I did not start a new Stax Card scan. Finish sign-in and retry." |
| `creator-plan` / `creator_publish_plan_ready` | "Your publishing plan is ready. Review/publish the Stax Card first; selected projects will continue one at a time." |
| `creator-plan-next` | "Here is the next Stax Card, Skill, or SubApp step in your publishing plan." |
| `discover` / `needs_selection` | "I found publishable items; choose which one to publish." |
| `init` / `draft_id` | "I created a local publishing draft." |
| `stage` | "I prepared the files that will be reviewed." |
| `scan` | "I checked the package for publish blockers." |
| `apply-review` | "I completed the deeper safety review." |
| `package` / `bundle.zip` | "The local package is ready." |
| `remote-create` | "I created the Taku listing draft. The publish button will stay disabled until I upload the scan and package." |
| `remote-scan` | "I uploaded the scan results to Taku." |
| `remote-upload` | "I uploaded the package to Taku." |
| `remote-status` | "I checked the Taku draft status." |
| `creator-center-list` | "Here are the works in your Taku Creator Center." |
| `creator-center-show` | "Here is the current state of this work." |
| `creator-center-update` | "I updated this private draft." |
| `creator-center-unpublish` | "I removed this work from the Marketplace and kept it as a private draft." |
| `creator-center-stats` | "Here are your trusted Taku creator statistics." |
| `marketplace-search` | "Here are the matching Taku community items." |
| `marketplace-show` | "Here are this Skill's details and configuration requirements." |
| `marketplace-open` / `taku_opened` | "Taku Desktop is open. Confirm the selected App there." |
| `marketplace-install` / `confirmation_required` | "This Skill is ready to install after you confirm the exact item." |
| `marketplace-install` / `installed` | "The Skill is installed. Start a new Codex task to use it." |
| `project-discover` / `project_selection_required` | "I found recent local projects; choose one before I inspect its source." |
| `project-assess` / `project_route_ready` | "This project has a supported Taku conversion route. Review the proposed route before I prepare anything." |
| `skill-prepare` / `skill_candidate_prepared` | "I prepared an isolated Skill candidate. The source project was not changed or executed." |
| `skill-convert` / `skill_agent_handoff_ready` | "The candidate is ready for bounded Skill migration inside the returned editable scope." |
| `skill-conversion-check` / `skill_conversion_static_gate_passed` | "The generated Skill passed the static conversion gate; safety scanning and packaging are still required." |
| `subapp-assess` / `subapp_conversion_eligible` | "This project can enter SubApp conversion after you confirm." |
| `subapp-assess` / `subapp_conversion_review_required` | "This project needs the listed technical, rights, or service review before conversion." |
| `subapp-assess` / `subapp_conversion_review_accepted` | "The source-bound assessment review was accepted. Confirm before I prepare the isolated candidate." |
| `subapp-assess` / `subapp_conversion_rejected` | "This project cannot enter SubApp conversion; use the returned native-import/reference route if available." |
| `subapp-prepare` / `subapp_candidate_prepared` | "I prepared an isolated SubApp candidate locally. Review it before starting the conversion Agent." |
| `subapp-convert` / `subapp_agent_handoff_ready` | "The candidate is ready. I can now migrate its core workflow within the protected workspace boundary." |
| `subapp-conversion-check` / `subapp_conversion_needs_work` | "The candidate still has conversion gaps; I will continue using the returned findings." |
| `subapp-conversion-check` / `subapp_conversion_static_gate_passed` | "The migrated candidate passed the static conversion gate; runtime testing is still required." |
| `subapp-runtime-plan` / `subapp_runtime_confirmation_required` | "The runtime plan is ready. Confirm before I install dependencies or run candidate scripts in isolation." |
| `subapp-runtime-check` / `subapp_trusted_runtime_failed` | "Trusted runtime validation stopped at the reported phase; I need to fix that issue and reconfirm if the candidate changes." |
| `subapp-runtime-check` / `subapp_trusted_runtime_passed` | "The candidate passed isolated install, tests, checks, and a client-compatible preview build; local package preflight is next." |
| `subapp-package-plan` / `subapp_package_confirmation_required` | "The trusted build and Taku install contract match. Confirm before I create the local source/build archives." |
| `subapp-package` / `subapp_local_package_ready` | "The local source and preview-build archives are ready. Nothing was uploaded or published." |
| `subapp-install-plan` / `subapp_client_install_confirmation_required` | "The local package matches Taku Desktop's install contract. Confirm before I open Taku for local installation." |
| `subapp-install` / `subapp_client_confirmation_pending` | "Taku is open. Confirm the local installation in Taku Desktop." |
| `subapp-install` / `subapp_installed_and_opened` | "Taku verified and installed the local SubApp, then opened its preview. Nothing was registered or published." |
| `subapp-register-plan` / `subapp_registration_confirmation_required` | "The package, listing, and source-rights declaration are ready. Confirm before I create a private Taku App draft and upload both archives." |
| `subapp-register` / `subapp_private_draft_registered` | "The two archives are registered as a private App draft version. It is not publicly released or installable from the catalog yet." |
| `missing_auth` | "Taku needs you to log in before I can continue." |
| `review_url` | "Open this page to review/confirm." |

Examples:

- Good: "The package is ready locally. I opened Taku Web so you can sign in or create an account and approve publishing; the upload will continue afterward."
- Bad: "Draft `local_xxx` is `packaged`; run `remote-create`, `remote-scan`, `remote-upload` after fixing `missing_auth`."
- Good: "I found two publishable items: YouTube to Ebook and Taku Publisher. Which one should this listing publish?"
- Bad: "Command returned `needs_selection`, `action_type=select_one_publish_unit`."
- Good: "The final Taku confirmation page is ready: <url>. Please review the listing, files, permissions, and scan summary there."
- Bad: "Remote artifact ID `...` uploaded, status `awaiting_web_confirmation`."

## Safety Rules

- Publish exactly one Skill per workflow. If discovery finds only an Action, Agent, or Plugin source, explain that its publishing type is not available yet and do not initialize a draft. Treat any existing draft of those unopened types as read-only: status inspection is allowed, but staging, scanning, packaging, metadata changes, and uploads are blocked.
- Project discovery may inspect only Codex/Claude Code session metadata needed to recover absolute workspace paths and activity times, plus bounded root metadata such as `SKILL.md`, `README.md`, and dependency names for a lightweight route hint. It must not recursively scan source code or summarize, expose, upload, or semantically analyze prompt/message bodies before the creator selects one exact project.
- Never auto-select a discovered project. Project assessment accepts only one explicit existing absolute local directory; reject filesystem roots, the whole home directory, symlinks, files, and arbitrary URLs.
- Treat project assessment as read-only. Route `existing-skill` to the normal Skill publishing flow, `subapp-migration` to the existing SubApp flow, `skill-generation` to the bounded Skill candidate flow, and `reference-only` to a stop/reference response. Do not reinterpret an unsupported runtime as a Skill merely because it contains code.
- Skill candidate preparation requires the exact confirmation token from the current eligible project assessment. It may create only one new child under an explicit existing output root, must not modify or execute the source, and must not upload, publish, install, or register anything.
- Run `skill-convert` only after the creator explicitly asks to start or continue the exact candidate. Read every returned required file, edit only the returned editable scope, keep the source and `.taku` conversion record read-only, and do not copy credentials, environment files, caches, build output, or absolute local paths.
- A passing `skill-conversion-check` is static only. Continue through the existing immutable staging, deterministic scan, semantic review, package, and Taku Web confirmation flow before claiming that the Skill is publishable or published.
- Confirm `create` or `update` before staging. Require the platform `itemId` for `update`; never infer an update from a name or path match.
- Never ask for an API key, token, password, private key, database credential, or Taku auth token in chat.
- Never put a real Key in listing metadata, dispositions, `requirements.json`, the bundle, logs, or command arguments.
- Treat `.env` and credential stores as scan/exclusion inputs, never package inputs. Permit `.env.example`, `.env.sample`, and `.env.template` only when they contain placeholders.
- Use Taku Web for listing edits and final submission. The host may stage, scan, package, and upload, but must not claim submission or publication until remote status confirms it.
- Do not upload if deterministic scan blocks, deep scan is incomplete, a deep disposition blocks, or the staging/bundle digest changes.
- Do not run database commands. Worker tables, storage, review pages, and server-side rescanning are platform dependencies.
- Do not call remote publishing commands unless the creator asked to continue publishing. Creator Profile generation may only access Taku account endpoints to authorize the user and read their public display name/avatar.
- Creator Center mutations are owner-scoped server operations. Never treat a local name, path, or cached item as proof of ownership.
- Never delete from the Creator Center flow. Unpublishing is allowed only for one
  server-owned published item after the creator explicitly confirms the exact
  item shown by `creator-center-show`.
- Unpublishing is not deletion: it hides the item from Marketplace and preserves
  the item, versions, package, install records, and already-installed local
  copies. Never describe it as removing other users' installed copies.
- Marketplace search and show are public reads. Do not log in or request
  installation access until the user asks to install one exact item.
- Before installation, show the selected Skill name, creator, version, target
  directory, and configuration requirement names/purposes. Never request or
  display the actual configuration values in chat.
- Installation requires a second command with `--confirm-item-id` exactly
  matching the selected server item ID. Do not combine selection and
  installation confirmation in one command or infer confirmation from a name.
- Install only into the Codex user Skill directory returned by the CLI. Never
  overwrite an existing Skill directory, bypass package/hash checks, or manually
  extract a rejected package.
- SubApp assessment is read-only. Accept only one explicit absolute local App
  directory or one public HTTPS GitHub repository URL. Never turn a relative
  path, arbitrary URL, browser extension, daemon, CLI, or unknown runtime into a
  SubApp merely because it contains code.
- Do not bypass `review-required` or `rejected`, and do not describe assessment
  as conversion. Candidate preparation requires the exact confirmation token
  returned by an eligible assessment or an accepted bound review, and must
  reassess the same source/ref. A missing, stale, or mismatched confirmation
  stops the flow.
- A non-service `review-required` assessment may advance only with a complete
  `taku.subapp-assessment-review.v1` document returned from the current review
  template. Every warning must be matched exactly and marked either
  `not_applicable` with a rationale or `accepted_with_remediation` with both a
  rationale and concrete migration remediation. Pass the same file to assessment
  and preparation. Its fingerprint binds the source/ref, commit, source digest,
  Converter version, service-catalog state, and exact findings; never edit those
  binding fields or reuse the review after reassessment changes.
- Local assessment review cannot override blockers, rejected routes, a
  `not-recommended` result, or unresolved required service mappings. Accepted
  remediation remains an unresolved migration risk until the candidate records
  specific `analysis.riskResolutions` evidence; the conversion gate must block
  while any analyzed risk remains unresolved.
- Treat `/service/search` results only as candidates. Never select a service from
  score alone. Review its exact input schema, pricing, data classes, mutation
  effects, and authority, then record only `serviceId` and `endpointIds` in a
  versioned `taku.subapp-service-mappings.v1` file. Pass the same file to
  assessment and candidate preparation; never include upstream URLs, provider
  credentials, Host tokens, or environment values.
- Candidate preparation may only create one new child directory under an
  explicit existing absolute output root. It must use the bundled pinned Taku
  template, preserve source/template provenance, and pass workspace validation.
  It must not call an Agent, execute repository install/build/test scripts,
  upload source, register an App, or claim that an App was published.
- Do not run `subapp-convert` until the creator explicitly asks to start or
  continue conversion for the exact candidate. The command validates and
  returns a handoff; it does not launch an opaque child Agent.
- During Agent migration, edit only the returned `editableScope`, read every
  `requiredReads` file completely, and preserve every `readOnlyPaths` entry.
  Treat `upstream-source/` as inert reference. Never execute its scripts, add
  client-side credentials or generic proxy routes, alter Taku authority files,
  upload, register, or publish.
- `subapp-conversion-check` is static. A pass proves structure, provenance,
  product-test discovery, Action consistency, placeholder removal, resolved
  analyzed risks, and the converted readiness claim. It does not prove that
  tests, build, preview, or Taku launch succeeded.
- Trusted runtime validation requires a fresh `subapp-runtime-plan` confirmation
  bound to the candidate digest and pinned Node/pnpm versions. Never reuse a
  token after candidate changes or skip directly to `subapp-runtime-check`.
- Runtime validation may download only Publisher-compiled, checksum-pinned
  Node/pnpm artifacts and registry dependencies locked by `pnpm-lock.yaml`.
  It must prefetch without lifecycle scripts, install offline, run only in a
  qualified disposable macOS Seatbelt workspace, keep outbound/loopback network
  denied, remove the execution copy, and prove the original candidate unchanged.
- A runtime pass is not publish authority. It may advance only through a fresh
  `subapp-package-plan` confirmation bound to the same candidate and preserved
  preview-build evidence. Never package directly from an arbitrary build path.
- Local SubApp packaging must emit the current Desktop dual-archive shape:
  filtered `source.zip` plus `.next-preview`-rooted `build.zip`. It must reject
  changed evidence, symlinks, environment files, unsafe entries, missing runtime
  scripts, hard-coded ports, and an existing output target. A local package is
  not an upload, registration, Desktop installation, or publication claim.
- Local Taku Desktop installation requires a fresh `subapp-install-plan` token
  bound to the exact package path, manifest, and archive hashes. Validate that
  token before creating a handoff or opening Taku.
- `subapp-install` may write only one owner-only, short-lived handoff under the
  Publisher state directory and may pass only its opaque ID through the
  `taku://subapp/install` deep link. Never put a package path or archive bytes in
  the URL, call a development checkout, or bypass Taku Desktop's install dialog.
- Claim successful local installation only when the packaged Taku client returns
  `subapp_installed_and_opened` with a local Application ID. This path must not
  authenticate, upload, register, or publish anything.
- Private SubApp registration requires a fresh `subapp-register-plan` token
  bound to the exact package bytes, create/update mode, explicit update App ID,
  listing metadata, and source-rights declaration. Validate that token before
  browser login, signed upload requests, or any other remote mutation.
- Registration metadata must contain a public HTTPS icon, complete catalog
  fields, at least one category, and valid rights. Derived/third-party work must
  identify its public HTTPS source and license or explicit-permission basis.
- `subapp-register` may create/update only an owner-scoped catalog `draft`, use
  distinct signed uploads for `source.zip` and `build.zip`, and register one
  version with matching hashes, sizes, runtime manifest, and Desktop start
  contract. Do not set `published`, expose public download URLs, or claim a
  public release. Existing registration state must fail closed to avoid silent
  duplicate versions.
- Use the bundled, version-checked `repo-to-stax` assessment and preparation runtime by default.
  An explicit Converter entry is a developer-only diagnostic override. If the
  bundled runtime is unavailable or incompatible, report that installation as
  invalid; never copy Analyzer logic into a prompt or substitute an ad-hoc
  shell scan.

## Project Import Flow

Use this flow when the creator asks to find, import, convert, or package a
project they worked on in Codex or Claude Code.

Start with local metadata-only discovery:

```bash
node scripts/taku-publisher.mjs project-discover --host all
```

Show project name, source host, last activity, and the lightweight route hint.
Do not show raw session paths or content. Ask the creator to choose exactly one
project and stop until they do. Discovery is not source assessment.

After selection, assess the exact absolute local directory:

```bash
node scripts/taku-publisher.mjs project-assess --source <absolute-project-directory>
```

Follow the returned route exactly:

- `existing-skill`: use `discover` with the exact source, then the normal
  confirmed Skill publishing flow.
- `subapp-migration`: use the returned SubApp confirmation with
  `subapp-prepare`, or follow `subapp-assess` review/service-mapping steps when
  the unified assessment says review is required.
- `skill-generation`: show the proposed Skill route and risks, then stop for
  explicit confirmation before preparing a candidate.
- `reference-only`: explain the unsupported runtime and stop. Do not prepare a
  candidate.

After the creator confirms one eligible Skill generation assessment, pass its
token unchanged and prepare one isolated candidate:

```bash
node scripts/taku-publisher.mjs skill-prepare --source <same-source> --output-root <existing-absolute-directory> --confirm-assessment <token> [--name <candidate-name>]
```

After success, show the candidate name and ask whether to start bounded Agent
migration. Stop until the creator confirms. Then run:

```bash
node scripts/taku-publisher.mjs skill-convert --candidate <absolute-candidate-path>
```

Read every returned `required_reads` file completely. Treat the source project
and candidate `.taku` directory as read-only. Implement the smallest complete
repeatable workflow only in `editable_scope`; remove the placeholder marker,
write trigger-oriented frontmatter, and copy only required public-safe scripts,
references, or assets. Never execute the source project during this phase.

After each migration pass, run:

```bash
node scripts/taku-publisher.mjs skill-conversion-check --candidate <same-candidate-path>
```

Continue while the result is `skill_conversion_needs_work`. After
`skill_conversion_static_gate_passed`, use the candidate as the explicit source
for the normal Skill `discover -> init -> stage -> scan -> apply-review ->
package` flow. The local `.taku/skill-conversion.json` record is excluded from
staging. Static conversion success does not replace runtime review, security
scanning, packaging, upload confirmation, or Taku Web submission.

## SubApp Candidate Flow

First assess the exact source:

```bash
node scripts/taku-publisher.mjs subapp-assess --source <absolute-path-or-github-url> [--source-ref <ref>] [--service-catalog-url <trusted-proxy-url>]
```

When the result is `review-required` for non-service warnings, copy the returned
`assessment_review_template` to a private local JSON file, review every finding,
and fill only each `decision`, `rationale`, and `remediation`. Rerun assessment
with the same source/ref and `--assessment-review <review.json>`. Stop if the
review is rejected or stale. Service warnings must still use the separate
service-mapping flow.

Only when assessment is eligible or returns
`subapp_conversion_review_accepted`, show the result in product language and ask
the creator to confirm candidate preparation. After confirmation, pass the
returned token unchanged, keep the same source/ref, and pass the same review file
when one was required:

```bash
node scripts/taku-publisher.mjs subapp-prepare --source <same-source> --output-root <existing-absolute-directory> --confirm-assessment <confirmation-token> [--source-ref <same-ref>] [--name <candidate-name>] [--service-catalog-url <same-trusted-proxy-url>] [--assessment-review <same-review.json>]
```

After success, give the creator the candidate directory and ask whether to start
Agent migration. Stop until they explicitly confirm.

When the creator asks to start or continue the exact candidate, run:

```bash
node scripts/taku-publisher.mjs subapp-convert --candidate <absolute-candidate-path>
```

When it returns `perform_subapp_agent_migration`, the current Agent must read
every returned `requiredReads` file, inspect the inert upstream snapshot, and
implement the smallest complete safe workflow inside the returned editable
scope. It must preserve all protected paths and record honest evidence in
`SUBAGENT_EXPERIENCE.md`. Do not execute candidate or upstream scripts in this
phase.

After each implementation pass, run:

```bash
node scripts/taku-publisher.mjs subapp-conversion-check --candidate <same-candidate-path>
```

Continue migration while status is `subapp_conversion_needs_work`. A
`subapp_conversion_static_gate_passed` result advances only to trusted runtime
validation. It is not permission to package, upload, register, or publish.

First generate the read-only runtime plan:

```bash
node scripts/taku-publisher.mjs subapp-runtime-plan --candidate <same-candidate-path>
```

Show the pinned Node/pnpm requirements and ask the creator to confirm. Only
after explicit confirmation, pass the returned token unchanged:

```bash
node scripts/taku-publisher.mjs subapp-runtime-check --candidate <same-candidate-path> --confirm-runtime <confirmation-token>
```

If the candidate changes, rerun the plan and obtain a new confirmation. A pass
proves isolated frozen install, tests, design slots, type checking, CI checks,
and a preserved `.next-preview` build for the exact candidate. It does not
authorize upload, registration, or publishing.

Before creating archives, validate the exact candidate/evidence pair:

```bash
node scripts/taku-publisher.mjs subapp-package-plan --candidate <same-candidate-path> --runtime-evidence <evidence-root-returned-by-runtime-check>
```

After explicit confirmation, pass that package token unchanged and use one
existing absolute output directory:

```bash
node scripts/taku-publisher.mjs subapp-package --candidate <same-candidate-path> --runtime-evidence <same-evidence-root> --output-root <existing-absolute-directory> --confirm-package <confirmation-token>
```

This creates deterministic `source.zip`, `build.zip`, and a local package
manifest only. It does not upload, register, or publish the SubApp.

For the normal local-use path, validate the exact release before opening the
installed Taku Desktop client:

```bash
node scripts/taku-publisher.mjs subapp-install-plan --package-root <release-directory>
```

After the creator confirms that exact local installation, pass the returned
token unchanged:

```bash
node scripts/taku-publisher.mjs subapp-install --package-root <same-release-directory> --confirm-install <confirmation-token>
```

Taku Desktop shows its own installation confirmation, revalidates both archives,
installs them into its managed Application directory, and opens preview. This
local path does not require a Taku account, App registration, upload, or public
release. If Taku opens but the command remains pending, ask the creator to
confirm the dialog or update Taku Desktop; never fall back to a development CLI.

Before any remote mutation, prepare a public-safe registration metadata JSON
with the catalog listing, release notes, and source-rights declaration, then run:

```bash
node scripts/taku-publisher.mjs subapp-register-plan --package-root <release-directory> --metadata <registration-metadata.json> --mode create
```

For an update, use `--mode update --app-id <exact-owned-app-id>`; never infer an
update target from a title. Show the exact App name, mode, rights summary, and
five planned remote operations, then stop for confirmation. After the creator
confirms that exact plan, pass the token and unchanged arguments:

```bash
node scripts/taku-publisher.mjs subapp-register --package-root <same-release-directory> --metadata <same-registration-metadata.json> --mode create --confirm-registration <confirmation-token>
```

On success, explain that the source/build archives and version exist only in an
owner-scoped private draft. Do not describe it as published, released, publicly
downloadable, or installable from Taku Marketplace. Public release review and
packaged-client App Store installation remain separate later phases.

## Creator Profile / Stax Card Flow

Use these commands when the creator asks to generate a Stax Card, AI Builder Profile, builder persona, public creator page, or scan the tools they use:

```bash
node scripts/taku-publisher.mjs creator-init [--host codex|claude-code|all] [--max-projects <n>]
node scripts/taku-publisher.mjs creator-plan --select <project-id=skill|subapp,...> [--host codex|claude-code|all]
node scripts/taku-publisher.mjs creator-plan-show --plan-id <plan-id>
node scripts/taku-publisher.mjs creator-plan-next --plan-id <plan-id>
node scripts/taku-publisher.mjs creator-plan-update --plan-id <plan-id> [--card-status <ready_for_review|published|skipped>] [--project-id <id> --project-status <queued|in_progress|completed|blocked>] [--remote-item-id <id>]
node scripts/taku-publisher.mjs creator-doctor --json
node scripts/taku-publisher.mjs creator-scan --json --compact [--workspace <workspace>] [--usage-period today|last7Days|last30Days|last90Days|thisMonth|allTimeLocal] [--max-usage-files <n>] [--include-creation-candidates] [--include-github-metrics] [--include-prompt-style]
node scripts/taku-publisher.mjs creator-draft --json --editor [--workspace <workspace>] [--usage-period today|last7Days|last30Days|last90Days|thisMonth|allTimeLocal] [--include-creation-candidates] [--worker-url <url>] [--site-url <url>]
node scripts/taku-publisher.mjs creator-editor --json --draft <draft.json> [--worker-url <url>] [--site-url <url>]
node scripts/taku-publisher.mjs creator-switch-account
node scripts/taku-publisher.mjs creator-publish --json --draft <draft.json> [--worker-url <url>] [--site-url <url>]
```

Use `creator-init` for the first response when the request needs a Stax Card plus local project choices. Show each project name, recommended target, and a note that eligibility is validated after selection. Accept replies such as "1 and 3 as Skill, 2 as SubApp; publish my Stax Card first", map the displayed numbers to project IDs, and create the persistent plan.

For a creator publish plan:

- Treat `projectChoices.recommendedTarget` as a recommendation, not proof of eligibility. Skill selection must still pass `project-assess` and the existing Skill route; SubApp selection must still pass assessment.
- Once the creator publishes or explicitly skips the Stax Card, record that status and request `creator-plan-next`.
- Mark only the current project `in_progress`. Run the existing single-project flow and mark it `completed` only after authoritative success; use `blocked` when validation or review stops it.
- Continue queued projects without delaying the already-published Stax Card/Profile for a long SubApp conversion.
- Never describe the plan itself as publication. All existing confirmations and authoritative status checks remain required.

Default to `creator-draft --json --editor` for any creator-facing generation request, including "make my Stax Card", "generate persona labels", "generate Creator Profile", "summarize my builder persona", "generate a Creator Profile summary", or similar. The CLI must finish Taku Web account confirmation before it starts that scan. Its default usage window is the recent 90-day local scan; pass `--usage-period thisMonth` only when the creator explicitly asks for this-month stats. The cloud Studio is the only normal user-facing review surface; do not present raw JSON paths, local HTML paths, command names, or `previewPath` / `previewUrl` as the main call to action unless the creator asks for debugging details.

Only use `creator-scan --compact` when the creator explicitly asks for a text-only scan/report, says they do not want a preview/editor, or asks for debugging metrics. Keep the compact host result as the default so local paths and scan previews stay out of the model context. If the request could reasonably mean "generate something I can review", use `creator-draft --json --editor`, not `creator-scan`.

After `creator-draft --json --editor`, the CLI must return an `editorUrl` under the trusted Worker Studio route, normally `https://worker.taku.ai/stax/studio/editor?...`. Treat a result without `editorUrl` as a failed Creator Profile draft unless the user explicitly asked for scan-only output. The user-facing next step should be "open this private cloud draft" and include only `editorUrl` for ordinary users. Never replace a missing Worker Studio URL with an LP/Profile page. Mention local `previewUrl` or `previewPath` only as an explicit debugging fallback.

For creator profile scans:

- Before a new scan or draft, authorize through Taku Web. Reuse an unexpired scoped Publisher session only when it has `creator.profile.read` and `creator.studio-draft.write`; do not fall back to an unrelated Desktop session.
- Saving the sanitized result as the creator's private Worker Studio draft is part of generation. It is not public publication and does not grant `creator.card.write`.
- Default public tools and works to hidden/unselected. The creator chooses what appears on the Stax Card or Creator Page.
- Prompt-style/personality badges that read local prompt metadata require explicit opt-in via `--include-prompt-style`; raw prompt text must never be uploaded.
- Publishing sends only sanitized profile/card fields, public profile snapshot, compact usage summary, and selected public inventory. It must not upload prompts, source content, command arguments, raw logs, env vars, tokens, secrets, or local filesystem paths.
- The cloud Studio can publish only after a separate, explicit public-card action. It does not require Taku Desktop. If auth is missing, open the provided Web login URL once; never ask the creator to paste tokens into chat or loop through authorization attempts.
- `creator-switch-account` clears the bound Publisher session, confirms a different Taku account, and saves the existing local draft again without rescanning. Do not regenerate unless the source changed.
- Use `--local-editor` only when the creator explicitly asks for local development/debugging. The static `.html` preview remains read-only.

When responding after `creator-draft --editor`, lead with the generated public-facing summary: persona code/title, short persona description, whether tools/works are selected, and the private cloud Studio URL. Keep scan counts secondary and omit local paths unless the creator asks for technical details.

## Creator Center Flow

Use these commands when the creator asks to view, search, inspect, or manage their own Taku works:

```bash
node scripts/taku-publisher.mjs creator-center-list --json [--type <type>] [--status <status>] [--search <text>] [--limit <n>] [--offset <n>]
node scripts/taku-publisher.mjs creator-center-show --json --item-id <item-id>
node scripts/taku-publisher.mjs creator-center-stats --json
node scripts/taku-publisher.mjs creator-center-update --json --item-id <item-id> [--name <text>] [--short-description <text>] [--description <text>] [--tags <csv>] [--categories <csv>]
node scripts/taku-publisher.mjs creator-center-unpublish --json --item-id <item-id> [--confirm-item-id <same-item-id>]
```

- Default to `creator-center-list --json` for "open/show my Creator Center", "what have I published?", or "show my works".
- Use `--search`, `--type`, or `--status` to narrow results. If a write request does not resolve to exactly one returned item, show the matching names and ask the creator to choose; never mutate by guessing from a local folder or similar title.
- Treat `stats` as trusted server-side Taku metrics. Do not combine them with forgeable local usage and present the result as a platform statistic.
- `creator-center-update` can edit only a server-owned item whose status is `draft`. It supports title, short description, detailed description, tags, and categories.
- For an unpublish request, first resolve the user's wording with
  `creator-center-list`, then call `creator-center-show` for the one selected
  item. Show its name, type, and published status, explain that Marketplace
  visibility will be removed while data is preserved, and ask for explicit
  confirmation. Do not call the mutation in the same turn as that confirmation
  question.
- After the creator confirms, call `creator-center-unpublish` with both
  `--item-id <id>` and `--confirm-item-id <same-id>`. The command must reject a
  missing or mismatched confirmation and must never resolve the mutation target
  from a display name.
- After unpublishing, verify the returned item status is `draft` and report that
  the work is no longer public. Do not claim Marketplace removal if the
  authoritative response does not confirm the state change.
- If update returns `updateRequiresPublisher: true` or `nextAction: start_publisher_update`, use the selected `itemId` to start the existing Publisher `update` workflow. Do not bypass review by editing the published row directly.
- For a published version update, call `creator-center-show` for the exact
  server-owned item, then discover the creator's explicit local source. Show
  both names and types before creating local state; never infer that similarly
  named local and remote items are the same work.
- Initialize the selected source with `--mode update --item-id <selected-id>`.
  The Worker inherits the current public listing by default, including title,
  descriptions, icon, categories, tags, platforms, source/rights fields,
  support details, screenshots, and examples. Local file metadata must not
  silently replace those fields.
- Use `remote-create --metadata <json>` only for listing fields the creator
  explicitly asked to change. A version update requires a changelog, which may
  be supplied in that metadata or completed on the Web confirmation page.
- Creating and uploading an update draft does not publish it. The creator must
  review the inherited listing, new package, scan results, and changelog on
  Taku Web and personally confirm the release.
- Do not expose `itemId` in the main response unless it helps distinguish duplicate names or the creator asks for technical details.
- Authorization uses the browser PKCE flow with narrow Creator Center scopes.
  Unpublishing requests a separate `creator.items.unpublish` grant instead of
  reusing ordinary draft write access. Never ask the creator to paste a token
  into chat.

## Marketplace Consumer Flow

Use these commands when the user asks to find or inspect a Taku community item,
or install a compatible Skill from Taku Marketplace:

```bash
node scripts/taku-publisher.mjs marketplace-search --json [--search <text>] [--kind all|app|tool|skill|plugin|mcp|cli|agents|workflow|bundle|reference] [--limit <n>] [--offset <n>]
node scripts/taku-publisher.mjs marketplace-show --json --item-id <item-id>
node scripts/taku-publisher.mjs marketplace-open --json --item-id <item-id>
node scripts/taku-publisher.mjs marketplace-install --json --host codex --item-id <item-id>
node scripts/taku-publisher.mjs marketplace-install --json --host codex --item-id <item-id> --confirm-item-id <same-item-id>
```

- Search covers the full public community catalog by default. Apps, Tools,
  Skills, Plugins, MCPs, Workflows, Bundles, and references may appear in the
  results. Use `display_kind`, `installability`, and the returned CTA to explain
  what the user can do with each result.
- Installation remains narrower than search: this consumer version installs
  only published `skill` items into Codex. Other kinds may be shown or opened
  in Taku Desktop through `marketplace-open`, which keeps the deep link
  internal; they must not be written into the Codex Skills directory. Search
  and show may run from either host, but do not claim Claude Code installation
  support.
- Start with `marketplace-search --json`. Present a compact list with name,
  kind, creator, short description, version, and install count. If more than one
  item matches, ask the user to select one; never choose by fuzzy title.
- Terminal responses must not display raw `taku://` deep links or rely on them
  being clickable. Use `recommended_action` to distinguish the next step:
  `install_in_codex` means the confirmed Skill installation flow;
  `open_in_taku_desktop` means the item requires Taku Desktop; and
  `view_details` means no direct terminal installation action is available.
- For App and other `open_in_taku_desktop` results, say once that they cannot be
  installed into Codex and ask the user to reply with one item number. Do not
  print an opening command for every result and do not open anything during a
  search-only request.
- After the user selects one exact App and asks to open/install it, or replies
  to an explicit "choose one and I will open it" prompt, run
  `marketplace-open --item-id <selected-id>`. On success, say that Taku Desktop
  is open and the user should confirm there. Do not expose the deep link or the
  item ID in the normal response.
- If `marketplace-open` cannot launch Taku, explain that the current terminal
  may be remote/headless or Taku Desktop may be missing. Offer the returned
  public HTTPS `external_url` when present; do not fall back to displaying the
  custom-protocol address.
- Use the selected `item_id` with `marketplace-show --json` when the user wants
  details. Do not expose raw Marketplace metadata, storage paths, package URLs,
  or authorization data.
- When the user asks to install, first run `marketplace-install` without
  `--confirm-item-id`. This is preflight only: it may authorize the account and
  inspect the server contract, but it must not download or write the Skill.
- Summarize the exact Skill, creator, version, target directory, and declared
  configuration requirement names/purposes. Explain that an existing Skill
  with the same slug will not be replaced. Ask the user to confirm this exact
  installation, and stop the turn.
- Only after that explicit confirmation, rerun the command with both item ID
  flags set to the same selected ID. If the IDs differ, stop; do not retry with
  an inferred ID.
- Successful installation verifies the server SHA-256 and package size, rejects
  unsafe ZIP paths, symbolic links, unsupported file types, excessive file
  count/size, and packages without a root `SKILL.md`, then atomically creates
  `~/.codex/skills/<slug>`.
- Never overwrite or merge into an existing target. If the target exists, tell
  the user which Skill slug conflicts and let them decide how to handle it.
- After success, tell the user to start a new Codex task so the newly installed
  Skill is discovered. A failed install-record request may be reported as a
  non-blocking analytics warning only when the local atomic install succeeded.

## Runtime Availability

Do not introduce runtime dependency concerns unless a command actually fails because a runtime is missing.

- Every Publisher, Marketplace, Creator Profile, and Creator Center command uses
  the bundled Node.js runtime and does not require `npm install`.
- SubApp assessment and candidate preparation include their compatible Converter
  runtime, pinned Taku template, and TypeScript validator; do not
  ask creators to install or locate `repo-to-stax`.
- Node.js 20 or newer is the only external runtime requirement. Python is not
  part of the generated Codex or Claude Code plugin.
- If `node` is missing or too old, say: "This device needs Node.js 20+ to run
  Taku Publisher."
- Do not ask the creator to install Node packages; all runtime modules required
  by the plugin are included in the plugin archive.

## Main Workflow

Default one-shot order for "publish this folder/root to Taku":

```bash
discover -> init -> stage -> scan -> apply-review -> package -> remote-create
```

Do not run `remote-create` immediately after `init` unless the creator explicitly asks to edit the listing in Taku Web before upload. In the normal path, create the Taku Web preview only after the local scan and package are ready. When `remote-create` sees a ready local package, it creates the listing draft and uploads the scan results plus bundle in that same command, so the returned preview page should be the final confirmation page, not a half-ready page with disabled Artifact/Security checks.

### 1. Discover candidates

Scan only the current workspace, or one explicit source supplied by the creator:

```bash
node scripts/taku-publisher.mjs discover --workspace <workspace>
node scripts/taku-publisher.mjs discover --workspace <workspace> --source <explicit-tool-path>
```

Show every returned candidate and ask the creator to choose one. Do not auto-select by title. The only currently supported publishing type is `skill`; `action`, `agent`, and `plugin` are not available yet.

### 2. Confirm create or update

Create a local draft only after one source and one type are explicit:

```bash
node scripts/taku-publisher.mjs init --workspace <workspace> --source <path> --type skill --mode create
node scripts/taku-publisher.mjs init --workspace <workspace> --source <path> --type skill --mode update --item-id <platform-item-id>
```

Keep the returned `draft_id`. Local state lives under `~/.taku/publisher/<draftId>` with owner-only permissions. It contains local paths and is never a public payload.

### 3. Platform draft rules

Default path: run this after `stage`, `scan`, `apply-review`, and `package`. When Taku auth is available and the local package is ready, this creates the remote draft and immediately uploads the scan report plus package bundle:

```bash
node scripts/taku-publisher.mjs remote-create --draft-id <draft-id>
```

If the command returns `status: awaiting_web_confirmation`, the returned `review_url` is the final confirmation page. The creator should be able to review and publish there after refreshing the page.

Remote commands first use explicit environment tokens for CI, then reuse the standalone Publisher session at `~/.taku/publisher/session.json`, and finally keep the local Taku Desktop session as a compatibility fallback. If no authorization is available, the command opens Taku Web, waits for the loopback PKCE authorization, and resumes the same draft automatically. Users may sign in or create a Taku account on the Web and do not need to install Taku Desktop. Never ask the creator to paste any token.

The default create payload must include enough listing metadata for the final read-only review page to be submittable after upload:

- `sourceKind: local_upload`
- `authorshipKind: original`
- non-empty detailed Markdown in `description`
- at least one marketplace category
- at least one usage example
- supported platforms

This prevents a required field such as publishing rights, details, or icon from becoming impossible to fill after the package moves the draft into read-only review. When the selected source has an obvious license file or README license section, include that license in the listing payload. If the creator provides `--metadata`, merge it over these defaults instead of replacing the whole listing object.

For the icon, call Taku's own `/marketplace/icons/generate` endpoint before creating or locking the publish flow, and store the returned HTTPS `iconUrl` on the listing. Do not invent a third-party placeholder icon or use a different icon service; generated icons must match Taku Web's "Generate icon" style. If Taku icon generation fails, create or keep the listing draft editable, show the draft URL, and pause before `remote-scan` / `remote-upload` so the creator can generate or provide an icon in Taku Web.

If `remote-create` was accidentally run before the local package is ready and the response has `review_url`, treat it as an optional listing-edit page, not the final publish page. The Publish release button is expected to stay disabled at this stage because the local scan report and package have not been uploaded yet. Do not stop here on the default path.

- Fallback path: if `remote-create` returns `requires_action: false`, `action_type: continue_local_scan_and_upload`, or `next_step: continue_local_scan_package_and_upload`, continue immediately to stage, scan, review, package, `remote-scan`, and `remote-upload` in the same assistant turn.
- Manual edit path: only when the creator explicitly asks to edit the listing before upload, show the editable draft URL and explain that Publish release will stay disabled until you upload the scan results and package after their edit.
- Icon fallback path: only when `remote-create` returns `requires_action: true` with `action_type: generate_icon_on_taku_web_before_upload`, show the editable draft URL and pause so the creator can generate or provide an icon in Taku Web before upload.

If the creator did not ask to manually edit the listing first, continue to stage, scan, review, package, `remote-scan`, and `remote-upload` in the same workflow rather than stopping at `remote-create`. Never tell the creator to "save and tell me to continue" after successful automatic icon generation. Do not present the `remote-create` URL as the final confirmation page.

If the platform response reports missing or expired auth, do not show raw auth error JSON and do not ask for a token. Run `node scripts/taku-publisher.mjs auth-login`, let the creator approve the request in Taku Web, and then resume the current local publishing draft; do not restart from discovery unless the source files changed. Use `auth-status` only for troubleshooting and `auth-logout` to revoke the local Publisher session. Never show token values.

### 4. Stage and scan

```bash
node scripts/taku-publisher.mjs stage --draft-id <draft-id>
node scripts/taku-publisher.mjs scan --draft-id <draft-id>
```

Staging is immutable. Source changes require a new local draft; do not patch `staging/` or bypass its digest.

Deterministic scan blocks real credentials, private keys, password-bearing database URLs, Bearer values, local absolute paths, private-network URLs, unsafe paths, limits, and unsafe package objects. It sends dangerous commands, process execution, network access, filesystem access, and broad permissions to mandatory semantic review.

### 5. Perform the mandatory deep scan

When the CLI returns `action_type: perform_semantic_review`:

1. Read `deep-scan-request.json`.
2. Read every staged file listed in `review_files`; do not rely only on generated regex findings.
3. Analyze business purpose and data flow for innocently named credentials, exfiltration, dynamic execution, command injection, excessive filesystem/network/permission scope, undeclared environment requirements, and unsafe install/runtime behavior.
4. Start from `deep-scan-dispositions.template.json` and write a separate JSON file. Set `full_review_completed` to `true`, resolve every generated finding as `allow`, `block`, or `not_applicable`, add semantic misses to `additional_findings`, and use `requirement_updates` for undeclared or misclassified configuration names.
5. Use meaningful rationales without copying secret values.
6. Apply the result:

```bash
node scripts/taku-publisher.mjs apply-review --draft-id <draft-id> --dispositions <reviewed-json>
```

Pause on any block. Tell the creator which relative file and risk category need fixing; never reveal a detected value. Read [references/security-model.md](references/security-model.md) for the dispositions schema and review criteria.

### 6. Build the artifact

```bash
node scripts/taku-publisher.mjs package --draft-id <draft-id>
```

This creates `bundle.zip`, `bundle.sha256`, `file-list.json`, `scan-report.json`, and `requirements.json`. Skill releases use the reproducible ZIP format. The package contains the public `.taku/package.json` capability manifest plus legacy `.taku/manifest.json` and `.taku/requirements.json`, but no real Key and no Base64 archive inside JSON.

### 7. Upload scan and bundle

```bash
node scripts/taku-publisher.mjs remote-scan --draft-id <draft-id>
node scripts/taku-publisher.mjs remote-upload --draft-id <draft-id>
```

`remote-upload` requests a presigned URL, performs a binary `PUT`, then reports only the platform-issued `artifactId`, size, and SHA-256 to Worker. Taku auth is not sent to the signed storage URL.

If the response has `review_url`, show it and pause. The creator must inspect the listing, files, version, permissions, requirements, and scan results, then submit on Taku Web. Never call a direct submit method from the host workflow.

When `publisher_account_hint` is present, show it next to the final review instruction so the creator knows which Taku account owns the private draft. The hint is already masked; never replace it with a token or read credential values into chat.

User-facing messages for this step should look like:

- "The Taku draft is ready for final review: <review_url>. Please check the listing, files, permissions, and scan summary there."
- "The package is ready locally. Approve the Taku Publisher request in the Web page I opened, and the upload will continue."
- "Taku accepted the package and is waiting for your final confirmation on the review page."

If Publish release is disabled after `remote-create` but before `remote-scan` / `remote-upload`, explain that this is expected and continue uploading the scan and package. If Publish release is disabled after `remote-upload`, check `remote-status`; likely causes are missing listing fields, missing publishing rights, or a platform-side review warning that needs web confirmation.

Avoid:

- Listing the local bundle path, SHA-256, draft ID, remote artifact ID, or CLI command sequence as the main response.
- Saying "published" or "submitted" unless `remote-status` confirms that state.

### 8. Read remote status

```bash
node scripts/taku-publisher.mjs remote-status --draft-id <draft-id>
```

Use remote status for submitted/reviewed/published claims. `status` without `remote-` is local-only and cannot prove platform review state.

## Listing Information

Taku Web should collect title, short description, icon, categories, tags, detailed Markdown, examples/media, supported platforms/runtime, version and changelog, source rights, license/upstream URL, support email, privacy policy, dependencies, permissions, network access, and declared configuration requirements. The platform must derive tool type, files, artifact digest, and scan results from the signed draft/artifact rather than trusting editable form fields.

## Key Configuration

`requirements.json` declares only names, purpose, required status, and relative source evidence. Classify credential-like variables as `secrets` and ordinary settings as `env`.

For downloadable tools, the installer configures actual values in the Taku client after installation. Store them in the OS keychain or Taku encrypted secret store, scoped by user, item ID, and requirement name; inject them only at runtime. Do not write them into the package or project `.env`.

Run Online credential hosting is not part of this MVP. It requires a separate Taku Web credential page and server-side secret vault.

## Dependencies

- Worker must implement the routes in [references/api-contract.md](references/api-contract.md), private artifact storage, server-side ZIP/sensitive-data rescanning, ownership checks, and review state.
- Taku Web must implement draft editing, artifact/scan review, credential-free configuration display, and final submission.
- Database migrations remain operator-managed and are not included or executed by this skill.
