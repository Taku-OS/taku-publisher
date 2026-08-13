# `@taku/publisher-cli`

This private workspace package provides stable executable names while the existing Node creator runtime and Python publishing pipeline remain backward compatible in their original locations.

- `taku-creator`: local scan, persona, draft, editor, and Creator Profile publishing.
- `taku-publisher`: discovery, staging, security review, packaging, authorization, and artifact upload.
- `taku-publisher subapp-assess`: read-only convertibility assessment for one absolute local App directory or public GitHub repository URL; unresolved service capabilities receive search suggestions, while only explicit `--service-mappings` selections checked against the current Proxy catalog can become mapped.
- `taku-publisher subapp-prepare`: after exact confirmation of an eligible assessment, prepare a validated isolated candidate from the bundled pinned Taku template; it does not start an Agent or publish.
- `taku-publisher subapp-convert`: validate one exact candidate and return the bounded contract for the current Codex or Claude Agent.
- `taku-publisher subapp-conversion-check`: run the static post-migration gate without executing candidate scripts.
- `taku-publisher subapp-runtime-plan`: produce a read-only, digest-bound trusted runtime confirmation plan.
- `taku-publisher subapp-runtime-check`: after exact confirmation, run frozen install, tests, checks, and build in a disposable qualified Seatbelt workspace; it does not publish.
- `taku-publisher subapp-package-plan`: verify one exact candidate and preserved trusted preview build before packaging.
- `taku-publisher subapp-package`: after exact confirmation, create deterministic Desktop-compatible `source.zip` and `build.zip` locally; it does not upload or publish.
- `taku-publisher subapp-register-plan`: revalidate one local dual-archive release plus listing/source-rights metadata without network mutations.
- `taku-publisher subapp-register`: after exact confirmation, upload both archives and register one owner-scoped private App draft version; it does not publish the App.
