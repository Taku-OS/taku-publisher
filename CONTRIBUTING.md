# Contributing to Taku Passport

## Delivery boundary

Every non-trivial change needs one primary Taku Linear issue. Keep compatibility migrations, protocol changes, and product behavior in separate reviewable deliveries.

Use an issue-bearing branch name and Conventional Commits. Pull requests must start with the uppercase issue ID and include `References TAKU-123`; do not use automatic completion keywords for Linear issues.

## Required checks

```bash
npm ci
npm run audit:repo
npm test
npm run build:adapters
npm run smoke:plugin
npm run checksum:source
```

Run `npm run smoke:clean` before handing off repository, build, or packaging changes.

## Source and generated files

- Commit source, tests, manifests, documentation, and the npm lockfile.
- Do not commit `dist/`, dependencies, caches, environment files, local Taku state, session files, archives, logs, or credentials.
- Do not edit generated Adapter output. Change the canonical source and rebuild it.
- Keep `creator/` and `scripts/taku_publisher/` compatible until their replacement is separately reviewed.

## Security

Treat local paths, sessions, raw usage, prompts, source content, environment values, and credentials as private. Worker responses remain authoritative for identity, ownership, permissions, publication, installs, and trusted statistics.

Read [SECURITY.md](SECURITY.md) before changing authentication, packaging, scanning, upload, or installation behavior.
