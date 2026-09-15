# Taku Publisher 0.3.19 — Stax Challenge integration

The production plugin remains `taku-publisher` on the `standard` channel for
Codex, Claude Code and Cursor. It preserves 0.3.18's Cursor support and ordinary
Card, Skill, SubApp and Creator Center routes.

Explicit Stax Challenge requests generate a private Card, return its actual
Studio URL and offer local Skill candidates in the current host Agent. The user
can choose one exact Skill or skip before preparation. Preparation reuses the
existing immutable staging, safety review and packaging flow. Private upload
requires user authorization; public Skill submission remains a separate Taku
Web confirmation.

Production API, Studio and authorization defaults are unchanged. No forced
preview backend, browser-to-local selection bridge, independent AI runner,
automatic public submission or per-command authorization clearing is included.

## Install

Codex:

```sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin add taku-publisher@taku
```

Claude Code:

```sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
```

Cursor (Node.js 20+):

```sh
npx --yes --package https://github.com/Taku-OS/taku-publisher/releases/download/v0.3.19/taku-publisher-0.3.19.tgz taku-publisher install --host cursor
```

For an unmodified, installer-managed Cursor 0.3.18 installation, append
`--update` to create a recoverable backup before upgrading. Unmanaged or locally
edited installations retain their existing protections. npm and the official
Cursor store are not publication channels for this release.

Start a new chat/session and check the CLI `--version` from the actual loaded
Skill directory. It must report `taku-publisher 0.3.19 (standard)`.

## Challenge prompt

```text
使用 Taku Publisher 开始 Stax Challenge：扫描最近30天本地使用记录，生成私有 Stax Card，返回可编辑 Studio 地址，同时列出候选 Skill，让我选择一个或跳过。需要授权时打开浏览器并在授权后继续；先不要上传或公开发布。
```

Release checksums record the reviewed source commit, source-tree checksum and
SHA-256 of the Cursor installation archive and marketplace ZIP. Local fixture
tests do not prove a real Skill has been publicly published; verify that only
through the Worker-backed publication status after explicit user confirmation.
