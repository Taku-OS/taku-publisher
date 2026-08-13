# Passport P3 Core Boundary Evidence

> Date: 2026-07-24
> Owning issue: TAKU-211
> Status: local implementation verified; not pushed

## Outcome

P3 establishes `@taku/passport-core` as the canonical host-independent
TypeScript/ESM package. The migration moves:

- canonical capability Snapshot composition;
- public privacy filtering;
- inventory deduplication;
- public item projection;
- private locator inventory construction;
- Creator metrics normalization and merging;
- Persona signal composition from already-collected Host records;
- Persona four-axis scoring, traits, hidden candidates and rules merging;
- Persona override validation and public identity projection;
- final Usage summary composition with private workspace keys kept
  non-enumerable.

The existing `creator/scripts/ai-setup.mjs`, `privacy.mjs`,
`creator-metrics.mjs` and matching pure functions in `scan.mjs`,
`persona.mjs` and `usage.mjs` are compatibility wrappers around Passport
Core. `@taku/creator-core` is now a deprecated alias and no longer reaches
back into `creator/scripts`.

## Boundary

Passport Core accepts data and returns deterministic values. Runtime source is
tested to reject dependencies on:

- `creator/scripts`;
- Electron or Desktop code;
- Worker or Publisher network clients;
- filesystem, path or child-process APIs.

Host directory discovery, file previews, command execution, usage-log reading,
Persona rule-file loading, project metadata collection and Worker metric
retrieval remain in the Creator compatibility runtime. The Host passes those
records to `composePersonaSignals`; Core performs the deterministic
normalization and scoring. The remaining effects require P4 Host Adapter
extraction; moving them into the Core package would violate the target
architecture.

`generatedAt` can be injected into both signal composition and scoring. A
fixed compatibility fixture verifies that the legacy Host wrapper and direct
Core APIs produce the same canonical JSON and SHA-256 hash
`35d60b07b15ed1010595c1886c20df4a2b4e5828ab0f473f9cf9c87c50deed4c`.

## Distribution

Adapter builds include the compiled Contract and Passport Core workspace
packages under the generated runtime's local `node_modules/@taku` tree.
Normal plugin runtime does not access a package registry.

A standalone smoke test packs both workspace packages, installs them into a
temporary application and imports `@taku/passport-core` without repository
relative paths.

## Verification

- `npm run build:core`: passed; Contract and Passport Core TypeScript builds
  emit ESM plus declarations.
- Core/legacy directed Persona tests: 14/14 passed.
- Full Node suite: 64/64 passed.
- Full Python suite from a source snapshot without VCS metadata: 59/59
  passed.
- `npm run smoke:core`: passed; the packed Core and Contract installed into a
  standalone temporary application.
- `npm run build:adapters`: passed for Codex and Claude Code.
- Generated Codex runtime imported the embedded Core, built a canonical
  Snapshot and removed a private locator.
- `npm run smoke:contract`: passed; P2 Contract output and declarations remain
  compatible.
- `npm run audit:repo`: passed for 157 reviewed source files. The only literal
  allowlist entry is the existing explicitly public Supabase anon key.
- `npm run smoke:clean`: passed from `git archive HEAD`; the exported source
  independently installed dependencies, rebuilt both TypeScript packages,
  passed 64 Node tests and 59 Python tests, built both Adapters, passed both
  standalone package smokes and produced a source checksum.
- Final staged-file `.env`, credential-value and private-key audit: passed.

Running the Python repository-self-scan directly inside a Git worktree reports
the worktree control file `.git` as a local absolute path. This is expected
security behavior for an arbitrary text file, not a source finding. The same
59-test suite passes from the exported source shape used by distribution.
