# Taku SubApp Development Guide

本文件用于指导在用户创建的独立 SubApp 中进行开发。

## 项目定位

- 本项目运行在 Taku 宿主中，同时保持为可独立开发和构建的 Next.js 应用。
- 修改前先阅读 `taku.manifest.json`、`package.json` 和相关源码，保留已有产品行为与宿主契约。
- 只围绕当前用户目标修改，不把模板仓库、发布流程或团队协作配置带入应用。

## 技术栈

- Node.js 20；包管理器及版本以 `package.json` 的 `packageManager` 为准。
- Next.js 15 App Router、React 19、TypeScript 严格模式。
- Tailwind CSS 4 用于样式。
- Radix UI primitives 用于复杂交互，本地基础组件位于 `src/components/ui/`。
- Lucide Icons 用于界面图标。
- SQLite 与 Drizzle 用于本地结构化数据。
- Biome 用于格式化和静态检查。

## 常用命令

```bash
pnpm run dev
pnpm run build
pnpm run type-check
pnpm run lint
pnpm run format:check
```

在交付前至少运行与改动相关的检查；涉及公共类型、路由或构建契约时，同时运行类型检查和生产构建。

## 项目结构

```text
src/
├── __taku/             # 宿主桥接与设计模式支持
├── actions/            # 可由宿主调用的应用动作
├── app/                # Next.js 页面、布局和 Route Handlers
├── components/         # 产品组件与本地 UI primitives
├── db/                 # Drizzle schema 与数据访问
└── lib/                # 通用业务和运行时能力
```

## 宿主契约

- 不删除或绕过 `src/__taku/`。
- 保持 `src/app/layout.tsx` 中的 Taku bridge 正常挂载。
- 应用名称、描述、图标、动作等能力以 `taku.manifest.json` 为准。
- 新增可调用动作时，在 `src/actions/` 中实现并通过既有 registry 注册，参数和返回值必须有明确类型。
- 不自行实现宿主已经提供的生命周期、设计模式或服务鉴权能力。
- The manifest is the sole Host Action catalog；Host 只通过 fail-closed 的 `/__taku/rpc` 调用已声明 Action，不建立公开 Action catalog 或 executor。
- TAKU_CONTROL_TOKEN is only a local Host transport capability. The control token is not user identity, app ownership, entitlement, or billing authority.
- Without a real, versioned Taku-controlled server authority contract, managed/external writes stay visibly blocked and browser mutation remains blocked. `Server Action` 与 `server-only` 不是认证边界。

## 组件与界面

- 先复用真实存在的本地组件；缺少封装时可直接使用 Radix primitives 或原生 HTML。
- 不假设存在完整的组件库，也不要依赖临时外部代码生成命令。
- 图标优先使用 Lucide，不手写可由标准图标表达的 SVG。
- 组件使用清晰、稳定的 `data-slot`，以支持设计模式识别。
- 完成主要流程所需的 loading、empty、error、disabled 和 retry 状态。
- 使用明确的响应式约束，确保长文本、按钮和固定比例元素在不同尺寸下不重叠。
- 面向工具或工作流的页面应优先清晰、紧凑和高效；面向内容的页面再根据主题增强视觉表达。

## 数据与服务

- 浏览器端不得直接持有模型或第三方服务密钥。
- 不向 browser 暴露公开 Action/AI gateway、通用 proxy、collection、upload、filesystem、shell 或 tool route。
- AI、托管服务、第三方账户、共享资源与计费能力只能在真实 Taku 服务端 authority 已验证 user、app、resource、operation、entitlement 和 usage attribution 后调用；契约缺失时保持 blocked。
- 宿主注入的 service URL、token、application ID 与其他本地环境值只是运行时输入，不能单独证明业务授权，也不得要求用户手动填写。
- Host Action 可以通过认证的本地 RPC 修改 app-private 本地数据；browser 发起的 durable write 在真实服务端 authority 出现前保持 blocked。
- 外部服务失败时返回真实、可理解的错误，不伪造成功数据。
- 本地数据库变更需要同步更新 schema、调用代码与必要的迁移或初始化逻辑。

## TypeScript 与代码质量

- 避免 `any`；优先使用明确类型、联合类型和运行时校验。
- 保持模块职责单一，复用现有 helper，避免为一次性逻辑建立多余抽象。
- 注释只解释不直观的约束、兼容原因或安全边界。
- 不提交 `.env`、token、cookie、本地数据库、构建产物、运行日志或缓存目录。

## 验证

- 使用 `.claude/skills/using-superpowers/SKILL.md` 选择匹配的方法技能。
- **workspace** gate 检查模板运行时、来源/署名（如有）、安全文件边界、依赖与 Agent 交接材料。
- **conversion** gate 检查真实产品流程、Action/manifest 一致性、持久化同源、托管服务与失败路径。
- **publish** gate 增加生产构建、宿主/runtime smoke、license/风险复核和 secret 扫描。
- repo-derived workspace 的安装、测试、构建和 runtime 命令只能在一次性 Taku-managed sandbox 中执行；provenance/runtime attestation 必须由 trusted runner 提供，不能由工作空间自证。
- 功能改动需要覆盖主要成功路径和关键失败路径。
- UI 改动需要检查窄屏和宽屏布局、文本溢出、交互状态与控制台错误。
- 宿主契约改动需要确认 manifest、bridge、action registry 和生产构建保持一致。
- 交付说明记录用户可感知的结果、运行过的检查以及仍存在的风险。
- 通过 workspace 或 conversion 不代表通过 publish；存在未迁移核心能力、未知 license、未解决高风险或缺少真实运行证据时必须明确阻断发布。
