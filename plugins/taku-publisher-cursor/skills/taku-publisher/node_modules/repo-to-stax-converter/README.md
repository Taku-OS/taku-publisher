# Repo To Stax Converter

> Publisher integration note: this workspace package was imported from the
> repository and commit recorded in `UPSTREAM.json`. It is the in-repository
> source used for Publisher plugin builds. Generated plugins include the
> `analyze-cli` and candidate-only `prepare-cli` runtime, pinned Taku template,
> and validator needed for self-contained preparation.

`repo-to-stax` turns an **application repository** into a versioned, Agent-ready Taku SubApp migration workspace.

Its purpose is not to pretend that arbitrary GitHub code can be imported and executed safely. The canonical SubApp template defines the target ABI; the converter freezes the upstream/template inputs, preserves credit, applies safety boundaries, and leaves an explicit intermediate workspace where an Agent can complete and prove the migration.

## Product boundary

- Next.js, Vite/React, FastAPI + Next, Streamlit, and Gradio apps route to `subapp-migration`.
- Existing skills/workflows route to native Taku Stax import.
- Browser extensions and external connectors remain reference-only.
- Unknown or non-app runtimes do not enter the SubApp converter simply because they contain code or assets.

Run `analyze` first when the boundary is unclear. Its JSON includes both static analysis and the recommended route.

## Commands

Taku 开发者需要联动 Converter、Template 和 Desktop 时，先看[三仓 SubApp 转换说明](docs/three-repo-subapp-conversion.md)。

```bash
pnpm install --frozen-lockfile
pnpm build

node dist/index.js pilot
node dist/index.js analyze Nutlope/roomGPT
node dist/index.js prepare <repo-or-path> \
  --output-root /absolute/existing/output/root \
  --work-root /absolute/private/work/root \
  --expected-source-digest sha256:<confirmed-digest> \
  --name roomgpt-candidate
node dist/index.js handoff /absolute/path/to/roomgpt-candidate
node dist/index.js validate-conversion /absolute/path/to/roomgpt-candidate
node dist/index.js convert <repo-or-path> \
  --out /absolute/output/root \
  --template /absolute/path/to/takuai-template-main \
  --name roomgpt-subapp
node dist/index.js validate /path/to/generated/subapp --level workspace
node dist/index.js validate /path/to/generated/subapp --level conversion
node dist/index.js validate /path/to/generated/subapp --level publish
```

`handoff` and `validate-conversion` are static, read-only orchestration
boundaries. They do not start an Agent or execute candidate scripts.

The Publisher-only `runtime-cli` is a separate confirmed execution boundary.
It requires the candidate's exact Node process and an exact pnpm CLI inside that
trusted Node runtime, copies the candidate into a disposable workspace,
qualifies macOS Seatbelt in-process, and runs the fixed offline validation
command set. It produces local runtime evidence only and cannot authorize
publish.

Publish validation is deliberately admission-only: it performs static checks, parses execution evidence as untrusted input, and never executes repo-controlled install/test/build scripts on the host. This standalone converter build has no Taku-controlled server, compiled production public key, or same-process Seatbelt capability, so it always fails publish with `publish.attestation-authority-unavailable`.

`--trusted-attestation` is retained only as the legacy CLI name for inspecting evidence. Supplying any file cannot establish publish authority:

```bash
node dist/index.js validate /path/to/generated/subapp --level publish \
  --trusted-attestation /path/to/evidence.json
```

A future publish-capable integration must authenticate evidence through a Taku-controlled server, a reviewed production public key compiled into the verifier, or a genuine same-process Seatbelt capability that callers cannot inject. Seatbelt profile digests must come from a compiled approved-profile allowlist or another verifiable Taku-owned artifact; this build's allowlist is intentionally empty. CLI arguments, environment variables, candidate files, and caller-supplied paths or keys are never authority.

`convert` has no implicit remote template. There is currently no published safe template ref, so use an explicit local checkout. A remote template requires both explicit `--template` and an explicit immutable `--template-ref`; a branch name or omitted ref is never inferred.

```bash
node dist/index.js convert ./source-app \
  --out ./tmp/conversions \
  --template /absolute/path/to/takuai-template-main
```

Every GitHub source cache is fetched and reset before analysis. The converter refuses existing workspace outputs, output/source/template nesting, symlinks, submodule metadata, unsafe policy paths, and file/count/total-size budget violations.

## Workspace contract

Each generated workspace contains:

- the canonical template after `.taku-template.json` remove/overlay/cleanup policy;
- `upstream-source/` as build-excluded reference;
- `UPSTREAM_CREDITS.md` and `STAX_CONVERSION_PLAN.md`;
- `.taku/migration.json` with source/template refs, commits, version, analysis, and migration state;
- template Taku/Superpowers skills plus repo-specific `.agents/skills/*/SKILL.md` and mirrored `.claude/skills/`;
- `SUBAGENT_EXPERIENCE.md` for evidence and missing-context feedback;
- a clearly marked migration placeholder page.

`taku.manifest.json` stays a runtime manifest. Migration provenance and status never live in private `stax` or `conversionStatus` fields. Template demo Actions are removed before handoff.

## Validation levels

- `workspace`: structure, bridge, policy payload, credit, provenance, generated skills, demo cleanup, and file boundary.
- `conversion`: workspace plus real product page, converted status, manifest/registered Action consistency, at least one migrated product test beyond the Template-owned Host RPC contract, and a fail-closed static check that discovered `src/**/*.{test,spec}.{ts,tsx}` tests use the exact template-owned command, `tsx` version, and approved four-file launcher bytes.
- `publish`: conversion plus known license, resolved static risks, source/template/runtime evidence, static secret scanning, and v3 qualified-execution evidence for a clean frozen install and the complete test/type/lint/build command set. This build then fails closed because authenticated publish authority is unavailable.

Passing one level does not imply the next. Generated workspaces intentionally pass `workspace` and fail `conversion` until an Agent replaces the placeholder and completes the real product workflow. Structurally valid evidence can satisfy individual diagnostics but cannot make publish green without a real, non-injectable Taku authority.

The conversion test-discovery check uses a deterministic bounded `src/` walk aligned with the template's forbidden directories, rejects unsafe links or incomplete discovery, excludes the Template-owned Host RPC test and unchanged renamed copies from product coverage, and compares the small launcher files with converter-compiled SHA-256 values. It is structural only: it does not execute a candidate test command or claim that any discovered test passed or was dynamically covered.

## Development verification

`pnpm test` first creates and verifies a fresh `dist` because the production Kimi wrapper is covered by the integration suite and fails closed on stale compiled prompt code.

```bash
pnpm test
pnpm build
node dist/index.js --help
node dist/index.js pilot
TAKU_TEMPLATE_ROOT=/absolute/path/to/takuai-template-main pnpm run smoke:canonical-template
```
