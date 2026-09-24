---
name: taku-sites
description: Build or update a real Taku Site from a user's requirements with the current Agent, using the bundled Publisher CLI for the Sites contract, local validation and preview, and user-confirmed publishing. Use for Taku Sites website requests, not Marketplace Skills, SubApps, or Stax Cards.
---

# Build a Taku Site

You are the site developer. The bundled CLI supplies the current contract, SDK, identity, artifact builder, and publish protocol; it does not generate the website. Turn the user's requirements into working pages and interactions in their project, inspect the result, and iterate before publishing. Use the current Agent's normal code-editing and browser tools. Do not delegate site implementation to an undocumented generator.

Run every CLI command from **this Skill's directory**, even when `--project` points elsewhere: `cd <directory-containing-this-SKILL.md> && node scripts/taku-publisher.mjs <command> --json ...`. Read the JSON `status`, `requires_action`, and `action_type`; a successful process exit alone does not mean the site is live. Do not assume a globally installed CLI, sibling Skill, or Publisher source checkout exists.

## Understand and implement

1. Run `sites-contract --json` and `help` before using unfamiliar capabilities. Use the returned contract version and project format as authority. Inspect the user's existing project and requirements. For a new empty project, run `sites-init --project <absolute-directory> --json`; it creates a minimal starting point, not a finished design. Preserve existing work when updating a project.
2. Decide the pages, visual design, accessibility, responsive behavior, states, and interactions the user actually needs. Implement the site files, worker entrypoint, and `taku.site.json` in the user project. The default template serves static assets. Replace its placeholder HTML with a usable site. Add server logic only for supported Worker and Sites capabilities. Do not claim a mockup or template is a completed site.
3. For browser-side Taku auth, storage, or integrations, export the bundled SDK with `sites-sdk-export --output <absolute-project>/dist/assets/taku-sites-sdk.mjs --json` and import it from `/taku-sites-sdk.mjs`. Inspect the exported module's API before calling it. Declare required auth scopes and integration operations in `siteManifest`; the validator checks SDK usage against that manifest. Use migrations for data changes. Do not invent an integration name, scope, operation, platform endpoint, credential, or external egress route. If the current contract cannot support a requested feature, explain the gap and implement the supported portion only with the user's agreement.
4. Run the project's own build/tests where relevant, then `sites-validate --project <absolute-directory> --json`. Fix contract errors and rerun. `sites-build` reports the artifact identity and object summary without uploading. Run `sites-preview --project <absolute-directory> --json`, inspect the returned local URL with available browser tools, exercise important paths and responsive layouts, and correct problems. This preview serves static assets only: it cannot prove hosted Worker, auth, storage, integration, or production behavior. Say which behaviors remain unverified.

## Sign in and publish

Use `sites-login --json` for the dedicated `publish_site` authorization, then `auth-check --request-id <returned-id> --json` after the user completes the browser flow. Continue only when it returns `authenticated`; cancellation, expiry, or `awaiting_authorization` is not success. Use `sites-whoami --json` to check account access and `sites-list --json` to find an owned Site when updating one. Never ask for, display, or use a JWT, Publisher token, or upload credential yourself. Sites commands use the saved dedicated session; do not substitute environment bearer tokens or call the Worker API directly.

For a new Site, ask the user for **one exact desired subdomain**. The CLI has no candidate generator or optional-subdomain selection. For an update, use the exact owned `projectId`. Run `sites-publish --project <absolute-directory> --slug <user-supplied-slug> --json` or `--project-id <owned-id>`. In a non-interactive Agent shell, expect `needs_input` with an exact `confirm_target` and build summary. Show that concrete target and summary to the user; pass `--confirm-target <exact-value>` only after the user explicitly confirms publication to it. A general request to build a site does not choose or confirm a hostname. In an interactive terminal, the CLI can prompt for the slug and exact confirmation itself.

On interruption, rerun the same publish command. The CLI resumes a local checkpoint and asks the server which objects are missing. If it reports changed build identity or target, stop and review the change with the user before an explicit `--reset`. If a slug is unavailable, ask for another user-chosen slug. Do not guess alternatives. Report quota, account, ownership, expired login, and platform failures as returned; do not bypass them.

Only report a live URL as published when the CLI returns `sites_published` with `ready: true`, or `sites-status --project-id <id> --json` confirms the release. A `sites_publishing` response is still pending. An updated Site uses the same Site record and hostname.
