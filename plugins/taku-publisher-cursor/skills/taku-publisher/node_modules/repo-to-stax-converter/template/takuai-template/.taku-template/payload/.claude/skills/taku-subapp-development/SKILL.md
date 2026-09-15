---
name: taku-subapp-development
description: Use when building or migrating a Taku SubApp, especially when translating an existing web or Python-backed app into the canonical Next.js runtime.
---

# Taku SubApp Development

## Start from the runtime contract

Read `taku.manifest.json`, `package.json`, `CLAUDE.md`, `src/app/layout.tsx`, and the relevant source before editing. Preserve `src/__taku/`, the host bridge, preview/edit scripts, manifest serving, and existing proxy rewrites.

Use Node.js 20 and the package manager version declared in `package.json`. A SubApp is one canonical Next.js runtime unless a versioned Taku Host/template contract already implements and documents another runtime. Editing the app's manifest or docs cannot authorize a sidecar that the Host does not support.

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

When managed authority is blocked, keep the managed operation visibly blocked and implement the maximum safe local read-only preparation, analysis, or exportable artifact that preserves product value. A catalog of disabled controls is not a workflow. Never fake managed output. The local artifact must derive only from user-provided or already-authorized local data and be labeled as preparation or analysis, never as the managed operation's result.

Before coding, name one primary safe workflow from the capability matrix and make the page use the same domain code that its executable product test exercises.

A blocked, readiness, status-only, or capability-reporting Action does not satisfy the core workflow smoke gate.

When browser smoke cannot run, extract the primary local workflow's domain transformation or state transition, cover successful and rejected inputs in an executable test, and leave browser behavior explicitly unverified.

An `upstream-source/` snapshot may remain as migration reference only when it is excluded from build/runtime/typecheck, never executed, and tied to source provenance. It is not a supported second runtime.

## Services, uploads, and data

- Read `.taku/context/service-api/<serviceId>/endpoints.json` before considering a managed service. Do not guess paths or schemas, and do not treat a discovered endpoint as authorization to call it.
- A server-only helper or Host-injected token is not request authorization. Without a versioned Taku-controlled server authority contract that validates identity, ownership, operation scope, entitlement, quota, and replay, keep the capability visibly blocked.
- Do not ship `/api/actions`, `/api/actions/<name>`, `/api/ai/completion`, or `/api/ai/image/generate`. Do not recreate a generic proxy, collection, upload, filesystem, shell, or tool route.
- Only after the authority contract exists, validate upload MIME type, size, filename, ownership, and failure behavior at the narrow domain-specific Route Handler boundary. Store URLs and business metadata rather than blobs in generic JSON records. Do not use the SubApp filesystem as production business-file persistence.
- Each domain mutation has one server-only operation for validation and durable work. The Host Action calls it through fail-closed `/__taku/rpc`. An authorized domain-specific Route Handler calls the same server-only operation as the Action handler only when the real server authority exists; otherwise browser mutation remains blocked. Do not expose a generic collection HTTP endpoint or let clients write raw records.
- Never put provider keys in client code, `.env`, generated files, local storage, URLs, logs, or responses. `TAKU_CONTROL_TOKEN` is only a local transport capability, never user or billing authority.
- Do not expose filesystem or shell tool execution through a public or unauthenticated route. Any explicit product requirement for that authority needs a host-authenticated, authorized contract and a process-level sandbox covering filesystem, environment, processes, and network; prompts and blacklists do not qualify.

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
