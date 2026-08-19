# `@taku/subapp-contract`

This package is the versioned boundary shared by the future Publisher conversion flow, `repo-to-stax-converter`, and Taku Desktop. It defines data only; it does not clone repositories, run untrusted code, call an Agent, package a SubApp, upload artifacts, or publish an App.

## Current product truth

- A conversion candidate is a canonical Next.js SubApp workspace, not an installable release.
- `taku.manifest.json` remains the existing runtime-only manifest. Migration provenance and conversion status belong in `.taku/migration.json`.
- The current Taku Desktop release protocol is **two archives**, `source.zip` and `build.zip`, plus the runtime and publish manifests. There is no existing `.takuapp` file consumed by Desktop, so this contract does not invent one.
- After registration, Taku receives `appId`, `versionNumber`, `sourceUrl`, `buildUrl`, and the runtime manifest. End users install through Taku; creators do not manually send users a downloaded package.
- Private assessment locators never enter a public release. The public release validator rejects local paths, credentials, token-like values, and private fields.

## Contracts

| Contract | Purpose | Privacy |
| --- | --- | --- |
| `taku.subapp-assessment.v1` | Freeze static analysis, route, third-party service mappings, eligibility, blockers, and the allowed next step before conversion | Local only |
| `taku.subapp-migration.v2` | Read the migration provenance already emitted by `repo-to-stax-converter` | Candidate workspace only |
| `taku.subapp-validation.v1` | Read the converter's `workspace`, `conversion`, and `publish` gate results | Local/evidence |
| `taku.manifest.json` | Declare runtime name, version, Actions, and optional LLM requirement | Public runtime metadata |
| `taku.subapp-release.v1` | Describe the registered `source.zip` + `build.zip` release Taku installs | Public |

`SUBAPP_CONTRACT_VERSION` versions this package. Existing converter-owned schema versions remain unchanged so phase two can adopt this package without rewriting existing candidate workspaces.

## Eligibility rule

Static framework detection is necessary but not sufficient:

- `subapp-migration` + `convertible` → `eligible` → conversion may start.
- `subapp-migration` + `manual-review` → `review-required` → an explicit review must pass first.
- Any normalized warning keeps the result at `review-required`, even if a caller claims it is eligible.
- A non-SubApp route or `not-recommended` → `rejected` → do not create a conversion workspace.
- A required service mapped to the Taku proxy catalog may proceed; a required mapping under review forces review; an unavailable required service rejects conversion.

Workflow/skill repositories route to native import. Browser extensions, external connectors, Python CLI projects, and unknown runtimes do not silently enter the SubApp converter.

Service mappings contain only semantic requirements plus `serviceId` and `endpointIds` from the `taku-ai-proxy-go` catalog. They never contain an upstream URL, provider credential, Host token, or environment value. Catalog discovery and freshness checks belong to the integration adapter, not this static package.

## Use

```ts
import {
  assertSubAppAssessment,
  assertSubAppMigrationRecord,
  assertSubAppRelease,
  createSubAppAssessment,
} from '@taku/subapp-contract';
```

Consumers must pin the exact package version and validate input at each process boundary. A successful `workspace` validation is not a converted candidate; a successful `conversion` validation is not publish authority; only an authenticated Taku-controlled publish admission may authorize a public release.
