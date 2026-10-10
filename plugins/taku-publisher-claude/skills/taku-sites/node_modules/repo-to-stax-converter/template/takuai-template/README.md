# Taku App Template

基于 Next.js 15 + TypeScript + Tailwind CSS + Drizzle ORM 的应用启动模板。

## 与 Taku 的运行态协议（重要）

本模板用于由 **Taku Desktop** 启动 Taku App（preview/edit 双运行态并存）。产品名称统一使用 **Taku App**；已有 `subapp` 文件路径、Skill ID 和宿主内部标识保持兼容，不按产品改名重命名。

- **Preview（Prod）**：`pnpm run start:preview`
  - 行为：若缺 build 则先 `pnpm run build`，随后 `next start`
  - **不启动 Drizzle Studio**
- **Edit（Dev/HMR）**：`pnpm run start:edit`
  - 行为：`next dev`（HMR）
  - **不启动 Drizzle Studio**

Taku 通过日志 marker 判定 READY（不要删除）：

- `"[TAKUAI-READY] kind:preview,port:3000,url:http://127.0.0.1:3000"`
- `"[TAKUAI-READY] kind:edit,port:3001,url:http://127.0.0.1:3001"`

端口由 Taku 注入：

- `DEV_PORT`（优先）
- `PORT`

## 快速开始

```bash
pnpm install              # 安装依赖
pnpm drizzle-kit push      # 初始化数据库
pnpm run dev              # 启动开发服务器 (localhost:3000)
```

## UI 组件（重要）

- 仅复用 `src/components/ui/` 已存在的 primitives；不要假设存在完整的 `@/components/ui/*`。
- 缺失的交互组件（Select/Tabs/Dialog 等）请直接使用 Radix primitives 或原生 HTML + Tailwind。

## 开发指南

详见 [CLAUDE.md](./CLAUDE.md)

## 托管 AI 与多模态

通过 [Taku App Host Agent Runtime](docs/subapp-agent-runtime.md) 的 `@/lib/taku-runtime` 调用通用 Agent、报告、文生图和文生视频。应用只传任务输入，不持有模型密钥，也不选择供应商或模型；当前可用能力和参数以 Desktop 返回的已认证能力目录为准。

默认模板不申请 AI 权限。Planner/Builder 根据应用实际用途添加 `runtimeCapabilities`，再由 Host 验证授权；模板 SDK 存在不代表目标 Desktop 或生产账号已经通过端到端验收。

## License

MIT
