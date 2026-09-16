---
name: taku-subapp-development
description: Use when building or migrating a Taku App, especially when translating an existing web or Python-backed app into the canonical Next.js runtime.
---

# Taku App Development

## Start from the runtime contract

Read `taku.manifest.json`, `package.json`, `CLAUDE.md`, `src/app/layout.tsx`, and the relevant source before editing. Preserve `src/__taku/`, the host bridge, preview/edit scripts, manifest serving, and existing proxy rewrites.

Use Node.js 20 and the package manager version declared in `package.json`. A Taku App is one canonical Next.js runtime unless a versioned Taku Host/template contract already implements and documents another runtime. Editing the app's manifest or docs cannot authorize a sidecar that the Host does not support.

## When migrating an upstream app

Write a capability matrix before implementation:

| Upstream capability | Taku target | Decision |
| --- | --- | --- |
| UI and interaction | `src/app/` and `src/components/` | port or preserve |
| HTTP/backend logic | authorized narrow Route Handler plus server-only module | rewrite or block |
| durable user state | Drizzle/SQLite or existing `taku-data` | migrate |
| host-callable operation | `src/actions/` plus manifest | expose as Action |
| Python-only or daemon behavior | no implicit sidecar | replace or block |
| third-party credential | Taku-managed proxy/service | never copy the key |

Treat unresolved core behavior as a publish blocker. Only the user can approve removing a capability from migration scope; an Agent cannot reclassify a hard capability as non-core to pass a gate. Do not silently replace live behavior with fake data or a deterministic demo.

When managed authority is blocked, keep the managed operation visibly blocked and implement the maximum safe local read-only preparation, analysis, or exportable artifact that preserves product value. A catalog of disabled controls is not a workflow. Never fake managed output. The local artifact must derive only from user-provided or already-authorized local data and be labeled as preparation or analysis, never as the managed operation's result. Keep only that managed or external operation blocked rather than downgrading the whole Taku App to a tool-free or read-only experience: a separate Host-authorized local workflow may read or write granted files, run terminal commands, and open or operate granted desktop applications, and its result must accurately describe what actually ran.

Before coding, name one primary safe workflow from the capability matrix and make the page use the same domain code that its executable product test exercises.

A blocked, readiness, status-only, or capability-reporting Action does not satisfy the core workflow smoke gate.

When browser smoke cannot run, extract the primary local workflow's domain transformation or state transition, cover successful and rejected inputs in an executable test, and leave browser behavior explicitly unverified.

An `upstream-source/` snapshot may remain as migration reference only when it is excluded from build/runtime/typecheck, never executed, and tied to source provenance. It is not a supported second runtime.

## Services, uploads, and data

- Read `.taku/context/service-api/<serviceId>/endpoints.json` before considering a managed service. Do not guess paths or schemas, and do not treat a discovered endpoint as authorization to call it.
- A server-only helper or Host-injected token is not request authorization. Without a versioned Taku-controlled server authority contract that validates identity, ownership, operation scope, entitlement, quota, and replay, keep the capability visibly blocked.
- Do not ship `/api/actions`, `/api/actions/<name>`, `/api/ai/completion`, or `/api/ai/image/generate`. Do not recreate a generic proxy, collection, upload, filesystem, shell, or tool route.
- Only after the authority contract exists, validate upload MIME type, size, filename, ownership, and failure behavior at the narrow domain-specific Route Handler boundary. Store URLs and business metadata rather than blobs in generic JSON records. Do not use the Taku App filesystem as production business-file persistence.
- Each domain mutation has one server-only operation for validation and durable work. The Host Action calls it through fail-closed `/__taku/rpc`. An authorized domain-specific Route Handler calls the same server-only operation as the Action handler only when the real server authority exists; otherwise browser mutation remains blocked. Do not expose a generic collection HTTP endpoint or let clients write raw records.
- Never put provider keys in client code, `.env`, generated files, local storage, URLs, logs, or responses. `TAKU_CONTROL_TOKEN` is only a local transport capability, never user or billing authority.
- Do not expose filesystem or shell tool execution through a public or unauthenticated route. Any explicit product requirement for that authority must use the Host Agent Runtime and needs a host-authenticated, authorized contract plus a process-level sandbox covering filesystem, environment, processes, and network; prompts and command blacklists do not qualify. The Host grants terminal, desktop-app, and other negotiated tools per app and re-authorizes them for the current run, scopes them to the approved files, folders, applications, and operations, and asks for explicit confirmation before destructive or otherwise dangerous work. Do not impose the app workspace as a universal boundary when the user has selected and the Host has granted another local resource.

## Host Agent Runtime

Read `docs/subapp-agent-runtime.md` before using the Host Agent Runtime. It is a separate Host capability, not an ordinary Action, public API, or way to add an AI backend to the Taku App. Do not register its operations under `actions`, wrap its methods in a Route Handler, or recreate its transport outside `@/lib/taku-runtime`.

Keep `runtimeCapabilities` absent unless the product workflow actually needs a Host operation. When it does, declare only the exact protocol, operation ID, and revision the app calls. The SDK recognizes revision `1` of `agent.execute`, `research.generateReport`, `media.image.generate`, and `media.video.generate`; the default manifest requests none, and a declaration is never a grant. The protocol is experimental and pre-release, so do not describe a fixture or an unverified Host capability as production AI.

Treat `capabilities().features` as a negotiated intersection. Unknown optional client features must not break hello; require `content-ref-v1`, `operation-catalog-v1`, or `asset-open-v1` only at the call site that needs it. Use the authenticated operation catalog and its JSON Schema/defaults for the common media fields; never hard-code or offer provider, model, quality tier, or provider-specific controls. The current product defaults are image `aspectRatio: "1:1"` and video `aspectRatio: "16:9"` with `durationSeconds: 4`; `start()` does not inject them, so omission stays omission and Taku Proxy applies the advertised defaults. Do not send removed v1 inputs such as `quality`, `profile`, batch `count`, or `aspectRatio: "auto"`; Taku Proxy owns model selection and fallback. The currently described media workflows are text-to-image and text-to-video only; image-to-video, first/last-frame video, audio, 3D, and other reserved capabilities must stay hidden unless a future Host catalog explicitly advertises them.

Keep engine and tool implementation details on the Host side so Desktop can update Codex, Claude, bridges, and model routing without requiring every Taku App to update. The Taku App sends product-level task input plus any operation-scoped capability request or Host-issued resource handle defined by the versioned contract. `capabilities()` represents what this app may request; `start()` must still be authorized for the current run. A grant for one app or run must not be reused by another. Routine authorized work can proceed within that grant, while destructive, irreversible, privileged, or unexpectedly broad work must pause for explicit user confirmation. Host model keys, proxy credentials, service tokens, and other long-lived secrets never enter the Taku App or runtime wire.

Use the exported client from `@/lib/taku-runtime`. Call `capabilities()` first and require an exact operation/revision grant before `start()`. Treat its authenticated `recoveryScope` as an opaque Host-owned recovery boundary; never derive or interpret one from an email, user ID, token, release, runtime kind, or other app-controlled value. Every `start()` must send that exact value as `expectedRecoveryScope`; a Host scope change must fail before any run or runner side effect. Create one idempotency key per logical request, keep it with that request for the current view, and reuse it whenever a start outcome is unknown. Keep the returned `runId` and latest cursor as product state. Use `subscribe()` for ordered progress, `get()` to restore a retained run, `result()` only after success, and `cancel(runId)` for an explicit user cancellation; aborting a page wait does not cancel a Host run.

If the local-fixture workflow promises recovery after a same-tab reload, use `createTakuAgentRunJournal({ recoveryScope: capabilities.recoveryScope })` plus `recoverOrStartTakuAgentRun()` from the SDK instead of hand-writing storage or open-coding recovery. The versioned, TTL-bounded `sessionStorage` ledger is written before start and every mutation carries its immutable `entryId`. A valid matching entry with `runId` is reconciled only through `get(runId)`; one without `runId` retries the original normalized input and idempotency key. Invalid, expired, future-dated, wrong-TTL, or wrong-scope evidence must block automatic restart and wait for an explicit user choice to start over. Scope changes discard the old entry without interpreting why it changed. Non-terminal cursors advance monotonically; coherent `succeeded`, `failed`, and `cancelled` cursors clear only their captured entry. Definitive request rejection may clear that entry, while unknown-delivery errors retain its identity. Journal update/cleanup failures are secondary recovery warnings: they must not block or replace the actual run result/error, and a subscription error must end the current UI wait. In particular, do not settle a generic failure on `run.state=failed` before the following detailed `run.error`; reconcile the latest snapshot as a fallback. This journal is not durable business data and does not promise recovery across a window/Desktop restart, another device, or production. Longer-lived recovery requires an already-authorized durable app store and remains a publish blocker until that contract exists.

The product UI must represent unavailable/not granted, running progress, success, failure with a recoverable retry path, and cancelling/cancelled states. Restore only runs for which the app retained a trustworthy journal; do not turn a page reload, subscription gap, or transport timeout into a duplicate job or fabricated success. For large text, use `readContent()` or `readContentText()` and verify the complete reference rather than truncating it. Media results contain only opaque `assetRef` descriptors; call `openAsset(assetRef)` for a fresh short-lived range-capable playback grant, never persist or share `playbackUrl`, and call again after expiry. Never place Codex or Claude CLI details or executable details, Host model/provider configuration, proxy URLs, provider URLs or paths, long-lived credentials, or control/session keys in the Taku App, manifest, persisted business state, runtime input, or logs. Versioned operation input may include product intent, requested capability categories, and opaque Host-issued resource handles; it must not smuggle raw Host configuration or credentials.

## Product UI

Build the usable workflow on the first screen. Reuse real local primitives, use static and unique semantic `data-slot` values, and cover loading, empty, error, retry, disabled, narrow, and wide states. Every `data-slot` must be a quoted static string literal; never use a variable, template expression, conditional expression, or spread.

For every supported transformation, preserve information without loss in a round-trip or reject unsupported input before mutation. Add a focused round-trip contract test for the accepted and rejected paths; do not hide loss behind a best-effort rewrite.

For structured text, enumerate each accepted token boundary, including delimiters, quote and escape rules, statement separators, comment tokens, and their cross-boundary combinations. Build the positive contract matrix from those boundaries, then run parse → serialize → parse for every cell and assert that the two parsed values are deeply equivalent; isolated token fixtures or parse success alone are insufficient. If the grammar has no symmetric escape for an accepted value, reject that value before any mutation instead of accepting input that the serializer cannot represent.

Treat empty strings, whitespace-only values, and leading or trailing whitespace as distinct cells rather than defaults. Include structural tokens inside quoted fields, compact forms without separator whitespace, and every accepted operator variant. A parser that accepts a value must either round-trip that exact semantic value through the serializer or reject it before persistence.

Diagnostics for malformed, unparsed, ignored, or only partially modeled business input are not a persistable success. Only explicitly classified metadata warnings that preserve semantics across every relevant representation and consumer may continue. For every mutation that accepts a transformation result, rejection-path tests must assert that its durable writer or side-effect boundary was never called.

Custom pointer interaction must have an equivalent keyboard path, logical focus behavior, and announced state. Relationship IDs must come from React `useId()` values for label, ARIA, and SVG definition/reference pairs; never use static string literals, random values, data-derived values, or indexes for those relationships.

Dynamic read-only visualizations do not need fake interactive controls, but they must provide an equivalent textual summary and announce meaningful updates when no triggering control already announces the change. Render a live computed status or result with semantic `<output>` when it is the result of user input.

Model asynchronous UI work as an explicit consistency contract. Replacing a dirty draft requires confirmation, and the latest request wins for every independently refreshed resource. A stale success or failure must not overwrite data or attach an error to the current screen after selection changes. Reconcile save acknowledgements by advancing the persisted baseline while preserving edits typed after the request began; cover out-of-order promises in executable tests.

For any feature with bounded interactive capacity, enforce shared domain limits before persistence and rendering, and reuse the same constants in UI controls. Exercise maximum-size inputs at the accepted and rejected boundaries. For a graph or spatial renderer, when the domain supports cycles or self-references, exercise them and assert that every rendered node and edge stays within computed layout bounds.

For parsers that expand fan-out or cross-products, calculate the expansion before allocation and enforce independent node and edge budgets derived from domain limits, not only the raw input length. Reject over-budget input with diagnostics before constructing intermediate strings, arrays, nodes, or edges, and cover adversarial cross-products at both sides of the boundary.

## Source review when tools cannot run

When the shell is unavailable, perform a no-shell Biome self-review of formatting, imports, `import type`, unused symbols, and stable React/ARIA/SVG ID pairs. Complete a manual import order and formatting audit before handoff. Do not add suppressions to evade review, and do not claim Biome ran without fresh command evidence.

An unexecuted test is not coverage. If its intended behavior is cited, trace its critical assertions to the implementation, mark it unexecuted, and do not pass any behavior claim or verification gate that depends on executing it.

Without executable tests, do not claim a spatial or algorithmic bug is fixed from inspection alone. Manually calculate at least one non-square counterexample for every axis or direction and one cyclic or self-referential case, while keeping the gate unpassed until execution.

Finish with the gates in `taku-subapp-verification`.
