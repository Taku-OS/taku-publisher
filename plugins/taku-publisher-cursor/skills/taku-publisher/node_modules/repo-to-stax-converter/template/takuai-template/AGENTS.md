# Taku SubApp Template Agent Rules

## Ownership

- This repository belongs to the Linear project `Taku Desktop`.
- Project lead: haipro.
- The canonical SubApp template and its runtime/build contract are Desktop-owned; do not create a separate template Linear project.

## Linear Workflow

- Team: `Taku` / key `TAKU`.
- New work starts in `Backlog`.
- Read a referenced TAKU issue before editing.
- Keep branch and PR titles tied to the issue ID when one exists.
- Record implementation, decisions, verification, screenshots/evidence, risks, and remaining work in Linear before handoff.
- Complete and verified work stops at `In Review` for haipro's review by default. Only `haipro` or `Jacky` may explicitly approve `Done` for a specific issue.
- Agents may set `Done` only after explicit issue-specific lead approval and must record the approver in a comment. Never infer approval from login identity, assignment, PR merge, CI, packaging, deployment, or verification.

## Repository Rules

- Follow `CLAUDE.md` for template architecture and UI conventions.
- Verify relevant changes with the repository's release check, typecheck, lint, and build.
- Keep repository-only agent and Linear files excluded through `.taku-template.json`; generated-app guidance belongs under `.taku-template/payload/`.
- Treat `src/actions/index.ts` as a registration root that the Host RPC loads only after control authentication succeeds; never statically import it from the RPC route module. Keep Action module top levels registration-only and run database, network, filesystem, or other business effects inside the handler or its server-only domain operation.
- Never put LLM API keys or other secrets in generated SubApps; use Taku-managed service/proxy paths.
