# Taku SubApp Template Agent Skills

This file is for Linear Agent coding sessions and other coding agents working in the canonical Taku SubApp template repository.

## Linear Context

- Team: `Taku` (`TAKU`).
- Project: `Taku Desktop`; do not create a separate template project.
- Default completion reviewer: haipro; either haipro or Jacky may approve completion.

## Coding Session Rules

- Start from the Linear issue when one exists; keep branch and PR titles tied to its ID.
- Create issues only for durable template/runtime outcomes. Use human-readable titles and include background, evidence/data, approach, acceptance criteria, and verification plan.
- Consolidate temporary checks, session-shaped work, and investigations without independent deliverables into the owning issue.
- Record decisions, implementation outcome, build/typecheck/runtime verification, screenshots/evidence, risks, and remaining work in Linear; keep file-level detail and full logs in the PR.
- Everyone except haipro and Jacky stops at `In Review`. An agent may set `Done` only after explicit issue-specific lead approval and must record the approver in a comment.
- Never infer approval from login identity, assignment, PR merge, CI, generated SubApp output, deployment, or verification. Automations must stop at `In Review` or make no status change.
- If Linear tools are unavailable, emit a Linear sync packet no later than `In Review` unless explicit lead approval already exists.
- Keep these repository-only Linear rules excluded from generated SubApps through `.taku-template.json`; put clean user-facing guidance under `.taku-template/payload/`.

Never paste secrets, tokens, private app data, generated auth state, or private logs into Linear.
