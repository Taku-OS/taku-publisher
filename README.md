# Taku Publisher Marketplace

Install Taku Publisher directly from this GitHub marketplace.

Current release: **0.3.11**. It confirms the Taku account before scanning and
opens the generated Stax Card as a private cloud Studio draft.

## Codex

```sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin add taku-publisher@taku
```

Start a new Codex task, then ask:

```text
打开 Taku Publisher 创作者工作台，生成我的 Stax Card，并让我选择要发布的本地项目。
```

## Claude Code

```sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
```

Start a new Claude Code session, then ask:

```text
打开 Taku Publisher 创作者工作台，生成我的 Stax Card，并让我选择要发布的本地项目。
```

Source code, documentation, security policy, and licenses are maintained on
the repository's `main` branch.
