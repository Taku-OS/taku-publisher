# Repo To Stax Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `<converter-repository-root>` as a local package repo that converts the first pilot GitHub repos into runnable Taku Stax SubApp workspaces, preserves upstream credit, and writes durable skills that let a coding agent finish repo-to-SubApp conversion in one pass.

**Architecture:** The CLI exposes `pilot`, `analyze`, `convert`, and `validate`. `pilot` lists the first batch repos. `analyze` classifies repo type and conversion strategy. `convert` creates a Taku SubApp workspace from `<absolute-taku-template-path>`, copies upstream source under `upstream-source/`, writes `UPSTREAM_CREDITS.md`, `STAX_CONVERSION_PLAN.md`, and `SKILLS.md`, patches `taku.manifest.json`, and emits a runnable placeholder SubApp that summarizes the upstream app and next conversion steps. `validate` checks the SubApp contract, credit preservation, and skills handoff.

**Tech Stack:** Node.js 20+, TypeScript, Commander, Node built-in test runner, `tsx`, and a local Taku template at `<absolute-taku-template-path>`.

---

## Pilot Repos

The first batch is hard-coded as converter knowledge and documentation:

- `jason8745/llm-agent-trader` — FastAPI + Next.js style AI trading/backtesting app; primary full-stack pilot.
- `Vrun-design/openflowkit` — interactive diagramming UI; primary UI-heavy pilot.
- `Nutlope/roomGPT` — Next.js image upload/generation app; primary direct Next.js pilot.
- `mvanhorn/last30days-skill` — skill/workflow repo; primary workflow-to-UI pilot.
- `yvann-ba/Robby-chatbot` — Streamlit document/video chatbot; primary Streamlit-to-Next pilot.

## File Structure

- `src/index.ts` — Commander CLI entrypoint.
- `src/lib/pilots.ts` — first-batch pilot repo registry and lookup helpers.
- `src/lib/analyzer.ts` — repo classifier and conversion scoring.
- `src/lib/fs.ts` — safe filesystem helpers scoped to local paths.
- `src/lib/repo-source.ts` — local path or GitHub URL source preparation.
- `src/lib/template.ts` — safe copy of the local Taku SubApp template.
- `src/lib/manifest.ts` — manifest patching for Stax metadata and upstream credit.
- `src/lib/credit.ts` — `UPSTREAM_CREDITS.md` writer.
- `src/lib/skills.ts` — generated `SKILLS.md` and focused skill docs.
- `src/lib/converter.ts` — orchestrates analysis, template copy, upstream staging, docs, manifest, and placeholder page.
- `src/lib/validator.ts` — validates SubApp contract, upstream credit, skills, and conversion plan.
- `tests/*.test.ts` — behavior tests for pilot registry, analyzer, credit/validation, and conversion.
- `SKILLS.md` — root skill for future coding agents maintaining the converter.
- `skills/*.md` — focused skill docs for actual repo-to-SubApp conversions.

### Task 1: Rewrite Test Contract Around Pilot Repos

**Files:**
- Create: `tests/pilots.test.ts`
- Modify: `tests/analyzer.test.ts`
- Modify: `tests/converter.test.ts`
- Modify: `tests/credit-and-validation.test.ts`

- [ ] **Step 1: Add pilot registry failing test**

`tests/pilots.test.ts` imports `listPilotRepos` and asserts the exact five repos are present with `repo`, `url`, `expectedKind`, and `conversionFocus`.

- [ ] **Step 2: Keep analyzer RED evidence**

Run: `pnpm test`
Expected: FAIL because `src/lib/pilots.ts` and implementation modules are missing.

### Task 2: Implement Pilot Registry And Analyzer

**Files:**
- Create: `src/lib/pilots.ts`
- Create: `src/lib/analyzer.ts`
- Create: `src/lib/fs.ts`

- [ ] **Step 1: Implement pilot registry**

Export `PILOT_REPOS`, `listPilotRepos()`, and `findPilotRepo(input)`.

- [ ] **Step 2: Implement analyzer**

Detect `nextjs`, `vite-react`, `fastapi-next`, `streamlit`, `workflow-skill`, `python-cli`, and `unknown`. Compute `score`, `recommendation`, `reasons`, `risks`, license, README, package name, and strategy.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: pilot and analyzer tests pass; converter tests may still fail until later tasks.

### Task 3: Implement Credit Preservation And Validation

**Files:**
- Create: `src/lib/credit.ts`
- Create: `src/lib/validator.ts`

- [ ] **Step 1: Implement `writeUpstreamCredits`**

Write deterministic credit markdown with upstream name, URL, license, detected type, preservation rules, and source-location notes.

- [ ] **Step 2: Implement `validateSubAppWorkspace`**

Check `package.json`, `taku.manifest.json`, `src/app/page.tsx`, `UPSTREAM_CREDITS.md`, `STAX_CONVERSION_PLAN.md`, `SKILLS.md`, and template bridge files when present.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: credit and validation tests pass.

### Task 4: Implement Converter Workspace

**Files:**
- Create: `src/lib/converter.ts`
- Create: `src/lib/template.ts`
- Create: `src/lib/repo-source.ts`
- Create: `src/lib/skills.ts`
- Create: `src/lib/manifest.ts`

- [ ] **Step 1: Implement safe template copy and upstream staging**

Copy template to `<out>/<name>`, copy source into `upstream-source/`, and ignore `.git`, `node_modules`, `.next`, `dist`, `out`, `.venv`, `__pycache__`, and `.taku`.

- [ ] **Step 2: Generate conversion docs and placeholder app**

Write `STAX_CONVERSION_PLAN.md`, root `SKILLS.md`, `skills/*.md`, and a runnable `src/app/page.tsx` that gives a product-facing overview of the upstream app and conversion checklist.

- [ ] **Step 3: Patch manifest**

Patch `name`, `description`, `version`, `stax.upstream`, `stax.analysis`, and `stax.conversionStatus`.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: all library tests pass.

### Task 5: Implement CLI And Package Repo Hygiene

**Files:**
- Create: `src/index.ts`
- Create: `README.md`
- Create: `.gitignore`
- Create: `SKILLS.md`
- Create: `skills/repo-to-stax-conversion.md`
- Create: `skills/stax-credit-preservation.md`
- Create: `skills/pilot-repo-playbook.md`

- [ ] **Step 1: Implement CLI commands**

Commands:
- `repo-to-stax pilot`
- `repo-to-stax analyze <repo-or-path>`
- `repo-to-stax convert <repo-or-path> --out <dir> --name <name> --template <dir>`
- `repo-to-stax validate <subapp-path>`

- [ ] **Step 2: Write root and focused skills**

The skills must let an agent continue from generated workspace and one-shot the actual conversion: inspect upstream, preserve credit, port UI, adapt backend/API, expose actions, validate, and build.

- [ ] **Step 3: Build and help smoke**

Run: `pnpm build && node dist/index.js --help && node dist/index.js pilot`
Expected: build exits 0 and CLI lists commands plus five pilot repos.

### Task 6: End-To-End Verification

**Files:**
- Generate under `<converter-repository-root>/tmp/` only; do not write outside the selected trusted work root.

- [ ] **Step 1: Convert a faithful local fixture**

Run converter against a local fixture that resembles one pilot repo and uses `<absolute-taku-template-path>`.

- [ ] **Step 2: Validate generated workspace**

Run: `node dist/index.js validate <generated-path>`
Expected: JSON result with `"ok": true`.

- [ ] **Step 3: Prove generated SubApp can run/build**

Run in generated workspace: `pnpm install --frozen-lockfile` and `pnpm build`.
Expected: build exits 0. If native dependency installation blocks in the environment, report the exact failing command and retain the generated workspace for manual retry.
