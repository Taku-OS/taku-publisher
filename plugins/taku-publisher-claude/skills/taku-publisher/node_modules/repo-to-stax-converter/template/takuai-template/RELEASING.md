## Template 发布流程（GitHub Release）

本仓库被 Taku 宿主用于 `create_project` 的默认 SubApp 模板来源。

当前唯一受支持的模板线是 Taku 3：

- GitHub `/releases/latest` 必须指向最新 Taku 3 模板 Release。
- 每个版本仍创建不可变 tag（当前为 `taku-3.0.2-template`），用于固定版本、复现与回滚。

Taku 2 模板通道已经下线；`v0.1.24` 等历史 tag/release 只作为历史记录保留，不再占用 `Latest`，也不再接受兼容发布。
SubApp widget 协议已经移除；Taku 3 模板不得包含 manifest `widgets` / widget `refresh` 字段、widget worker/refresher scripts 或示例 widget 文件。桌面小组件由 Taku Desktop 的 DynamicWidget 子系统负责。

---

### 0) 检查用户生成产物边界

模板仓库根目录包含维护模板本身所需的协作规则，但这些内部文件不能进入用户通过 `app_create` 创建的 SubApp。

- `.taku-template.json` 是生成产物的显式清单。
- `.agents`、`.claude`、`skills.md`、模板维护用文档、Changelog 与 release check 会在创建应用时移除。
- `.taku-template/payload/AGENTS.md` 与 `CLAUDE.md` 会覆盖到生成项目根目录，只包含通用 SubApp 开发约束。
- `.taku-template/payload/.agents/skills` 与 `.claude/skills` 提供相同的 SubApp 方法技能；`.agent-tools/superpowers/6.2.0` 是固定版本 fallback，并保留上游 MIT license。
- `package.json` 中仅供模板维护使用的 `release:check` script 会同步移除，避免留下失效命令。
- `pnpm run release:check` 会逐项校验 canonical `.taku-template.json` policy、用户版指南、标准 `SKILL.md` package、固定 Superpowers provenance 与 checker 内置的已审核 bundle SHA-256，以及内部负责人、issue 和内部 skill 文案没有进入 payload。额外的 exclude、cleanup、removeScripts，或只修改 bundle 并重算 payload manifest 摘要，都不会通过校验。
- Superpowers bundle 摘要使用 canonical v3 编码：目录项按 POSIX UTF-8 path bytes 排序，路径必须是 NFC 且同时满足 Windows 安全命名规则，mode 归一为 Git `040000` / `100644` / `100755`。同目录 Unicode case-fold 冲突、未知 manifest 字段和 mode 漂移都会改变或阻断审核结果。
- `release:check` 同时要求 `.nvmrc` 逐字节等于 `20.20.2` 加单个 LF、`package.json#packageManager` 精确锁定 `pnpm@10.15.1`；调整工具链时必须同步更新 checker、测试与本文档。
- 修改生成产物规则时，必须在 Desktop 仓库运行 `pnpm run test:template-payload`。

模板 ZIP 按 tag 缓存在客户端。任何 payload 变化都必须发布新的不可变 tag，禁止移动或覆盖已经发布的 tag。

---

### 1) 版本号更新

- `package.json`：`version`（本次为 `0.3.2`）
- `taku.manifest.json`：`version`（必须与 package 版本一致）
- `CHANGELOG.md`：新增对应版本段落（从 `Unreleased` 下沉）

---

### 2) 本地校验（建议）

```bash
fnm use 20.20.2
pnpm install --frozen-lockfile
pnpm run auto-fix
pnpm test
pnpm run release:check
```

---

### 3) 分支、提交 + PR

```bash
git switch -c TAKU-264-subapp-migration-workspace
git add -A
git commit -m "chore(TAKU-264): release taku-3.0.2-template"
git push -u origin TAKU-264-subapp-migration-workspace
gh pr create --base main --title "TAKU-264 Release taku-3.0.2-template"
```

`main` 是受保护分支，必须通过 PR 合并，不要直接 push。

---

### 4) 合并后创建不可变 tag

```bash
git switch main
git pull --ff-only origin main
git tag -a taku-3.0.2-template -m "taku-3.0.2-template"
git push origin refs/tags/taku-3.0.2-template
```

只推送当前目标 tag，不使用 `git push --tags`。

---

### 5) 创建 GitHub Release

#### 方式 A：GitHub Web UI

- 进入 GitHub 仓库 → Releases → Draft a new release
- Tag：`taku-3.0.2-template`
- Title：`taku-3.0.2-template`
- 勾选：**Set as the latest release**
- 取消勾选：`pre-release`（必须）
- Release notes：复制 `CHANGELOG.md` 对应段落即可

#### 方式 B：GitHub CLI（gh）

```bash
gh release create taku-3.0.2-template --title "taku-3.0.2-template" --notes "See CHANGELOG.md" --latest --verify-tag
```

> 说明：你也可以把 `CHANGELOG.md` 中对应版本段落作为 `--notes` 内容粘进去。

发布后确认 `Latest` 指向本次 Taku 3 tag：

```bash
gh api repos/Taku-OS/takuai-template-main/releases/latest --jq '.tag_name'
```
