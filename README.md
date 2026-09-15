# Taku Publisher Marketplace

Release bundle: **0.3.19** — Publisher with Cursor integration.
All three hosts share the same Node.js runtime. Stax Challenge is an explicit
optional workflow; ordinary Card, Skill and SubApp entry behavior is preserved.

## Codex

```sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin add taku-publisher@taku
```

## Claude Code

```sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
```

## Cursor

The root `.cursor-plugin/marketplace.json` describes the complete Cursor Agent
plugin at `plugins/taku-publisher-cursor`. For GitHub import, choose this
`marketplace` branch, not the source-only `main` branch.

Alternatively download `taku-publisher-0.3.19.tgz` from the
[GitHub release](https://github.com/Taku-OS/taku-publisher/releases/tag/v0.3.19)
and run this command from the download directory (Node.js 20+):

```sh
npx --yes --package ./taku-publisher-0.3.19.tgz taku-publisher install --host cursor
```

This installs the bundled Skill into `~/.cursor/skills/taku-publisher`.
The package is not published to npm and is not listed in the official Cursor store.
Existing unmanaged or edited installations are protected; see the
[installation guide](https://github.com/Taku-OS/taku-publisher/blob/main/docs/cursor-release.md).

Start a new Agent chat/session after installation, then ask:

```text
使用 Taku Publisher 开始 Stax Challenge，生成私有 Stax Card，返回可编辑 Studio 地址，同时列出候选 Skill，让我选择一个或跳过；先不要上传或公开发布。
```

First-use browser sign-in is required; after authorization the same command
continues. Public Skill release requires confirmation in Taku Web. Public SubApp
release remains unsupported; Marketplace buyer Skill installation targets Codex only.

Source, security policy and licenses are maintained on `main`.
`release.json` records the exact reviewed source commit for this bundle.
