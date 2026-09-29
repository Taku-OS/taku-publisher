# Running and testing in your own harness

Publisher has no preview. Use your usual tools: a dev server, unit tests, a browser, and `wrangler dev` or Miniflare if you want to run the Worker.

## What you can check locally

- Pages, layout, responsiveness, accessibility, client state, and the empty, loading, and error states.
- Your Worker's own routes. Run the bundled `dist/worker.mjs` with a stub `env.ASSETS` (for example `{ fetch: (req) => serveFromDist(req) }`), or run it under `wrangler dev` / Miniflare.
- Input validation, including the submissions 307 handoff: check the status code and the `Location` header.
- That `sites-validate` passes on the production build.

## What you cannot check locally

Everything under `/__taku/*`, which Taku serves and your dev server does not: sign-in, `storage.*`, integrations (Airbnb, SerpAPI), media, and usage. No local server can reproduce real sessions, per-user isolation, quotas, credits, or provider responses. Do not fake these as passing.

## Structure code so capabilities can be stubbed

Put SDK calls in one module and inject the client:

```js
// src/platform.js
import { createTakuSitesClient } from '/taku-sites-sdk.mjs';
export const platform = globalThis.__TAKU_TEST_CLIENT__ ?? createTakuSitesClient();
```

In tests, pass a fake `fetcher` that answers `/__taku/*` with realistic shapes:

```js
const client = createTakuSitesClient({
  baseUrl: 'http://127.0.0.1:5173',
  fetcher: async (req) => new URL(req.url).pathname === '/__taku/session'
    ? Response.json({ authenticated: true, siteUserId: 'test', scopes: ['storage.personal.read'] })
    : Response.json({ error: 'not_stubbed' }, { status: 501 }),
});
```

Also stub the failures: 401 `authentication_required`, 402 `insufficient_credits`, 429 with `Retry-After`, and 503 `platform_unavailable`. Check that the UI handles each one.

When you report, list what you ran for real and what you only tested against stubs, for example: "sign-in and personal storage are verified only against stubs; they will work after publishing on taku.site".
