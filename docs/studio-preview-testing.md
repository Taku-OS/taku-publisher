# Studio preview with production accounts

This channel uses production Taku authentication, APIs and business data with
an independent preview frontend. Publishing creates real Cards and Sites.
The campaign ID and Card generation eligibility rules are unchanged.

- API: https://worker.taku.ai
- Auth: https://auth.taku.ai
- UI: https://codex-stax-page-taku-landing-page.takuos.workers.dev
- Local Publisher credentials: `~/.taku/studio-preview-production/publisher`

Card flow: generate → external browser sign-in/consent → automatic continuation
→ editable Studio → creator clicks Publish → Stax Challenge Review and entry.
The detached auth receiver has a bounded expiry and is reused after interruption.
The editor preserves the preview origin and the owner-bound launch context.
Account profile failures stop generation instead of claiming successful sync.

Build and release through the Git pipeline on `codex/stax-site-preview-plugin`.
Push to remote `official` (Taku-OS/taku-publisher); `origin` points to another repo.
The workflow uploads host-specific plugin artifacts and does not publish the
production Marketplace package. Keep the existing plugin identity so the preview
installation can update. Install only the new Git-built artifact.
