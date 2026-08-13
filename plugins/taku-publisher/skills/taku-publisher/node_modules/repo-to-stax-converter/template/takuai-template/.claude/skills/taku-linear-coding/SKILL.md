---
name: taku-linear-coding
description: Use when canonical Taku SubApp template work involves Linear issue design or consolidation, Desktop routing, branch/PR handoff, coding from a TAKU issue, evidence sync, or lead-gated completion.
---

# Taku Linear Coding

Use Linear as the durable task ledger for the canonical Taku SubApp template. Read local `AGENTS.md` and `skills.md` before acting, plus the outer Taku Linear playbook when available.

## Required Behavior

1. Read a referenced TAKU issue before editing and update it before final handoff.
2. Create an issue only for a durable, independently reviewable outcome; put temporary checks and session detail in the owning issue.
3. Route template/runtime/build-contract work to `Taku Desktop`; do not create a separate template project.
4. Use human-readable outcome titles and descriptions containing background, evidence/data, approach, acceptance criteria, and verification plan.
5. Use comments for decisions, actions, results, screenshots/evidence, risks, and next actions. Keep file-level detail and full logs in the PR.
6. Complete and verified work stops at `In Review` unless haipro or Jacky explicitly approves that specific issue.
7. Keep this internal skill and its Linear context excluded from generated SubApps through `.taku-template.json`; user-facing guidance belongs under `.taku-template/payload/`.

## Lead Completion Gate

- Completion approvers: `haipro` and `Jacky`; default reviewer for Desktop work: `haipro`.
- An agent may set `Done` only after explicit issue-specific lead approval and must comment `完成审批：@approver`.
- Never infer approval from login identity, assignment, PR merge, CI, generated output, deployment, verification, or a standing instruction.
- GitHub, release, parent/sub-issue, and other automations must stop at `In Review` or make no status change.

If Linear tools are unavailable, finish the work and emit a Linear sync packet no later than `In Review` unless explicit lead approval already exists.
