# 三仓联动：GitHub Repo 转换为 Taku SubApp

这套流程由三个仓库共同定义：

- [`repo-to-stax-converter`](https://github.com/Taku-OS/repo-to-stax-converter)：冻结输入、生成 Agent 工作区并验证迁移结果。
- [`takuai-template-main`](https://github.com/Taku-OS/takuai-template-main)：定义 SubApp 的目标结构、运行脚本、Bridge、Host RPC 和 Agent Skills。
- [`taku`](https://github.com/Taku-OS/taku)：提供最终的 Desktop Host、应用生命周期和 Action/manifest 权限边界。

Converter 的命令只直接接收源码仓和 Template；Desktop 不作为 CLI 参数传入，而是最终的 Host 合约与运行环境。

## 1. 准备三个仓库

使用 Node 20 和仓库锁定的 pnpm，拉取三个仓库的最新 `main`，建议放在相邻目录：

```text
workspace/
├── repo-to-stax-converter/
├── takuai-template-main/
└── taku/
```

先验证 Template，再构建 Converter：

```bash
cd /absolute/path/to/takuai-template-main
corepack pnpm install --frozen-lockfile
corepack pnpm run release:check

cd /absolute/path/to/repo-to-stax-converter
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

## 2. 生成迁移工作区

远程源码应传入明确的 40 位 commit，避免转换期间分支漂移：

```bash
cd /absolute/path/to/repo-to-stax-converter
node dist/index.js convert OWNER/REPO \
  --source-ref <40-character-source-commit> \
  --template /absolute/path/to/takuai-template-main \
  --out /absolute/path/to/conversions \
  --name my-subapp
```

Agent 只在生成的 `my-subapp/` 工作区里继续迁移。开始前依次阅读：

- `AGENTS.md`
- `.agents/skills/complete-repo-migration/SKILL.md`
- `STAX_CONVERSION_PLAN.md`
- `.taku/migration.json`

`upstream-source/` 只用于对照，不要原地修改。Agent 需要替换占位页面、迁移真实产品流程、补产品测试，并把证据和缺失上下文记入 `SUBAGENT_EXPERIENCE.md`。

## 3. 验证并交给 Desktop Host

先在 Converter 侧检查工作区和转换完成度：

```bash
node /absolute/path/to/repo-to-stax-converter/dist/index.js validate \
  /absolute/path/to/conversions/my-subapp --level workspace
node /absolute/path/to/repo-to-stax-converter/dist/index.js validate \
  /absolute/path/to/conversions/my-subapp --level conversion
```

再在一次性、受信任的沙箱里运行候选项目的安装、测试、类型检查、lint 和构建；不要在开发机 Host 上直接执行不可信仓库脚本。

生成结果应保留 Desktop 所依赖的 `taku.manifest.json`、manifest/RPC 路由以及 `start:edit`、`start:preview` 脚本。Converter 不会写 Desktop 的应用数据库，也不会绕过 `app_create` / `app_finish` 生命周期；它产出的是可交给 Taku Agent 继续处理的项目工作区，不是已经发布的 SubApp。

## 合约变更时怎么联动

1. Template 的 ABI、脚本或 Skills 变化：先通过 Template 的 `release:check`，再重建 Converter 并运行 canonical-template smoke，最后验证 Desktop 的模板与 Action/manifest 合约。
2. Converter 的生成或验证规则变化：运行 Converter 全量测试和 canonical-template smoke。
3. Desktop 的 Host、manifest 或 Action 权限边界变化：同步检查 Template 与 Converter 的固定合约、哈希和测试，三仓一起更新。
4. `workspace`、`conversion`、`publish` 是递进门槛；本地 Converter 没有 Taku 服务端发布权限，通过前两级不代表可以发布。
