# Site contract

The authority is `sites-contract --json`: its `contract_version`, `project_config`, `artifact_limits`, and `capabilities`. The manifest is also re-validated by the server when you publish.

## Project layout

`taku.site.json` goes at the project root. Only these keys are allowed:

```json
{
  "workerEntrypoint": "dist/worker.mjs",
  "assetsDirectory": "dist/assets",
  "migrationsDirectory": "migrations",
  "siteManifest": {
    "manifestVersion": 1,
    "auth": { "mode": "none", "scopes": [] },
    "integrations": [],
    "storage": { "type": "turso", "migrations": false },
    "egress": { "mode": "platform-proxy" }
  }
}
```

- Build with any toolchain you like (Vite, esbuild, and so on). The CLI packages the build output only.
- **Worker:** one bundled ES module with a `default` export `{ fetch(request, env) }`, at most 5 MiB. It serves static files through `env.ASSETS.fetch(request)`. `ASSETS` is the only binding. There is no file system, no platform secret, no database handle, and no Taku credential.
- **Assets:** at most 1000 files, 25 MiB each, 64 MiB per release in total. No symlinks, no secrets, and no credential-like files (the build rejects them).
- **Migrations** are optional and only for generic SQL (see storage.md). Name them `NNNN_name.sql`. Set `storage.migrations: true` only when you actually ship them.
- **Manifest:** `auth.mode` is `none`, `optional`, or `required`. With `none` the scope list must be empty. List only the scopes and `integrations[{ name, operations, scopes }]` the Site actually uses. Integration scopes must also appear in `auth.scopes`. Unknown keys, scopes, or operations are rejected.

## Browser SDK vs Worker

- Platform capabilities (sign-in, storage, integrations, media) run **only in the browser** through the SDK. Export the SDK with `sites-sdk-export` and import it from `/taku-sites-sdk.mjs`, or bundle it. The SDK calls same-origin `/__taku/*`, and the Taku dispatcher serves those paths.
- **Never** import the SDK in the Worker, fetch `/__taku/*` from the Worker, or build a Worker `/api/me` or session proxy. The Worker never receives a session cookie or token. `sites-validate` rejects this with `SITE_BROWSER_SDK_IN_WORKER`.
- The Worker is for your own logic: routing, rendering, validation, calculations. Module-level variables do not persist. Never tell users data was "saved" unless a real storage capability confirmed it.
- `siteUserId` from `taku.auth.getSession()` is for display and client-side correlation. It does not prove anything to your own `/api/*` routes.
- The SDK sends `X-Taku-CSRF: 1` on non-GET `/__taku/*` calls. For your own same-origin `/api/*` calls that write (POST/PUT/PATCH/DELETE), send `X-Taku-CSRF: 1` and `credentials: 'same-origin'`. Taku preview gateways require it, and your Worker can reject writes without it.
- `/__taku/*` is reserved. Do not implement or shadow those paths.

## Sign-in

```js
import { taku } from '/taku-sites-sdk.mjs';
const session = await taku.auth.getSession();      // { authenticated, siteUserId?, scopes? }
await taku.auth.signIn({ scopes: manifestScopes, returnTo: '/account' }); // navigates to taku.ai
await taku.auth.signOut();
```

Request every scope in `auth.scopes` when signing in. After returning from sign-in, read `getSession()` again before showing the user as signed in. Keep loading, signed-out, signed-in, and error states separate. An error (`TakuSitesRequestError` with `status`, `code`, `retryAfter`) is not the same as being signed out.

## Security rules

- Never connect directly to Supabase, Turso, or provider APIs, and never embed provider keys, database URLs, or Taku tokens.
- Never put a project ID, Taku user ID, plan, or billing attribution into a request parameter or header that a visitor could forge.
- Do not invent integration names, operations, scopes, endpoints, or egress routes. If the catalog lacks what the user asked for, explain the gap and build only the supported part, with their agreement.

## Validation errors

- `SITE_BROWSER_SDK_IN_WORKER`: move the SDK usage to browser code.
- `SITE_SDK_CAPABILITY_UNDECLARED`: add the missing scope or operation to the manifest.
- `SITE_SDK_OPERATION_UNSUPPORTED`: use an operation name from the catalog.

These checks only catch SDK calls that can be seen statically. Passing them does not mean the Site is authorized to do anything.
