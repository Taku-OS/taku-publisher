# Studio-preview plugin candidate

This code is prepared locally. No test branch has been pushed and no plugin has
been installed by this change. The production package builders/defaults stay in
their existing files; the new builder rewrites only a separate generated package.

Push the approved commit to **Taku-OS/taku-publisher**, remote `official`, branch
`codex/stax-site-preview-plugin`. This checkout's `origin` points to
**Taku-OS/taku-passport** and must not be used for this push.

The test-only GitHub workflow builds ordinary adapters with both Publisher and
Sites, then produces `dist/studio-preview/{codex,claude,cursor}`. It uploads a
private GitHub Actions artifact; it does not publish to the production Marketplace
or install a plugin. The downloaded artifact contains each host's marketplace
and plugin directory. Codex identity: `taku-publisher-studio-preview@taku-studio-preview`.
Skills: `taku-publisher-studio-preview` and `taku-sites-studio-preview`.

Endpoints are fixed to the new test backend and test website. Sessions and Creator
drafts use `~/.taku/studio-preview/publisher`; Desktop fallback is disabled.
Inherited bearer tokens are cleared and arguments selecting other environments
or external credentials are rejected. Existing installed plugins, sessions and
drafts are not replaced.
Browser authorization opens `/stax` with the original PKCE query so this focused
test does not require the legacy Profile bootstrap API. Publisher consent remains
required. Desktop identity refresh is disabled as well as Desktop fallback.

Local verification completed on 2026-10-14: all adapter TypeScript builds,
3 channel-isolation/package tests and 61 existing Auth/Sites tests passed.
The candidate exists at `dist/studio-preview` for Codex, Claude Code and Cursor,
with both test skills in each host. Generated CLIs report distinct test names,
reject production URL overrides, preserve browser PKCE parameters and do not
read Desktop identity or make a network request when the test session is absent.
The candidate records `sourceDirty: true`; it is a local review artifact, not a
Git pipeline release. No installed plugin was replaced.

Before PM testing, the separate website must be deployed and a confirmed
`@taku.ai` account must exist in Supabase project `nigqoqjwgewnqbwrueuo`. Create
that account only with separate approval, and keep its password out of chat/Git.
Sign in at the test website's `/studio-preview/login`, invoke the test Skill,
and complete the existing Publisher browser consent. Verify `sites-whoami`, then
create/publish a Card and a Site and check the returned preview URL, directory,
anonymous visit and challenge score. These remote steps have not yet been run.
