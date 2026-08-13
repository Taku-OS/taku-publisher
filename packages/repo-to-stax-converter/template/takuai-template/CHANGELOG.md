# Changelog

## Unreleased

- **Secure-by-default surface**: 移除未认证的通用 Agent 工具入口、文件/命令工具包、通用 collection HTTP API 与客户端原始记录 Hook；保留 server-only 持久化层，并要求领域专属、认证授权的调用边界
- **Release channel**: 下线 Taku 2 模板兼容通道，GitHub `Latest` 统一指向最新 Taku 3 模板；旧 tag 仅保留为历史记录

## 0.3.2

- **Agent workspace**: 生成 SubApp 现在携带可发现的 Taku 开发、Action 契约与三级验证 skills，并为 Codex/Claude 提供一致入口
- **Pinned methodology**: 在生成 payload 中固定附带 MIT licensed Superpowers `6.2.0` fallback bundle 与版本清单，宿主没有注册对应技能时仍可复现同一工作流
- **Release safety**: release check 精确校验 payload policy、UTF-8/POSIX path 与 Git mode 归一化的 Superpowers bundle 摘要、exact provenance、内部协作信息隔离，以及 Node.js 20 / pnpm 工具链契约
- **Release channel**: Taku 3 模板固定 tag 更新为 `taku-3.0.2-template`

## 0.3.1

- **Remove legacy SubApp widgets**: 删除 `refresh/widgets` manifest 协议、widget worker/refresher 脚本和 `daily-summary` 示例；桌面小组件统一由 Taku Desktop DynamicWidget 子系统提供
- **Release channel**: Taku 3 模板固定 tag 更新为 `taku-3.0.1-template`，并让 release check 拒绝旧 SubApp widget 字段、scripts 与文件
- **Security**: 升级 Next.js、Drizzle ORM 与 PostCSS 的安全修复版本，并将 Drizzle Kit 收敛为开发依赖

## 0.3.0

- **Desktop widgets**: 新增 `refresh/widgets` manifest 声明、`daily-summary` 示例小组件和 `taku:widget-refresher` 刷新入口
- **Agent Loop tools**: 新增 `read_file` / `write_file` / `ls` / `bash` 工具，并统一通过 path sandbox、shell policy 和 shell runner 管理执行边界
- **Release channel guard**: 新增 `release:check`，阻止带 `widgets` / `refresh` 的 3.0 模板误发布到 Taku 2.0 `latest` 兼容线
- **Taku 3.0 template channel**: 发布文档改为固定 tag `taku-3.0.0-template`，`latest` 保留给 2.0 兼容模板

## 0.1.22

- **Claude-only gateway unification**: `src/lib/ai/claude-adapter.ts` + `src/lib/ai/server.ts` 统一固定走 `POST /claude/v1/messages`，模型固定为 `claude-sonnet-4-5-20250929`
- **Agent Loop template**: 新增 `src/lib/agent-loop/*` 与 `POST /api/ai/agent-loop`，提供可扩展 ReAct/工具循环基础实现（统一 ToolRegistry/ToolExecutor/EventBus）
- **Service API adapter layering**: 新增 `src/lib/service-api/nanoBananaPro.ts`，并让图片 route 与 Agent Tool 共用同一适配层（单一信源）
- **Docs refresh**: 新增 `docs/agent-loop-guide.md`，并更新 `docs/proxy-ai-guide.md`（补充 Claude 固定链路与 Agent Loop 入口）

## 0.1.21

- **Proxy base URL fixed to prod**: `@/lib/proxy` 统一固定使用 `https://ai-proxy.taku.ai`，避免模板在不同环境下 base URL 分叉
- **Upload helper (server-only)**: 新增 `proxyUpload()`（`PUT /upload/*`）能力，仅提供 helper 导出，不在模板内主动调用

## 0.1.17

- **Fix proxyJson truncation on success**: 成功路径（2xx）不再受 `maxResponseChars` 截断，避免大 JSON 响应被截断后解析失败（INVALID_JSON）；错误路径仍保留限制以防巨大错误体

## 0.1.16

- **Fix invoke/build flakiness (SQLite busy/lock)**: DB 初始化改为懒加载（`getDb()`），并设置 `busy_timeout` + `SQLITE_BUSY` 轻量重试，避免 preview/edit 并发或 build 阶段触发 sqlite 锁导致 `next build` 失败

## 0.1.15

- **Fix build (client/server split)**: `@/lib/taku-data` 默认入口改为 client-safe（只导出 `useTakuCollection` + types），服务端 DB store 迁移到 `@/lib/taku-data/server` + `server-only` 防误用，避免客户端打包引入 `better-sqlite3`
- **Fix API imports**: `/api/taku/data/*` 改为从 `@/lib/taku-data/server` 导入（明确服务端边界）
- **Turbopack stability**: 固定 `turbopack.root`，避免多 lockfile 场景 workspace root 误判导致 build “卡住/巨慢”
- **DB diagnostics**: 启动/构建期间打印 `[TAKUAI-DB] dbFile=...`，便于排查是否出现“双库/路径漂移”

## 0.1.14

- **Data (single source of truth)**: 新增通用 SQLite collection store（`taku_items`）+ REST API（`/api/taku/data/*`）+ UI Hook（`useTakuCollection()`），确保宿主 Action 与 SubApp UI 数据同源
- **DB path**: 默认数据库路径调整为 `./.taku/data/db.sqlite`（可用 `DB_FILE_NAME` 覆盖），避免污染项目根目录
- **Docs**: 补充 Action/UI 数据同源原则说明（避免 split-brain）

## 0.1.12

- **Release**: refresh template release (bump version + publish new GitHub Latest Release)

## 0.1.11

- **Maintenance**: 同步最新 Taku 宿主运行时契约与内部桥接约束（保持向后兼容）
- **Docs**: 补充/修订 ai-proxy 调用规范与常见错误处理（401/402/超时等）

## 0.1.10

- **Proxy base module (server-only)**: 新增 `src/lib/proxy/*` 作为 SubApp 唯一的 ai-proxy 调用基建（统一鉴权 Bearer、计费归因 `X-App-Id`、错误模型、SSE 透传）
- **AI domain layer + gateway**: 新增 `src/lib/ai/*`（AI 领域封装）与 `POST /api/ai/completion`（前端调用入口，支持 JSON/SSE）
- **Image generation gateway**: 新增 `POST /api/ai/image/generate`（模板内置文生图网关；服务端通过 `/service/*` 调用并返回稳定的 `imageUrl/imageUrls`）
- **Remove duplicated service-api module**: 删除 `src/lib/service-api/*`（不再维护同功能多套实现；只保留第一性原则代码）
- **Single source env**: 只读取 `TAKU_SERVICE_API_BASE_URL`（不再使用/兼容 `TAKU_AI_PROXY_BASE_URL`）

## 0.1.9

- **Remove AI SDK framework deps**: 移除 `ai` / `@ai-sdk/*` 依赖（subapp 不走框架；统一走宿主 proxy）

## 0.1.8

- **Service API token sync (host → subapp)**: 支持宿主在运行时推送最新 Supabase access token（解决 1h 过期；HMR 更稳定）
- **Internal actions hardening**: 内部动作 `__taku_internal:*` 不再出现在公开 action 列表，且禁止通过 `/api/actions/*` 直接调用
- **Template cleanup**: 移除误导性的 `TAKU_API_KEY` 示例客户端与文档（subapp 应走宿主注入的 Service API 鉴权）

## 0.1.6

- **pnpm only + reproducible installs**: add `pnpm-lock.yaml`, use `pnpm install --frozen-lockfile`
- **pnpm v10 port args fix**: `start:edit/start:preview` now pass `-p <port>` without forwarding a stray `--` to Next.js
- **remove legacy + runtime artifacts**: delete `scripts/start-full.js`, remove & ignore `db.sqlite*`
- **native deps build allowlist**: add `pnpm.onlyBuiltDependencies` for `better-sqlite3` / `esbuild` / `sharp`

## 0.1.5

- **内置 `__taku` 宿主桥**：新增 `src/__taku/TakuBridgeClient.tsx` 与 `src/__taku/TakuDesignModeOverrides.ts`，并在 `src/app/layout.tsx` 默认挂载 `<TakuBridgeClient />`（支持 host navigation + Design Mode）
- **最小 UI Kit 补齐**：新增 `src/components/ui/badge.tsx`（带 `data-slot`），避免 demo/模板因组件缺失导致 build 失败

## 0.1.3

- **Prod/Dev 输出隔离**：preview/edit 分别使用 `.next-preview` / `.next-edit`，避免 dev 覆盖 prod 产物
- **启动稳定性增强**：start 脚本在子进程提前退出时快速失败，并在 READY 后异常退出时向上冒泡
- **Client actions 桥（占位）**：提供 `client_postmessage` 的前端执行入口与注释指引（默认不内置具体业务 action）

## 0.1.2

- **Taku runtime split**: add `start:preview` (prod) + `start:edit` (dev/HMR)
- **No Drizzle Studio by default**: remove auto studio startup to keep launch fast
- **READY markers v2**: emit `[TAKUAI-READY] kind:<preview|edit>,port:<p>,url:<...>` for Taku to detect readiness
