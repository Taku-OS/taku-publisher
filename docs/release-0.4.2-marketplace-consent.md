# Publisher 0.4.2: explicit Sites Marketplace discovery (TAKU-534)

The Sites Skill asks whether to also list the Site on the Taku Marketplace so more people can discover it. Publishing requires an explicit yes/no answer and exact target confirmation. The Site URL remains public; the Marketplace choice controls discovery.

`sites-publish --listing private` confirms exclusion before creating or resuming an artifact upload. A failed unlisting stops publication and retains the checkpoint. If the CLI stops waiting before activation, Marketplace exclusion is already confirmed. `--listing public` applies listing after the confirmed release is active. Site publication and Marketplace outcomes are reported separately. `sites-listing` retries a listing choice without republishing the Site.

Deploy the companion Worker authorization change before distributing this version. It grants `sites.publish` access only to the exact directory PATCH route and restricts Publisher input to `expectedVersion` and `listingIntent`. Existing ownership, readiness, moderation and version checks apply. No database migration or historical Site backfill is required.

Distribution uses the standard two Skills and Codex, Claude Code and Cursor layouts. OpenCode uses the portable Agent Skills installer. Build from the clean release commit, publish immutable `v0.4.2` GitHub assets, and promote the generated Marketplace branch. Preserve existing release assets and the current GitHub latest pointer. This release does not publish to the npm registry or official Cursor store.

Pinned Sites installation after publication (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.4.2/taku-publisher-0.4.2.tgz taku-publisher install --host cursor --skill taku-sites --update
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.4.2/taku-publisher-0.4.2.tgz taku-publisher install --host agent-skills --skill taku-sites --update
```

Validation includes the CLI publish/Marketplace/command tests, Worker auth/directory tests, clean source smoke, generated Skill checks and isolated installer checks. Production acceptance for this delivery permits deployment and read-only checks; a successful live listing/unlisting or Site publication would write production business data and requires separate approval under the delivery constraint.

References TAKU-534.
