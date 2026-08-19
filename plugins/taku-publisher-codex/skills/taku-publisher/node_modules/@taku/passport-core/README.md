# `@taku/passport-core`

`@taku/passport-core` is the host-independent deterministic engine beneath
Taku Passport. It owns capability snapshot composition, private/public
inventory projection, privacy filtering, Persona signal composition and
scoring, public Persona identity projection, and deterministic Usage summary
composition while
`@taku/capability-contract` owns the wire schemas and policy contract.

The package accepts discovered data as input. It does not inspect Codex,
Claude Code, Cursor or Taku directories, execute host commands, call Taku
Worker, render UI or read authentication state. Those effects belong in Host
Adapters and Publisher clients.

Compatibility entrypoints under `creator/scripts/` delegate to this package
during migration. Hosts collect filesystem, command, usage-log, project
metadata, and Worker records; Core receives those records through
`composePersonaSignals` and performs the deterministic computation. Pass an
explicit `generatedAt` when a canonical fixture or hash must be reproduced.
New consumers should import `@taku/passport-core`.

## Persona profile

Browser and renderer consumers must import the browser-safe Persona surface:

```ts
import { buildPersonaProfileV1 } from '@taku/passport-core/persona';
```

`buildPersonaProfileV1` is the canonical projection for:

- the 16 four-letter Persona codes and their four public families;
- bilingual `en-US` and `zh-CN` titles, subtitles, and descriptions;
- four localized axis/habit tags;
- text-only earned badges and stable avatar keys;
- reserved avatar and character binding fields for traits and hidden Personas.

Hosts may supply an explicit rules override, but the checked-in
`creator/config/persona_rules.json` is not a second default catalog. Desktop
owns the visual assets and layout only; it resolves Core avatar keys/codes to
bundled images.
