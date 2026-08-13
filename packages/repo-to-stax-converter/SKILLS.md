# Skills For Maintaining Repo To Stax Converter

## Converter development

1. Add or update a failing test before changing behavior.
2. Keep the pilot registry stable unless product scope explicitly changes.
3. Treat upstream credit, resolved source/template identity, and output safety as hard requirements.
4. Back analyzer/routing changes with fixtures, including nested framework signals and non-app boundaries.
5. Keep `taku.manifest.json` runtime-only; write migration facts to `.taku/migration.json`.
6. A generated scaffold is an intermediate workspace, not a completed or publishable SubApp.

## Generated workspace handoff

An Agent must be able to continue using only local files:

- `UPSTREAM_CREDITS.md` preserves attribution and license obligations.
- `STAX_CONVERSION_PLAN.md` explains type, strategy, risk, and next actions.
- `.taku/migration.json` records source/template snapshots and migration state.
- `.agents/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md` are the discoverable method packages.
- `SUBAGENT_EXPERIENCE.md` captures evidence, blockers, scope decisions, and skill gaps.

Do not silently retain template demo Actions, Python sidecars, embedded provider credentials, local business-file persistence, or fake-success previews.

## Completion gate

```bash
pnpm test
pnpm build
node dist/index.js --help
node dist/index.js pilot
TAKU_TEMPLATE_ROOT=/absolute/path/to/takuai-template-main pnpm run smoke:canonical-template
```

For a migrated workspace, report `workspace`, `conversion`, and `publish` validation separately. A successful build alone is never publish evidence.

Never execute a repo-derived workspace's install, test, build, or runtime scripts from the publish validator. Treat every attestation file as untrusted evidence. The standalone converter has no production authority and must fail publish with `publish.attestation-authority-unavailable`; do not add CLI/env/path/key injection as authority or invent a test signer. A future green path requires a Taku-controlled server, a reviewed compiled production public key, or a genuine same-process Seatbelt capability, plus an approved profile artifact.

Conversion validation requires at least one migrated TypeScript product test that is neither the Template-owned Host RPC contract nor an unchanged renamed copy of it, and reports the known static false-green when those tests lack the exact template-owned command, `tsx` version, or approved four-file launcher bytes. Its deterministic bounded discovery and contract reads must fail closed on unsafe links, containment failures, oversize files, or budget exhaustion. This is a structural diagnostic only: the converter must not execute the candidate launcher or claim runtime test coverage.
