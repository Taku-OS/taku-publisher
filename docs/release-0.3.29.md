# Taku Publisher 0.3.29 — renewable Sites authorization

Release candidate. Do not label this version production-ready or latest until
the uploaded installer passes the documented production checks.

- Sites access lasts up to one hour / 256 requests. A refresh family lasts
  30 days from first authorization; refresh does not extend that deadline.
- Expired or exhausted access renews automatically. Concurrent commands use
  a private on-disk lock; response-loss recovery reuses the same refresh
  request. Credentials remain in a mode-0600 local file, never in build assets.
- One 401 may renew and replay the same request. 403, 404 and 5xx do not start
  an authentication loop. Error output retains status, safe request ID and
  bounded redacted context.
- Sites collection requests no longer add a trailing slash. Local preview
  stays in the host harness; the Publisher CLI does not implement preview.
- Canonical Sites SDK/core are pinned to Platform commit
  `89886ccf99600452963ced603a734db20504ecdd`. New `media.getAssetLink(jobId)`
  returns a short-lived Proxy URL; access links and 30-day asset retention
  have separate deadlines. Use this method only after the compatible
  Dispatcher/Workers/Proxy release is verified.
- Server eligibility stays restricted to verified `@taku.ai` accounts.
  Other Publisher/SubApp flows and billing ownership are unchanged.

Release files include the versioned installer, its identical stable-name
copy, marketplace archives and checksums/provenance. Obtain these from the
trusted Taku GitHub release; this version is not published to npm.

Older non-renewable sessions work until their existing expiry and then need
login. Logout attempts remote family revocation and reports an unverified
network revocation separately. Do not use the known-broken 0.3.28 Sites
publish path as a verified rollback; retain data and issue a Git hotfix.
