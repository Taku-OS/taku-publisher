# Capabilities, scopes, and credits

The live `capabilities` array from `sites-contract --json` decides what a Site may use. Each entry has `apiId`, `name`, `operations`, `scopes`, `status`, `billing`, `preview`, and `published`.

- Only `status: "ready"` with `published: true` can be used in a published Site.
- `candidate_only` entries are internal QA previews. They do not permit publishing; the server will reject the manifest.
- If an entry is missing or `unavailable`, the capability does not exist for this Site. Do not substitute another provider or fake its results.

## Capability list (release 2026-10; verify against the live catalog)

| Capability | SDK call (browser only) | Manifest / scopes | Credits |
|---|---|---|---|
| Sign-in | `taku.auth.getSession/signIn/signOut` | `auth.mode` `optional`/`required`; `profile.basic` | none |
| Personal records | `taku.storage.personal.list/put/delete` | `storage.personal.read` / `.write`; auth `required` | Site resource usage only |
| Anonymous submissions | `taku.storage.submissions.create` | `storage.submissions.write`; auth `optional` works | Site resource usage only |
| Favorites (Airbnb stays) | `taku.storage.favorites.list/save/delete` | `storage.favorites.read` / `.write`; auth `required` | Site resource usage only |
| Generic SQL | `taku.storage.query/batch` | `storage.database.read` / `.write`; auth `required` | rows read/written metered |
| Usage summary | `taku.usage.getSummary()` | none | none |
| Airbnb | `taku.integration.call('airbnb', op, input)`; ops `autocomplete`, `search`, `detail`, `price` | integration `airbnb` + `integration.airbnb.read` | Taku credits per call |
| SerpAPI | `taku.integration.call('serpapi', 'search', { q, engine? })` | integration `serpapi` + `integration.serpapi.read` | Taku credits per call |
| Image edit | `taku.media.createInput` → `uploadInput` → `editImage` → `getJob` → `getAsset` | integration `media` op `image_edit` + `media.image.edit`; auth `required` | Taku credits, reserved then settled |
| Image generate | `taku.media.generateImage(prompt, { aspectRatio?, requestId? })` → `getJob` → `getAsset` | integration `media` op `image_generate` + `media.image.generate`; auth `required` | Taku credits, reserved then settled |
| Video generate | `taku.media.generateVideo(prompt, { aspectRatio?: "16:9" \| "9:16", durationSeconds?: 4 \| 6 \| 8, requestId? })` → `getJob` → `getAsset` | integration `media` op `video_generate` + `media.video.generate`; auth `required` | Taku credits, reserved then settled |

Check the exported `taku-sites-sdk.mjs` for exact method names and signatures. Do not call a method or operation that it or the catalog does not list.

**Internal test phase.** While Sites is in internal testing, every paid capability returns `403 SITE_CAPABILITY_INTERNAL_ONLY` unless both the Site owner and the signed-in visitor are verified @taku.ai accounts (`TakuSitesRequestError.internalOnly`). Show that state plainly; do not retry.

**Who pays.** On a published Site, the signed-in **visitor's** Taku account pays for provider calls (`billing: "taku_credits"`). In a Taku preview, the **Site owner** pays. Managed media first reserves the maximum quoted cost, then settles to the actual cost when the job finishes. If a call returns `402 insufficient_credits`, say so clearly in the UI and do not retry automatically. `429` responses include `retryAfter`.

## Integration rules

- Send only the documented input fields. The server rejects extra fields before calling the provider, and the platform controls provider URLs, keys, locale, and limits.
- Airbnb: `autocomplete { query }` → `search { placeId, checkinDate?, checkoutDate?, adults? }` → `detail`/`price { listingId, checkinDate, checkoutDate, adults }`. Dates are `YYYY-MM-DD`; `adults` is an integer. Responses keep the provider's nested structure (for example `data.sectionContainer[*].section`). Parse it defensively. HTTP 200 does not mean every field is present. Price lines can be under `structuredDisplayPrice.explanationData.priceDetails[*].items[*]`.
- Show real errors. Never make up destinations, listings, prices, search results, or images.

## Media image edit

```js
const permit = await taku.media.createInput(file.type);   // image/png | image/jpeg | image/webp, ≤ 20 MiB
await taku.media.uploadInput(permit, file);
let job = await taku.media.editImage(permit.input_id, prompt, { requestId });
while (!job.terminal) {
  await new Promise(r => setTimeout(r, job.poll_after_ms ?? 2000));
  job = await taku.media.getJob(job.job_id);
}
if (job.status === 'completed' && job.asset_content) show(await taku.media.getAsset(job.job_id));
```

Reuse the same `requestId` when retrying so the visitor is not charged twice. Put a limit on polling. Results are kept for about 30 days. Uploaded inputs are temporary and are not result assets.

## Media image / video generate

`generateImage` and `generateVideo` return the same job shape as `editImage`; poll `getJob` and read `getAsset` the same way. Video jobs can take several minutes, so show progress and let the visitor leave and come back (keep the `job_id`). Declare only the media operations the Site uses: the session must be granted every scope declared on the `media` integration.
