# TakuAI Template

基于 Next.js 15 + TypeScript + Tailwind CSS + Drizzle ORM 的应用启动模板。

## 与 Taku 的运行态协议（重要）

本模板用于被 **Taku Desktop** 作为 Application 启动（preview/edit 双运行态并存）：

- **Preview（Prod）**：`pnpm run start:preview`
  - 行为：若缺 build 则先 `pnpm run build`，随后 `next start`
  - **不启动 Drizzle Studio**
- **Edit（Dev/HMR）**：`pnpm run start:edit`
  - 行为：`next dev`（HMR）
  - **不启动 Drizzle Studio**

Taku 通过日志 marker 判定 READY（不要删除）：

- `"[TAKUAI-READY] kind:preview,port:3000,url:http://localhost:3000"`
- `"[TAKUAI-READY] kind:edit,port:3001,url:http://localhost:3001"`

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

## License

MIT
