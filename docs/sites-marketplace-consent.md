# Site publishing and Marketplace discovery

The `taku-sites` Skill asks whether the user also wants the Site listed on the Taku Marketplace so more people can discover it. The Site URL is already public; listing does not change visitor authentication. Both choices require an explicit answer, which can share the existing exact-target confirmation. There is no default Marketplace consent.

`sites-publish --listing public|private` saves the answer in the publish checkpoint. For `private`, the CLI confirms `unlisted` before creating or resuming an artifact upload, including on every retry. Failure to confirm exclusion stops publication and keeps the checkpoint; a CLI wait timeout after finalization still reports the confirmed `unlisted` result while the release activates in the background. For `public`, the CLI waits until the confirmed release is active before applying `listed`. Both use the owner's current directory version and the existing directory PATCH API. An interrupted publish retains its answer. Changing the answer requires a fresh target confirmation with `--reset`; checkpoints from older clients finish without inventing consent.

The CLI reports `marketplace.status` separately from `ready`. A successful Site publication with failed Marketplace listing stays `sites_published`, with `requires_action: true` and `action_type: retry_site_listing`. Retry the listing using `sites-listing --project-id <id> --listing public|private`; no new Site or upload is needed. A lost PATCH response is reconciled by reading current state. Version conflicts never trigger a blind write replay. The existing readiness, moderation and owner checks still apply.

## Rollout order

1. Review and deploy the companion Worker change through its Git pipeline. It allows `publish_site` sessions with `sites.publish` to PATCH only the exact Site directory route. Publisher requests are limited to `expectedVersion` and `listingIntent`; metadata and lifecycle management are outside that grant.
2. Release the Publisher runtime and rebuilt `taku-sites` Skill together through the existing release process. The portable Skill and Codex, Claude Code and Cursor bundles use the same canonical source; OpenCode uses the portable Skill.
3. Verify in an external harness that yes/no is asked, yes lists, no excludes discovery, a pending publish resumes, and listing failure is reported separately. Also check Console edits and moderation errors.

No database migration, historical Site backfill, secret change, feature flag change or Desktop UI change is required. The approved publish-dialog mock remains a design reference; external harnesses ask through the Skill.

## Local verification

```bash
npm run build:runtime
node --test packages/publisher-runtime/test/sites-publish.test.mjs packages/publisher-runtime/test/sites-marketplace.test.mjs packages/publisher-runtime/test/sites-commands.test.mjs
npm run smoke:clean -- --working-tree
```

Worker verification uses its in-process auth/directory tests and the existing directory policy tests with `bun --no-env-file`. These tests use loopback/injected fixtures and do not write production data.

The uncommitted candidate passed the targeted CLI tests, Worker auth/directory tests, Worker type checking, and the clean snapshot's Node/Python/installer/source suites and four distributed Sites Skill smoke checks. The complete clean smoke stops at the existing native promotion check (`Dirty source: commit and rebuild before promotion.`); that release gate must be rerun from the reviewed commit. No release, deployment or production data write was performed for this verification.
