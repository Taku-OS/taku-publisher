# Registration and terms review handoff

Publisher recognizes the Workers HTTP 428 contract for `REGISTRATION_REQUIRED`,
`LEGAL_ACCEPTANCE_REQUIRED`, and `PUBLISHER_LEGAL_REVIEW_REQUIRED`. The Node CLI,
Creator Studio client, and legacy Python CLI return an actionable review result
instead of treating it as expired authorization.

The result contains `ok: false`, `status: legal_review_required`,
`requires_action: true`, `action_type: review_legal_terms`, `needsAuth: false`,
`http_status: 428`, and `review_url`. CLI commands exit nonzero. The review URL
uses the configured Taku site origin and known routes; arbitrary response URLs,
unknown document IDs, credentials, and response message content are not copied.
Set `--site-url` or `TAKU_SITE_URL` for a different environment.

Users complete age/terms review themselves, signed in to the same account in
Taku Web. Publisher neither collects dates of birth nor submits legal acceptance,
license consent, or artifact review fields. No browser opens automatically for
this error. Existing local drafts are retained. A blocked Card save resumes using
`creator-editor --json --draft <draftPath>`; a publication completed in the Web
review is followed by a status check, not automatic resubmission. See `SKILL.md`
for host-agent handling.

The backend remains authoritative. Account consent does not replace per-artifact
publication consent, and this patch does not add unsupported public SubApp release
or retrofit evidence into legacy backend publication routes.

Companion changes:

- Workers: https://github.com/Taku-OS/taku-workers/pull/219
- Web: https://github.com/Taku-OS/taku-landing-page/pull/146
- Desktop: https://github.com/Taku-OS/taku/pull/286

Deploy the compatible Workers API before the new Web/Desktop clients. Server
legal enforcement remains disabled in these PRs. Activation, database migration,
real account persistence, staging OAuth/publication/payment validation, legal
review, and operational request handling are separate rollout requirements.

Tests use fixture tokens and local responses. They cover recognized and unrelated
errors, trusted-origin links, request cessation, retained drafts, CLI JSON/exit
codes, and existing successful behavior. They do not prove production acceptance
or execute real registration, publication, payments, or emails.
