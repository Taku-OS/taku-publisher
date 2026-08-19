# Security Model

## Trust boundary

The local host, Electron clients, and uploaded metadata are untrusted from the platform's perspective. Local scanning improves creator safety but never replaces Worker authentication, ownership checks, digest validation, ZIP safety, server-side rescanning, or review policy.

## Publisher Web authorization

- Standalone publishing uses a loopback callback with a random state value, an S256 PKCE challenge, and a one-time Worker authorization code.
- Taku Web sends the signed-in Supabase session only to a trusted Taku Worker. It never returns that session to the local Publisher or places it in a callback URL.
- The Worker exchanges the one-time code for an opaque, short-lived Publisher token stored server-side by hash. The grant contains only the verified user snapshot, intent, scopes, expiry, and remaining uses.
- `publish_tool` grants only Publisher draft writes. `publish_stax_card` grants only Creator profile read/create and card import. Ordinary account, billing, installation, and subscription routes continue to require a normal user session.
- Icon generation receives a separate ten-minute, limited-use token because that proxy path currently requires the upstream user session. The longer Publisher grant never stores the upstream access token.
- The standalone session is stored at `~/.taku/publisher/session.json` with owner-only permissions. Explicit CI credentials and the legacy Desktop session remain compatibility inputs, not requirements.

## Staging guarantees

- Copy only the explicitly selected unit.
- Exclude secret stores, `.env` values, caches, build output, VCS data, machine state, symlinks, and non-regular files.
- Enforce 1,000 files, 5 MiB per file, and 25 MiB total for the MVP.
- Record every exclusion by relative path and reason.
- Make staging owner-readable and recheck its per-file SHA-256 manifest before every downstream phase.
- Require a new draft when source changes. Do not mutate a confirmed staging tree.

## Deterministic scan

Block on evidence that is safe to classify mechanically:

- Known provider/token formats
- Literal credential assignments with non-placeholder values
- Private key blocks and Bearer values
- Database URLs with embedded passwords
- Machine-specific absolute paths and `file://` URLs
- Loopback, LAN, link-local, `.local`, or `.internal` URLs
- Unsafe paths, symlinks, reserved package paths, count/size violations, or changed digests

Generate review findings for shell/process execution, downloaded-code execution, dynamic evaluation, network access, broad filesystem access, and broad permission declarations.

Reports contain relative paths, line numbers, categories, and redacted excerpts. Never preserve the matched credential value.

## Mandatory deep scan

The host must review every text file listed by `deep-scan-request.json`, not just regex findings. Inspect:

1. Values with innocent names that authorize a service or privileged action.
2. Data flow from user input, files, environment, or secrets to network/process/log outputs.
3. Command construction, shell interpolation, dynamic code, and downloaded execution.
4. Filesystem scope, persistence, startup hooks, destructive behavior, and privilege changes.
5. Network endpoint ownership, dynamic destinations, telemetry, and undeclared exfiltration.
6. Manifest permissions and whether declared scope is least privilege.
7. Environment/config reads missing from `requirements.json`.
8. Plugin child capabilities that differ materially from the plugin listing.

The script never calls an LLM. Codex or Claude performs this local semantic review and writes a dispositions file.

## Dispositions schema

```json
{
  "schema_version": "taku.publisher.v1",
  "stage_sha256": "<exact staging digest>",
  "full_review_completed": true,
  "dispositions": [
    {
      "finding_id": "finding_...",
      "decision": "allow",
      "rationale": "Fixed endpoint receives only the user's requested input."
    }
  ],
  "additional_findings": [
    {
      "category": "semantic_secret",
      "path": "src/config.py",
      "line": 24,
      "message": "An innocently named value is used as an authorization credential.",
      "decision": "block",
      "rationale": "The literal authorizes a privileged remote API and must be removed and rotated."
    }
  ],
  "requirement_updates": [
    {
      "name": "INTERNAL_GATE",
      "kind": "secret",
      "required": true,
      "purpose": "Authorizes requests to the creator's configured service.",
      "sources": [{"path": "src/config.py", "line": 24}]
    }
  ]
}
```

Allowed decisions are `allow`, `block`, and `not_applicable`. Every generated finding requires a meaningful rationale. `full_review_completed` must be true even when the rule scan produced no review findings, because semantic misses are the reason for the deep pass.

Any `block` prevents packaging. A dispositions file containing a credential value is rejected.

Use `requirement_updates` when semantic review finds an undeclared variable or needs to improve an inferred purpose/type. Only uppercase names, `secret|env`, required status, purpose, and staged relative source evidence are accepted. `value` and `default` fields are rejected.

## Configuration requirements

Extract environment references such as `process.env`, `import.meta.env`, `os.environ`, `os.getenv`, `getenv`, Ruby `ENV`, Go `os.Getenv`, and explicit required-env helpers.

Store only:

- Variable name
- `secret` or `env` classification
- Required/optional inference
- Human-readable purpose
- Relative source evidence

The installer collects actual values outside chat and stores them in the OS keychain or Taku encrypted secret store. Runtime injection must be scoped to user, marketplace item, and requirement name.

## Codex Marketplace Skill Installation

- Public search and item-detail reads carry no Taku authorization header.
- Package access and install recording use a dedicated short-lived
  `marketplace_install` grant; Creator Center and publisher write scopes are not
  requested.
- Selection and installation are separate actions. The mutation command must
  repeat the exact server item ID as `--confirm-item-id`.
- Package bytes are downloaded without bearer/cookie forwarding and are limited
  before extraction.
- Installation verifies the server SHA-256 and declared package size, rejects
  absolute/parent/backslash paths, duplicate case-folded paths, symbolic links,
  special files, excessive entries, excessive expanded bytes, and archives
  without a root `SKILL.md`.
- Extraction occurs in a sibling temporary directory followed by one atomic
  rename. An existing `~/.codex/skills/<slug>` is never merged or overwritten.
- Configuration requirement names and purposes may be shown in chat. Secret
  values must never be requested, logged, embedded in command arguments, or
  written into the installed package by this flow.
