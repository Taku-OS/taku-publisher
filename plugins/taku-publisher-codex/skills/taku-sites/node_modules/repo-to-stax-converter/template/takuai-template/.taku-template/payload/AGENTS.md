# Taku App Agent Rules

## Scope

- This repository is an independent Taku App created by Taku.
- Use “Taku App” in product UI and explanations. Existing `subapp` paths, Skill IDs, and Host identifiers remain compatibility names; do not rename them to change the product label.
- Follow the app-local `CLAUDE.md` for its runtime contract, commands, and implementation conventions.
- Keep changes scoped to the requested product outcome and preserve existing behavior outside that scope.

## Development Workflow

- Use Node.js 20 and the `packageManager` version declared in `package.json`.
- Read `taku.manifest.json`, `package.json`, and the relevant source files before editing.
- Read `.agents/skills/using-superpowers/SKILL.md`, then use the matching Taku and Superpowers skills for non-trivial work.
- Prefer the existing Next.js, React, TypeScript, Tailwind CSS, Radix UI, and Lucide patterns already present in the app.
- Do not assume a component or dependency exists; verify it before importing.
- Run focused checks while developing and run `pnpm run type-check` plus the relevant build or lint command before handoff.

## Runtime Contract

- Preserve `src/__taku/`, the host bridge mounted by `src/app/layout.tsx`, and the application contract in `taku.manifest.json`.
- Register callable app actions through the existing `src/actions/` registry and keep action schemas explicit.
- The manifest is the sole Host Action catalog. Invoke declared Actions only through the fail-closed Host RPC; do not create a public Action catalog or executor.
- Treat `src/actions/index.ts` as a registration root, not application bootstrap. The RPC route must load it with `await import` only after the configured control token exists and the request header passes timing-safe validation, and before any registry lookup or execution.
- Keep Action module top levels registration-only. Database, network, filesystem, process, and other business effects belong inside the handler or its server-only domain operation, so unauthenticated route imports and requests have no Action-loading side effects.
- TAKU_CONTROL_TOKEN is only a local Host transport capability. The control token is not user identity, app ownership, entitlement, or billing authority.
- Without a real, versioned Taku-controlled server authority contract, managed/external writes and every browser mutation remain visibly blocked. A Server Action or server-only helper is not an authentication boundary.
- Do not expose public Action/AI gateways or generic proxy, collection, upload, filesystem, shell, or tool routes. Never place provider credentials in browser code or generated files.
- `src/lib/taku-runtime` is an experimental, pre-release Host Agent Runtime SDK, not a provider SDK or public AI endpoint. Follow `docs/subapp-agent-runtime.md`, keep the default manifest unprivileged, and never treat a manifest declaration as a Host grant. It recognizes generic agent, report, text-to-image, and text-to-video operations; inspect the authenticated Host catalog instead of hard-coding providers/models. Do not send removed media inputs such as `provider`, `model`, `quality`, `profile`, batch `count`, or `aspectRatio: "auto"`; send only the common intent fields and let Taku Proxy select and recover the provider route. Large text uses negotiated `contentRef`; media uses opaque `assetRef` plus a fresh short-lived `asset.open` playback grant. Do not persist playback URLs or advertise reserved multimodal capabilities the Host did not grant.
- Keep user-visible failures clear and recoverable; do not silently replace real service failures with fabricated data.

## Interface Quality

- Build the usable product experience as the first screen instead of adding a marketing landing page.
- Reuse existing UI primitives and use Lucide icons for familiar actions.
- Add stable loading, empty, error, and disabled states where the workflow needs them.
- Keep layouts responsive and ensure text and controls do not overlap at narrow or wide sizes.
- Preserve meaningful `data-slot` attributes so Taku design mode can identify editable elements.

## Safety

- Never commit secrets, access tokens, cookies, private user data, local databases, build output, or runtime caches.
- Local files, terminal commands, and desktop-app control are valid Host Agent Runtime capabilities when the product needs them. Scope access to the files, folders, applications, and operations granted by the Host for the app and the current run; a user-selected location does not have to be inside the app workspace. Require an explicit user confirmation before a destructive or otherwise dangerous operation, and never pass Host long-lived credentials into the Taku App.

## Verification Gates

- **workspace** verifies the template runtime, provenance/credit when present, safe files, dependencies, and Agent handoff.
- **conversion** verifies the real product workflow, Action/manifest consistency, durable shared data, managed services, and failure behavior.
- **publish** adds production build, host/runtime smoke, license/risk review, and secret scanning.

Publish scripts from repo-derived workspaces must only run inside a disposable Taku-managed sandbox. The trusted runner, not the workspace, supplies provenance and runtime attestation; without both, publish remains blocked.

Read `.agents/skills/taku-subapp-verification/SKILL.md` before claiming completion. Report every gate separately; do not treat a successful build as publish approval.
