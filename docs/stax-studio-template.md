# Stax Studio v9.2 template and assets

Publisher standalone previews, the cloud iframe runtime and the Codex, Claude
Code and Cursor plugins share the same source:

- `creator/templates/stax-app.html`: component renderers, catalog and shell.
- `stax-bootstrap.js`: display-model initialization, without a saved account.
- `stax-cloud-bridge.js` and `stax-cloud.css`: same-origin iframe integration.
- `creator/assets/studio/`: v9.2 CSS, interactions, fonts, logos and textures.
- `stax-source.json`: imported website source hashes and completion status.

Import a completed website handoff (read-only source):

```sh
node creator/scripts/sync-stax-studio-template.mjs <handoff>/public/studio
```

The final handoff must contain `<handoff>/READY.json`. `--baseline` permits a
temporary baseline and marks it `baseline-awaiting-final`; it is not final
acceptance. The importer removes generated model/font/art injections and
extracts reusable bootstrap and iframe sources. It normalizes logo references
to the included `/studio/` asset, Find Me to 2×1,
and preserves explicit empty selections/layouts; the model generator supplies
only real available components and maintains the 8×5 grid.

Export the runtime with its assets for a website checkout:

```sh
node creator/scripts/export-stax-studio-runtime.mjs <output>/studio/stax-studio-runtime.html --with-assets
```

The output uses `/studio/` URLs and includes the complete asset directory. The
default export and standalone editor inline the same CSS, JavaScript, fonts,
logos and textures, so file previews and PNG captures do not depend on a website
root or Google Fonts. Import/export commands do not write to the source website.

`npm run build:adapters` copies `creator/` into each host's portable skill;
`npm run build:marketplace` packages those outputs. Do not merge the built
`marketplace` branch into source `main`, or install these outputs during review.

Validation: renderer/draft/local-preview tests, template asset equivalence,
real display-model browser rendering, and all three host asset inventories.
After building the adapters, run
`node creator/scripts/verify-stax-studio-template.mjs <handoff>/public/studio --require-final --plugins`
to compare the handoff hashes, extracted sources, standalone/website rendering
and the runtime from each packaged host.
Regeneration fills a nonempty cloud draft using available data; an explicit
empty draft remains empty. Ordinary publication preserves layout and selection.
