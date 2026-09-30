---
name: taku-sites
description: Use when a user wants to build or update a Taku Site on a taku.site subdomain. Excludes Marketplace Skills, SubApps, and Stax Cards.
---

# Build and publish a Taku Site

You build, run, and test the Site with your own tools. The bundled CLI only does what needs Taku: sign-in and identity, the live capability catalog, the browser SDK file, packaging and contract validation, subdomain availability, and publishing. It does not generate, host, or preview the Site.

Run every CLI command from **this Skill's directory**: `cd <directory-containing-this-SKILL.md> && node scripts/taku-publisher.mjs <command> --json ...`. Read the JSON `status`, `requires_action`, and `action_type`; exit code 0 alone does not mean success. Do not assume a global CLI or a Publisher checkout.

## Flow (in this order)

1. **Sign in first.** `sites-login --json`, let the user finish the browser step, then `auth-check --request-id <id> --json` until `authenticated`. Then `sites-whoami --json`. During internal testing only server-verified @taku.ai accounts can use Sites; if access is denied, stop and report it; do not work around it. Never ask for, print, or pass tokens; never call the Taku API yourself.
2. **Read the contract.** `sites-contract --json` returns the project format, artifact limits, and `capabilities`: the server's live catalog, passed through as is. The catalog decides what a Site may use. If the command fails because you are offline or signed out, fix that; do not guess from memory.
3. **Build the Site** in the user's project to match what they asked for. See [references/contract.md](references/contract.md) for the project layout, the manifest, the browser/Worker boundary, and security rules. See [references/capabilities.md](references/capabilities.md) for SDK calls, scopes, and credits. See [references/storage.md](references/storage.md) for data (personal records, anonymous submissions, favorites, SQL). For a new empty project, `sites-init --project <abs-dir> --json` writes a minimal starting point. Replace it with a real Site. Get the SDK with `sites-sdk-export --output <abs-project>/dist/assets/taku-sites-sdk.mjs --json`.
4. **Run and test it yourself**, using your normal dev server, tests, and browser. `/__taku/*` platform capabilities are not available outside Taku, so put them behind a stub. [references/testing.md](references/testing.md) covers what you can and cannot check locally. Tell the user which behaviors you only checked against stubs.
5. **Validate.** Run `sites-validate --project <abs-dir> --json`. Fix errors and rerun until it passes. This is a packaging and compatibility check. It is not an authorization check: the server re-checks the manifest, scopes, and capability availability at publish and at runtime.
6. **Ask the user for one exact subdomain.** A request to build a site does not choose a subdomain. Do not suggest or generate candidates. To update a Site they already own, use its `projectId` from `sites-list --json`.
7. **Check availability, then confirm.** Run `sites-publish --project <abs-dir> --slug <exact-subdomain> --json` (or `--project-id <owned-id>`). The CLI checks eligibility and availability. If `sites_slug_unavailable`, ask the user for another subdomain. Otherwise it returns `needs_input` with `confirm_target` (the exact hostname or projectId) and a build summary. Show both to the user.
8. **Publish only after the user explicitly confirms that exact target.** Rerun the same command with `--confirm-target <exact confirm_target>`.
9. **Report honestly.** A Site is live only when the result is `sites_published` with `ready: true`, or when `sites-status --project-id <id> --json` shows the release. `sites_publishing` means it is still pending. If the run is interrupted, rerun the same command; it resumes. `sites_build_changed` / `sites_target_changed` means files or the target changed after confirmation: review with the user, get a new confirmation, then use `--reset`. Report quota, ownership, expired-login, and platform errors exactly as returned.

## Session renewal and errors

New Site sessions renew automatically for a fixed 30 days. `auth-refresh --json` renews now; `auth-status --json` reports validity without exposing credentials. A lost refresh response is recovered by promptly repeating the original command (within 60s). `sites_login_required` requires `sites-login`; `publisher_refresh_unavailable` means renewal could not be confirmed, so retry the same command without discarding its publish checkpoint. Older sessions without refresh support need login again when expired.

Report `http_status`, `server_error`, `request_id` and the sanitized summary from API errors. A 404 needs an internal-eligibility/CLI-version check; do not claim either cause is confirmed. `auth-logout --json` clears local authorization and attempts server revocation; `remote_session_revoked: false` means revocation was not verified.
