# Taku Passport Security

## Trust boundary

Taku Passport runs on user-controlled machines and is therefore an untrusted client. Local files, environment variables, host state, package metadata, logs, and client-provided IDs are never proof of identity, ownership, entitlement, credits, publication state, or trusted usage.

Taku Worker must authenticate and authorize every privileged operation. Official service credentials and server-side secrets must never be stored in this repository, a host plugin, a CLI bundle, a generated Adapter, or Taku Desktop.

## Repository rules

- Never commit `.env*`, sessions, tokens, cookies, private keys, service-role keys, provider credentials, signed URLs, database URLs containing passwords, or local publish drafts.
- Public or publishable client configuration must be explicitly documented as public and reviewed by business purpose, not accepted only because of its variable name.
- Run `npm run audit:repo` before committing and repeat semantic review before every push.
- Generated `dist/` artifacts are derived and must be rebuilt from a reviewed commit.
- Generated Codex and Claude Code plugins are Node.js-only and must not contain
  Python files, development tests, TypeScript sources, source maps, or repository
  build utilities. Verify this boundary with `npm run smoke:plugin`.
- Security checks must not print candidate secret values.

## Reporting

Report suspected vulnerabilities privately to the Taku maintainers. Do not include real credentials, raw sessions, private source archives, or user data in a public issue. Revoke and rotate any credential that may have been exposed before continuing delivery.
