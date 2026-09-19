---
name: taku-subapp-verification
description: Use before claiming a Taku App migration or feature is complete, and when deciding whether a workspace is ready to convert or publish.
---

# Taku App Verification

Report three separate gates. Passing an earlier gate never implies a later gate.

## 1. Workspace gate

- Required template runtime, bridge, manifest, lockfile, and Agent skills exist.
- When `runtimeCapabilities` is declared, `docs/subapp-agent-runtime.md` and `@/lib/taku-runtime` exist, the declaration contains only the exact protocol, operation ID, and revision used by the app, and the same operation is not duplicated as an Action or public Route Handler.
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
- Main success and failure paths, promised persistence, responsive layout, and host bridge behavior are exercised.
- For a Host Agent Runtime workflow, tests prove `capabilities()` is checked before `start()`, every start carries the exact authenticated `expectedRecoveryScope`, a changed scope is rejected before side effects, one idempotency key is retained per logical request, unknown start outcomes reuse that key, and subscription replay or gaps cannot create a duplicate run or false success. If the local fixture claims same-tab reload recovery, tests must additionally prove the SDK run journal is bound to the authenticated opaque `recoveryScope`, is written before start, discards another scope without interpreting its owner dimensions, exercises both the `runId`/get-only and no-`runId`/same-start branches, blocks automatic restart for expired/malformed/future/wrong-TTL/wrong-scope evidence, uses immutable entry generations so stale completion cannot bind or clear a newer request, validates terminal cursor monotonicity/coherence, distinguishes definitive rejection from unknown delivery, advances cursors and phases without regression, preserves the business outcome when journal storage fails, terminates waits on subscription errors, preserves detailed `run.error` after `run.state=failed`, and clears every terminal outcome. Do not promote this evidence into window/Desktop restart, cross-device, or production durability.
- Its UI visibly covers unavailable/not granted, running progress, success, failure/retry, and cancelling/cancelled. `result()` is read only after success, explicit cancellation calls `cancel(runId)`, and aborting a page wait is not presented as cancelling the run.
- Host Agent Runtime code uses only `@/lib/taku-runtime`; no Codex/Claude CLI details, model/provider selection, proxy URL, secret, control/session key, or generic tool configuration appears in app code, manifest, persisted state, runtime input, logs, or generated artifacts.

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

This Host Agent Runtime protocol is experimental and pre-release.

If the app declares `taku.agent.run/v2`, exercise capabilities, start, ordered subscription, restore/get, result, and explicit cancel against every real granted Host operation it uses. The SDK recognizes revision `1` of `agent.execute`, `research.generateReport`, `media.image.generate`, and `media.video.generate`, while the default manifest requests none. Media input must follow the authenticated catalog schema and defaults; verify that omitted optional fields remain absent on the SDK wire and that Proxy applies the advertised defaults (image `1:1`; video `16:9`, `4` seconds). Reject removed `provider`, `model`, `quality`, `profile`, batch `count`, and `aspectRatio: "auto"` inputs rather than relying on Host failure. Exercise negotiated large text through `content.read`; exercise image/video output as opaque `assetRef`, mint a fresh playback grant through `asset.open`, and verify byte ranges without persisting the short-lived URL. A core workflow cannot pass the publish gate or be described as production-ready until its exact Desktop Host capability and production grant are certified.

Unknown license, unresolved high-risk behavior, missing managed-service support, unported core runtime, manifest/registry drift, or missing build/runtime evidence means **not publishable**. State the blocker instead of weakening the gate.

When `.taku/migration.json` or a converter validation command is present, preserve its structured evidence and run `workspace`, `conversion`, and `publish` validation at the matching gate. Automated validation is evidence, not permission to ignore a failed manual host check.

Never execute repo-derived `test`, install, build, or runtime scripts on an unsandboxed host merely to satisfy the publish gate. Publish command execution requires a disposable Taku-managed sandbox with a minimal environment, restricted filesystem/network access, and provenance/runtime attestation supplied by the trusted runner rather than authored inside the workspace. If that runner is unavailable, report publish as blocked; workspace and conversion evidence may still be reported separately.
