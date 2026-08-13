# CLAUDE.md

本文件为Coding Agent提供项目开发指导。

## Linear 项目归属

- 本仓库归 `Taku Desktop`，负责人为 haipro。
- 正式 SubApp 模板及其 runtime/build contract 都是 Desktop 范围，不单独建立模板 Linear 项目。
- 如任务包含 TAKU issue ID，编码前先读取 issue，交付前回写实现和验证结果。
- 完成并验证后的工作停在 `In Review`，默认由 haipro 审核。只有 `haipro` 或 `Jacky` 能针对具体 issue 明确批准 `Done`；agent 代为切换时必须在 comment 中记录审批人。

## 模板产物边界

- 根目录的 `AGENTS.md`、`CLAUDE.md`、`skills.md`、`.agents` 与 `.claude` 用于维护本模板仓库，不得进入用户创建的 SubApp。
- `.taku-template.json` 声明需要移除的仓库文件，并将 `.taku-template/payload/` 中的用户版指南覆盖到生成项目。
- 用户版指南只保留通用 SubApp 技术、质量与安全约束，不得包含内部 Linear 项目、负责人、issue 或完成审批规则。
- 修改该边界后运行模板 `pnpm run release:check` 和 Desktop `pnpm run test:template-payload`。

## 技术栈

- **框架**: Next.js 15.5 (App Router) + React 19 + TypeScript
- **样式**: Tailwind CSS 4.0
- **数据库**: SQLite + Drizzle ORM
- **UI**:
  - UI 搜索参考资产（若存在）：优先参考导入到 `design/ui-inspiration/` 的候选样式（布局/间距/排版/交互模式）
  - Magic UI 风格优先（条件）：若项目已包含本地 Magic UI 风格组件（例如 `src/components/magicui/`），优先用于更好看的布局/动效
    - 注意：模板默认不内置 Magic UI 组件；需要时请将相关实现以本地组件形式导入到项目（例如 `src/components/magicui/`），不要依赖外部 CLI
  - 交互组件：优先直接使用 Radix UI primitives（本模板已包含 `@radix-ui/*` 依赖）
  - 基础封装：本地 UI primitives 位于 `src/components/ui/`（只保证少量基础组件存在）
- **图标**: Lucide Icons
- **格式化**: Biome (代码格式化 + Lint)

## 核心命令

### 开发服务器
```bash
pnpm run dev                    # 启动开发服务器 (端口 3000)
pnpm run dev -p 3001            # 自定义端口
pnpm run build                  # 构建生产版本
pnpm run start                  # 启动生产服务器
```

### 代码质量
```bash
pnpm run check                  # 格式化 + lint (推荐)
pnpm run type-check             # TypeScript 类型检查
pnpm run lint                   # 仅运行 lint
pnpm run format                 # 仅格式化代码
```

### 数据库操作
```bash
pnpm drizzle-kit push           # 应用 schema 变更 (开发推荐)
pnpm drizzle-kit generate       # 生成迁移文件 (生产推荐)
pnpm drizzle-kit studio         # 可视化数据库管理
rm db.sqlite && pnpm drizzle-kit push  # 重置数据库
```

### UI 组件（重要）
- 项目只内置少量 `src/components/ui/*`（例如 button/input/card/label/badge）。
- 禁止假设存在完整的 `@/components/ui/*` 组件集合（例如 `@/components/ui/select` 可能不存在）。
- 若需要 Select/Tabs/Dialog 等交互：
  - 优先直接使用 Radix UI primitives（本模板已包含 `@radix-ui/*` 依赖），或
  - 使用原生 HTML + Tailwind。
- Magic UI 优先（条件）：
  - 若项目已经存在 `src/components/magicui/`（或类似目录），优先复用这些组件实现更好看的布局/动效
  - 不要假设它一定存在；先检查本地文件再导入
- 不要依赖外部代码生成 CLI（例如通过 `npx` 拉组件）；在 Taku 环境里可能不可用或导致不稳定。

## 项目结构

```
src/
├── app/                 # Next.js App Router
│   ├── layout.tsx       # 根布局
│   ├── page.tsx         # 首页
│   ├── loading.tsx      # 加载状态
│   ├── globals.css      # 全局样式
│   └── api/             # API 路由
├── components/
│   └── ui/              # 本地 UI primitives（最小集合；不要假设齐全）
├── db/
│   ├── schema.ts        # 数据表结构定义
│   ├── index.ts         # 数据库连接配置
│   └── example.ts       # 使用示例
└── lib/
    └── utils.ts         # 工具函数 (cn)
```

## 开发规范

### TypeScript
- 严格模式，禁止使用 `any` 类型
- 所有函数和组件必须有类型定义

### 组件开发
- 优先复用 `src/components/ui/` 已存在的 primitives（只导入真实存在的文件）
- 若缺少某个 UI wrapper：不要“猜” `@/components/ui/*`，也不要引入新的 UI kit
  - 直接在业务组件内使用 Radix primitives，或用原生 HTML + Tailwind 实现
- 若确需抽象为可复用组件：新增到 `src/components/ui/`，并保持最小依赖、风格一致
- 使用 `cn()` 函数处理条件 CSS 类名
- 图标使用 Lucide Icons
- 组件放置在 `src/components/` 目录

### data-slot 属性规范

生成或修改 UI 组件时，**必须添加 `data-slot` 属性**用于元素识别：

```tsx
// 正确：添加 data-slot
<Button data-slot="button">Click</Button>
<Card data-slot="card">...</Card>
<Input data-slot="input" />

// 错误：缺少 data-slot
<Button>Click</Button>
```

**常用 data-slot 值**：

| 组件 | data-slot 值 |
|------|-------------|
| Button | `button` |
| Card | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` |
| Input | `input` |
| Label | `label` |
| Dialog | `dialog`, `dialog-content`, `dialog-header`, `dialog-title`, `dialog-description`, `dialog-footer` |
| Select | `select`, `select-trigger`, `select-content`, `select-item` |
| Tabs | `tabs`, `tabs-list`, `tabs-trigger`, `tabs-content` |
| 其他组件 | 按组件名小写命名，子组件用 `组件名-子组件名` |

**规则**：所有交互式元素和容器组件都需要 data-slot 属性。

#### Design Mode 写回源码（Phase 3）额外约束（非常重要）

Taku 的 Design Mode 在“应用/写回源码（apply）”时，会通过 **搜索 TSX/JSX 源码中的 `data-slot="<slot>"`** 来定位目标节点并做最小 diff 修改。
因此你必须遵守：

- **必须是静态字面量**：`data-slot` 的值必须是 TSX/JSX 里的**静态字符串**（不能是变量、不能是模板字符串、不能运行时拼接）。
- **必须能唯一定位**：同一个 slot 不能同时出现在多个文件里，也不能在同一文件出现多次，否则会报：
  - `slot="<slot>" is not unique (found in multiple files)`
  - `Multiple occurrences found for slot="<slot>" in the same file`

#### 推荐：用“语义化 + 实例级”的 data-slot 命名（避免冲突）

模板里的 UI primitives（例如 `src/components/ui/button.tsx`）通常会带一个通用的 `data-slot="button"` 作为兜底。
但**页面/功能层如果还写 `data-slot="button"`**，就会导致 apply 阶段冲突（多个文件命中），也会导致“写回”改错文件。

因此在页面/feature 层，建议为每个“真实实例”使用更具体的 slot（仍然保留 kind 前缀，方便面板识别）：

- Button：`button-roll`、`button-retry`、`button-submit`
- Card：`card-movie`、`card-result`
- Text：`text-title`、`text-subtitle`

> 列表/重复渲染场景：不要试图用动态 slot（不支持写回）。要么编辑共享组件定义，要么拆成多个静态 slot 的区块。

### 数据库开发
1. 在 `src/db/schema.ts` 定义表结构
2. 运行 `npx drizzle-kit push` 应用变更
3. 使用 Drizzle 查询构建器进行数据操作

### 代码提交
- 提交前运行 `pnpm run check` 确保代码质量
- Git 提交时会自动触发 Biome 格式化

## 常见操作

### 添加新页面
在 `src/app/[path]/page.tsx` 创建文件

### 添加数据表
```typescript
// src/db/schema.ts
export const newTable = sqliteTable('new_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});
```
然后运行 `npx drizzle-kit push`

### 添加 API 路由
```typescript
// src/app/api/[resource]/route.ts
import { db } from '@/db';

export async function GET() {
  const data = await db.select().from(tableName);
  return Response.json(data);
}
```

### 添加 UI 组件
- 不要运行外部 CLI 来拉 UI 组件（例如 `npx ... add`）。
- 如果只是当前页面需要：直接在 feature 组件内使用 Radix primitives 或原生 HTML + Tailwind。
- 如果需要复用：在 `src/components/ui/` 新增组件文件，并保持：
  - `data-slot` 必须落到真实 DOM 节点（props 要透传）
  - `className` 使用 `cn()` 合并
  - 避免引入大量额外依赖

## SubApp Action 规范

SubApp 通过 Action 机制与 Taku AIOS (Sommelier Agent) 交互，使 AI 能够操作用户创建的应用。

### 桌面小组件边界

桌面小组件由 Taku Desktop 的 DynamicWidget 子系统创建和运行，不属于 SubApp 模板契约。

- 不要在 `taku.manifest.json` 中添加根级 `widgets` 或 widget 专用 `refresh` 字段。
- 不要在 SubApp 中创建 `taku:widget-worker`、`taku:widget-refresher` 脚本或 `src/taku/widgets/*` 注册表。
- 用户需要桌面小组件时，由 Taku Desktop 在宿主侧创建 DynamicWidget；SubApp 只维护自己的页面、Actions、数据和 API。
- 普通 iframe、浮窗或窄容器页面仍应采用容器优先布局，但它们不是桌面小组件协议。

### 能力声明 (`taku.manifest.json`)

在项目根目录创建 `taku.manifest.json` 声明 SubApp 的可调用 actions：

```json
{
  "name": "my-app",
  "description": "我的应用",
  "actions": [
    {
      "name": "play",
      "description": "播放指定歌曲",
      "params": {
        "song": { "type": "string", "required": true, "description": "歌曲名称" }
      }
    }
  ]
}
```

### Action 实现

1. 在 `src/actions/` 目录创建 action 文件
2. 使用 `registerAction()` 注册 handler
3. 在 `src/actions/index.ts` 中导入

```typescript
// src/actions/music.ts
import { registerAction } from '@/lib/actions';

registerAction(
  {
    name: 'play',
    description: '播放指定歌曲',
    params: {
      song: { type: 'string', required: true, description: '歌曲名称' }
    }
  },
  async ({ song }) => {
    // 执行播放逻辑...
    return { success: true, message: `正在播放: ${song}` };
  }
);
```

### Action 调用边界

The manifest is the sole Host Action catalog。Taku Desktop 只通过 fail-closed 的 Host RPC 调用已声明 Action；不要生成公开 Action catalog、通用 Action executor 或 browser 可访问的特权 route。

`TAKU_CONTROL_TOKEN` 只证明本机 Host transport。The control token is not user identity, app ownership, entitlement, or billing authority. 真实 Taku-controlled server authority contract 缺失时，managed/external write 必须在 UI 与 Action 中保持 visibly blocked。

Browser mutation remains blocked until that real server authority exists；`Server Action`、`server-only` 或本地环境变量都不能替代认证与授权。

### 返回格式

```typescript
interface ActionResult {
  success: boolean;
  data?: unknown;      // 返回数据
  message?: string;    // 用户友好的消息
  error?: string;      // 错误信息（失败时）
}
```

> 📖 详细文档：[SubApp Action 架构](docs/subapp-action-architecture.md)

## 环境变量

```env
# 数据库 (必需)
DB_FILE_NAME=db.sqlite

# AI 能力（可选）
# - 本模板不内置 AI SDK 框架；如需 AI 能力，必须通过模板内置的 `@/lib/proxy`（server-only）调用宿主注入的 ai-proxy
# - 不要在 SubApp 内直接持有/配置模型厂商 Key（Claude/Gemini/OpenAI 等）
# - 运行在 Taku 宿主内时，会注入以下关键环境变量（不要要求用户手动配置）：
#   - TAKU_SERVICE_API_BASE_URL：ai-proxy 根地址
#   - TAKU_SERVICE_API_KEY：Supabase access token（Bearer）
#   - TAKU_APPLICATION_ID：用于计费归因（X-App-Id）
```

## AI / Proxy 开发规范（必读）

- 统一入口：`docs/proxy-ai-guide.md`
- server-only 不等于已授权；不要向 browser 暴露通用 AI / Service gateway。
- 只有真实 Taku 服务端 authority contract 完成身份、应用、资源、权限和计费归因验证后，领域 operation 才能调用 managed service；否则功能必须明确 blocked。

## 配置文件

| 文件 | 说明 |
|------|------|
| `biome.json` | Biome 格式化和 lint 规则 |
| `drizzle.config.ts` | Drizzle ORM 配置 |
| `components.json` | shadcn/ui 配置 |
| `tailwind.config.js` | Tailwind CSS 配置 |

---

> **原则**: 保持简洁，按需扩展。不要过度设计，只做必要的实现。
