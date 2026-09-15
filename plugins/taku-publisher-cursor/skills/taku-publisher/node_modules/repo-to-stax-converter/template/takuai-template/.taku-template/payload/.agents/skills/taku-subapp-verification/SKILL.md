---
name: taku-subapp-verification
description: Use before claiming a Taku SubApp migration or feature is complete, and when deciding whether a workspace is ready to convert or publish.
---

# Taku SubApp Verification

Report three separate gates. Passing an earlier gate never implies a later gate.

## 1. Workspace gate

- Required template runtime, bridge, manifest, lockfile, and Agent skills exist.
- Upstream attribution and migration provenance exist when this is a converted app.
- No template demo page/actions, unresolved symlink/submodule, `.env`, token, cookie, local database, upload-produced data file, build output, or cache is part of the deliverable. This does not prohibit an implemented upload feature.
- `pnpm install --frozen-lockfile` succeeds with Node.js 20.

## 2. Conversion gate

- Core upstream workflow is behaviorally represented; capability gaps are explicit blockers.
- Manifest Actions match registered definitions and handlers.
- Action, API, and UI use the same durable data source.
- The control token is a local Host transport capability, not user identity, app ownership, entitlement, or billing authority. Missing and wrong tokens fail closed.
- Managed services, uploads, shared resources, and external writes require a real versioned Taku-controlled server authority contract; without it the capability remains visibly blocked.
- Browser mutation remains blocked until that server authority authenticates and authorizes the narrow operation. `Server Action`, `server-only`, environment values, and client IDs do not establish authority.
- Do not ship public Action/AI gateways or generic proxy, collection, upload, filesystem, shell, or tool routes. Credentials must not be placed in app `.env` files or test fixtures.
- Main success and failure paths, reload persistence, responsive layout, and host bridge behavior are exercised.

## 3. Publish gate

Run fresh commands and inspect their exit codes:

```bash
pnpm test
pnpm run check:slots
pnpm run type-check
pnpm run ci:check
TAKU_RUNTIME_KIND=preview pnpm run build
```

Then smoke-test preview/edit startup, manifest serving, each manifest Action through the fail-closed Host RPC, and each authorized managed service in a real Taku Host. Treat unavailable server authority and missing Host/browser certification as explicit blockers. Scan source, tracked files, build output, and logs for secrets.

Unknown license, unresolved high-risk behavior, missing managed-service support, unported core runtime, manifest/registry drift, or missing build/runtime evidence means **not publishable**. State the blocker instead of weakening the gate.

When `.taku/migration.json` or a converter validation command is present, preserve its structured evidence and run `workspace`, `conversion`, and `publish` validation at the matching gate. Automated validation is evidence, not permission to ignore a failed manual host check.

Never execute repo-derived `test`, install, build, or runtime scripts on an unsandboxed host merely to satisfy the publish gate. Publish command execution requires a disposable Taku-managed sandbox with a minimal environment, restricted filesystem/network access, and provenance/runtime attestation supplied by the trusted runner rather than authored inside the workspace. If that runner is unavailable, report publish as blocked; workspace and conversion evidence may still be reported separately.
