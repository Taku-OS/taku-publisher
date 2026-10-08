# Image-to-image Sites and Desktop App conversion

First read `sites-contract --json`. The live catalog must list the `media` integration's `image_edit` operation as ready and published. The bundled SDK is implementation support, not a grant. If unavailable, report the returned state before publishing.

Use this minimal Site manifest for image editing:

```json
{
  "manifestVersion": 1,
  "auth": { "mode": "required", "scopes": ["media.image.edit"] },
  "integrations": [{ "name": "media", "operations": ["image_edit"], "scopes": ["media.image.edit"] }],
  "storage": { "type": "turso", "migrations": false },
  "egress": { "mode": "platform-proxy" }
}
```

Add personal-storage scopes only if the Site actually saves user templates through platform storage. Browser localStorage is device-local; it is not account storage.

## Adapting a Desktop App

| Desktop App | Site browser implementation |
|---|---|
| Host `pickAsset()` and opaque `assetRef` | File input; PNG/JPEG/WebP, nonempty, at most 20 MiB; `media.createInput(file.type)` then `media.uploadInput(permit, file)` |
| Host `media.image.edit@1` | `media.editImage(permit.input_id, prompt, { requestId, aspectRatio: 'auto', resolution: '1K', outputFormat: 'png' })` |
| Host operation events | `media.getJob(job_id)` with bounded polling and visible progress |
| Host `asset.open` | `media.getAsset(job_id)` returns a Blob; create and later revoke an object URL for comparison and download |

All platform calls belong in browser code imported from the exported SDK. The Worker only serves assets and your own logic. Do not copy the Desktop bridge, control token, Host asset references, or provider credentials into the Site.

Read `auth.getSession()` and require the granted `media.image.edit` scope before enabling a paid edit. Request the manifest's scopes on sign-in. Keep the original image visible while the result is pending; enable comparison and export only after a completed job returns an actual asset.

Generate one request ID per intended edit and preserve it with the input ID and job ID. A retry of an uncertain submission must reuse that request ID and the same body; it must not submit a new paid edit automatically. Poll for a bounded duration and preserve the job ID when stopping so a visitor can resume status checks. A polling timeout does not cancel the remote job. Handle failed terminal jobs without presenting the original photo as a generated result.

Show signed-out, missing-scope, internal-only, insufficient-credit, rate-limit, upload-expiry, and provider-failure states. Do not automatically retry paid submissions after 402 or 403. The visitor pays in published Sites; the owner pays in preview.

When converting a photo-editing App such as Looks, preserve custom prompts, preset selection, before/after comparison, and download behavior. Explain unsupported controls rather than silently ignoring them. Keep source attribution and licenses with copied presets.

## Required verification

Run `sites-validate` on the build. In SDK stubs, exercise permit → upload → edit → pending job → completed job → image Blob, and verify the same idempotency key on a submission retry. Also test 401, 402, 403 internal-only, 429 and 503. Verify the manifest guard rejects undeclared editing. Stub success is not live provider verification; report live sign-in, charging, and generated output separately.
