# CON-96: private loopback Site preview

After building and validating a Site, run the development CLI in the foreground:

```sh
node scripts/taku-publisher.mjs sites-preview --project /absolute/project --json
```

The command returns `sites_preview_ready`, a loopback URL, expiry, PID and build identity. It keeps running until Ctrl+C/SIGTERM or the server's fixed session expiry (at most 30 minutes). It does not create a public slug, upload a release or publish. The URL works only on the same Mac; it is not a remotely shareable preview.

The Site executes in workerd, using an immutable local snapshot of verified artifact bytes, only an ASSETS binding, and denied direct network egress. Publisher credentials, the PKCE verifier and the preview capability remain in the trusted Node process. A random HttpOnly/SameSite cookie, exact Host/origin checks and CSRF protect the loopback gateway. Reserved platform routes never reach tenant code. Browser sign-in uses the existing owner approval page and one-use state/PKCE callback; a Publisher login alone does not approve paid generation.

The gateway supports session/auth, declared text/search integrations and managed image/video generation/job/content/link calls. It explicitly returns `preview_storage_unavailable` for cloud storage and does not represent browser-local drafts as Taku cloud records. SQL migrations are rejected. It is a bounded preview bridge, not complete Dispatcher emulation.

Text requires the companion CON-96 Workers and Proxy changes, the internal candidate gate and a configured server-owned text model. Until those deployments are approved and verified, the current server may reject a text manifest/session. Report that response accurately; do not publish as a fallback or call provider APIs directly.

The pinned Miniflare version matches the current Sites platform's Wrangler runtime. Its alpha package omits upstream declaration-only workspace packages; the narrow Node adapter is locally typed and validated with an actual workerd test instead of disabling TypeScript checking for the project. It is loaded only for `sites-preview`.

This development command needs the reviewed checkout and its installed locked native dependencies. Portable plugin bundles do not include platform-specific Miniflare/workerd binaries and fail explicitly with `sites_preview_runtime_unavailable` before creating a control-plane session. The source checkout's real-workerd tests and portable package smoke tests cover these separate cases. No automatic download or arbitrary host-package fallback is performed.

Check with `npm run test:sites-preview`. The workerd/HTTP test uses a fake control plane and does not prove live owner approval or paid generation.
