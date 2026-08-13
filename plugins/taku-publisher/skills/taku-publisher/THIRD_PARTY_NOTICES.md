# Third-Party Notices

This document records third-party software and assets bundled with Taku
Publisher. It does not change the license of Taku-owned source code or assets.

## Fonts

The font files under `creator/assets/fonts/` are distributed under the SIL Open
Font License, Version 1.1. The complete license text is included at
`creator/assets/fonts/OFL-1.1.txt` and must remain with redistributed copies.

| Family | Bundled files | Copyright | Upstream |
| --- | --- | --- | --- |
| DM Sans | `dm-sans-latin.woff2` | Copyright 2014 The DM Sans Project Authors | <https://github.com/googlefonts/dm-fonts> |
| Instrument Serif | `instrument-serif-latin.woff2`, `instrument-serif-italic-latin.woff2` | Copyright 2022 The Instrument Serif Project Authors | <https://github.com/Instrument/instrument-serif> |
| Pixelify Sans | `pixelify-sans-bold-latin.ttf` | Copyright 2021 The Pixelify Sans Project Authors | <https://github.com/eifetx/Pixelify-Sans> |
| Space Grotesk | `space-grotesk-latin.woff2` | Copyright 2020 The Space Grotesk Project Authors | <https://github.com/floriankarsten/space-grotesk> |
| Space Mono | `space-mono-regular-latin.woff2`, `space-mono-bold-latin.woff2` | Copyright 2016 The Space Mono Project Authors | <https://github.com/googlefonts/spacemono> |

These notices apply to the font software itself. Documents, screenshots, and
interfaces rendered with the fonts are not required to use the OFL.

## Superpowers

The SubApp conversion template bundles Superpowers 6.2.0 from
`openai-curated-remote/superpowers` under the MIT License:

> Copyright (c) 2025 Jesse Vincent

The complete upstream license is retained in the bundle at
`packages/repo-to-stax-converter/template/takuai-template/.taku-template/payload/.agent-tools/superpowers/6.2.0/LICENSE`.

Superpowers' optional visual brainstorming companion loads its Prime Radiant
logo from `https://primeradiant.com/brand/superpowers-visual-brainstorming-logo.png`
by default. That request includes the bundled Superpowers version and is
described by upstream as optional usage measurement. It can be disabled by
setting any of the following environment variables to a true value:

- `SUPERPOWERS_DISABLE_TELEMETRY`
- `DISABLE_TELEMETRY`
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`

## TypeScript

Generated Codex and Claude Code plugins include a minimal TypeScript runtime.
Its `LICENSE.txt` and `ThirdPartyNoticeText.txt` files are copied alongside the
runtime in `node_modules/typescript/`.

## Product logos and Taku artwork

The bundled product logos and Taku character artwork are not open-source font
or software assets. See `TRADEMARKS.md` for their separate terms.
