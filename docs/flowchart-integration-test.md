# Marketplace Flowchart integration test

This repository can build a Codex-only, unpublished test plugin named
`taku-publisher-flowchart-integration-test`. It is separate from both the
production `taku-publisher` plugin and the Stax Challenge integration package.

The test build enables automatic Flowchart generation only for new Skill
drafts. It preserves a valid creator-provided Flowchart, skips generation for
updates, requires valid default, `en-US`, and `zh-CN` generated graphs, and
fails before icon generation or remote draft creation when generation fails.

Build it with:

```sh
npm ci
npm run build:flowchart-test
```

The build output is under `dist/flowchart-test`. Use a mock Worker for local
acceptance. A production check may create at most one private draft after
separate explicit authorization; it must not submit or publicly publish it.
