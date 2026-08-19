---
name: taku-action-contract
description: Use when adding, changing, removing, or validating host-callable Taku SubApp Actions and their shared UI data.
---

# Taku Action Contract

An Action is complete only when its declaration, registration, execution, persistence, and UI-visible result agree.

## Implement one Action

1. Read `docs/subapp-action-architecture.md`, `src/lib/actions/types.ts`, and the existing `src/actions/` registry.
2. Pass a recursively static object literal directly as the first argument to `registerAction`; validate inputs in the handler. There are no spreads, imported constants, computed values, or helper calls anywhere in that definition. Arrays such as `enum` must list their literal values directly. Runtime handler code may reuse constants after the definition.
3. Add the typed handler under `src/actions/`.
4. Import the module from `src/actions/index.ts` so registration occurs at runtime. Keep the module top level registration-only: it may declare and register the definition and handler, but database, network, filesystem, process, and other business effects must run inside the handler or its server-only domain operation.
5. Add the same name, description, parameter semantics, and return semantics to `taku.manifest.json`.
6. If the Action changes user-visible data, write the same SQLite/Drizzle or `taku-data` store that the UI reads.
7. For every public Action, add a contract test that executes the real handler and asserts the actual returned `data` shape, including nesting, agrees with the registration definition and manifest semantics. In the test, import `@/actions/index` before reading the real registry; do not rely on an ambiguous directory import or a hand-built adapter. Exercise success, missing/invalid input, business failure, upstream failure, and persistence after restart.

`src/actions/index.ts` is the registration root, not application bootstrap. The Host RPC route must not statically side-effect import it at module top level. Only after `TAKU_CONTROL_TOKEN` exists and the request header passes genuine `node:crypto` `timingSafeEqual` validation may the POST handler `await import('@/actions/index')`; that import must happen before any `hasAction` or `executeAction`. RPC tests must prove that importing the route, omitting the token, and presenting the wrong token leave business Actions unloaded.

## One domain mutation

For each domain mutation, create one server-only operation that owns input validation and the durable write. The Action handler calls that operation through the fail-closed Host RPC gateway. Only when a versioned Taku-controlled server authority contract actually exists may a domain-specific Route Handler call the same server-only operation; when allowed, the Route Handler and Action handler call the same operation. Without that authority the browser mutation stays blocked. A generic collection store is persistence plumbing, not an authorization or domain-validation boundary. Do not expose a generic collection HTTP endpoint or permit direct client collection writes.

Do not ship `/api/actions`, `/api/actions/<name>`, `/api/ai/completion`, or `/api/ai/image/generate`. They turn the SubApp server into an unauthenticated executor or credentialed service proxy. `TAKU_CONTROL_TOKEN` protects only the local Host-to-runtime transport and is never proof of user identity, ownership, entitlement, or billing authority. Managed service and external writes remain blocked until a Taku-controlled server can authorize the narrow product operation from server-side facts.

Do not expose filesystem or shell tool execution through a public or unauthenticated route. If a product explicitly requires such authority, stop and require a host-authenticated, authorized contract plus a process-level sandbox for filesystem, environment, process, and network access; prompts and command blacklists are not security boundaries.

## Consistency gate

- No manifest-only Action.
- No registered public Action missing from the manifest.
- No leftover template/demo Action. In the canonical template, public Actions originating only from `src/actions/example.ts` and manifest entries such as `greet` or `getStatus` are demos until deliberately replaced by a real product contract and tests; renaming them is not replacement.
- No success response before durable work succeeds.
- No secret, token, provider credential, or raw private payload in results or logs.

For app-local tests, import `@/actions/index`, inspect the real registry, and execute the registered handler through the registry API. For Host integration, use only the documented `/__taku/rpc` harness with its injected control token; never print, copy, or expose that token and do not invent a new bridge.
