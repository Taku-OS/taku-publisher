# Owner images, videos, and shared storage

Read `sites-contract --json` → `owner_assets`, or `sites-assets-policy --json`, before promising storage. Policy is live and account-wide: `usedBytes + reservedBytes` count against `limitBytes`; `availableBytes` is not a per-Site or monthly allowance. Never infer unlimited space from a missing policy. All explicit uploads, temporary and permanent, count. Temporary files expire after 30 days; permanent files remain until an authorized deletion. This is separate from database capacity and provider credits.

## Local manifest and stable references

Put `taku.assets.json` at the project root. Its exact shape is:

```json
{
  "schema": "taku.sites.asset-manifest.v1",
  "files": [{
    "logicalPath": "/media/hero.png",
    "sourcePath": "dist/assets/media/hero.png",
    "contentType": "image/png",
    "size": 1234,
    "sha256": "<actual 64-character lowercase SHA256 of the file>",
    "retention": "permanent",
    "visibility": "public"
  }]
}
```

Replace size/hash with measured values. Source paths are relative to the project, cannot escape it, and cannot be symlinks. PNG/JPEG/WebP/AVIF/GIF are limited to 25 MiB; MP4/WebM to 512 MiB and the owner's remaining capacity. At most 1000 material entries per release; multipart parts are 8 MiB. Unsupported formats must be converted or reported, not relabeled.

Reference the example as `/__taku/assets/by-path/media/hero.png` in the page. That stable logical URL is bound to the release and verified file; it is not an R2 URL or a short-lived ticket. Updating bytes requires a new hash/build and fresh publish confirmation. Declare every local image/video, including files generated into `dist/assets`, here. Listed files are removed from the code bundle; HTML/JS/CSS still follow the original 64 MiB release limit. Do not embed media as base64 to evade quota.

Choose `permanent` for logos, article pictures, and page/background videos; choose `temporary` for explicit 30-day experiments. Within an already-authorized Site build, make these choices without asking about each file. Tell the user when a page reference will expire. Retention and visibility are independent: `private` content requires Site authorization; `public` only exposes content through an active, referenced Site. Neither grants visitors access to the owner's library.

`sites-validate`/`sites-build` read verified local files and report the material summary. Your own harness provides preview; Publisher does not provide a preview server. No project, hostname, quota reservation, or object is created until exact-target publication is confirmed. `sites-publish` then uploads bounded parts under that confirmed manifest, verifies receipts, and resumes the same checkpoint on retry. A capacity error is not a login error; preserve the request ID and build, and offer to reduce materials, delete unused files, or upgrade. Do not create another project to retry.

## Owner library commands

- `sites-assets-list --limit 50 [--after <asset-id>] --json`: sorted cursor pagination, at most 100 records per call.
- `sites-assets-resolve --asset-id <asset-id> --json`: verified metadata only. `content_fetched: false` means no bytes were fetched; its `download_command` names the native command, not a promise that the provider/file is currently available. Do not invent a download URL or claim the file was downloaded.
- `sites-assets-download --asset-id <asset-id> --output <new-local-file> --json`: resolve the authenticated owner's metadata and fetch through the fixed Taku owner endpoint. A successful result means the complete file passed byte-length and SHA256 verification. Streams large videos without a whole-file buffer; refuses existing files/symlinks, redirects, expired/not-ready content and mismatched bytes. Interrupted downloads leave no final file; repeat the same read if needed. It does not unfreeze the public Site, extend an expiry, create cloud resources or consume credits. The server still checks ownership and actual availability at download time. Add a local manifest before including downloaded media in a new build; a new upload is a distinct retained file and may consume additional account space.
- `sites-assets-delete --asset-id <asset-id> --confirm-asset-id <same-id> --json`: only after the user explicitly requests deletion of that exact file. Never delete automatically to make a build fit. Server ownership and retained-version references decide whether deletion is allowed; `deleting` is pending, not reclaimed space. Capacity is freed only after verified object deletion.

Upload is part of confirmed publication, not a standalone arbitrary upload command. The catalog also describes target-bound `assets.promote`, but this CLI does not yet expose a general promotion command. Do not fabricate one, use curl, change a temporary record's expiry, or fetch arbitrary URLs. Generated visitor media remains on its existing 30-day policy until a separate authorized owner promotion is implemented and verified.
