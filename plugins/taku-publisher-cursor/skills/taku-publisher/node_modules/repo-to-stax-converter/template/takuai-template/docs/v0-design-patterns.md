# V0 设计模式分析与 Taku 项目对比

本文档分析 V0 生成项目的设计规范，以及 Taku 项目的实施状态。

---

## 1. 可视化编辑的核心：`data-slot` 属性

### V0 的实现

V0 的每个 UI 组件都添加了 `data-slot` 属性，用于标识元素类型：

```tsx
// V0 的 button.tsx
<Comp data-slot="button" className={...} {...props} />

// V0 的 card.tsx
<div data-slot="card" className={...} {...props} />
<div data-slot="card-header" className={...} {...props} />
```

### 作用

V0 编辑器通过 `data-slot` 属性实现：
1. **元素识别** - 点击元素时知道是什么类型（button/card/input 等）
2. **属性面板匹配** - 显示对应的可编辑属性（Typography/Color/Layout 等）
3. **样式约束** - 知道哪些样式可以修改，哪些不能

### Taku 实施策略 ✅

**策略**：在 CLAUDE.md 中添加规则，让 AI 生成组件时自动添加 data-slot

**原因**：
- 上层可能会导入 UI 灵感参考资产（例如 `design/ui-inspiration/`），执行层需要先读取并参考
- 组件会被 AI 直接生成/改写，因此必须强制 data-slot 以保证可视化编辑可定位
- 模板仅提供最小 UI primitives 集合，不能假设 `@/components/ui/*` 完整存在

**已实施**：CLAUDE.md 中已添加 data-slot 生成规范

---

## 2. data-slot 常用值参考表

| 组件 | data-slot 值 |
|------|-------------|
| Button | `button` |
| Card | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` |
| Input | `input` |
| Label | `label` |
| Dialog | `dialog`, `dialog-content`, `dialog-header`, `dialog-title`, `dialog-description`, `dialog-footer` |
| Select | `select`, `select-trigger`, `select-content`, `select-item` |
| Tabs | `tabs`, `tabs-list`, `tabs-trigger`, `tabs-content` |
| Form | `form`, `form-field`, `form-label`, `form-control`, `form-message` |
| Table | `table`, `table-header`, `table-body`, `table-row`, `table-cell` |
| Sheet | `sheet`, `sheet-trigger`, `sheet-content`, `sheet-header`, `sheet-title` |
| Popover | `popover`, `popover-trigger`, `popover-content` |
| Dropdown | `dropdown-menu`, `dropdown-trigger`, `dropdown-content`, `dropdown-item` |

**规则**：按组件名小写命名，子组件用 `组件名-子组件名` 格式

---

## 3. CSS 变量系统

### Taku 当前状态 ✅

已使用 **oklch 颜色空间**，包含完整的语义化变量：

```css
:root {
  /* 基础颜色 */
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --secondary: oklch(0.967 0.001 286.375);
  --muted: oklch(0.967 0.001 286.375);
  --accent: oklch(0.967 0.001 286.375);
  --destructive: oklch(0.577 0.245 27.325);
  
  /* Chart 颜色 */
  --chart-1 ~ --chart-5
  
  /* Sidebar 变量 */
  --sidebar, --sidebar-foreground, --sidebar-primary...
  
  /* Radius 系列 */
  --radius-sm, --radius-md, --radius-lg, --radius-xl
}
```

---

## 4. Button Variants

### Taku 当前状态 ✅

已实现完整的 variants，包括图标按钮 sizes：

```tsx
size: {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3",
  lg: "h-10 px-6",
  icon: "size-9",       // ✅ 已实现
  "icon-sm": "size-8",  // ✅ 已实现
  "icon-lg": "size-10", // ✅ 已实现
}
```

---

## 5. 字体配置

### Taku 的选择 ✅

**使用 Inter 字体**，不切换到 Geist：

```tsx
// ✅ 推荐：使用本地系统字体栈（无外网依赖；next build 不会请求 Google Fonts）
// 直接在全局 CSS / Tailwind 里配置 font-family 即可（详见 src/app/globals.css 的 --taku-font-*）
```

**选择理由**：
- 广泛使用，兼容性好（Linear、Vercel Dashboard、Figma 等）
- 出色的可读性和中英文混排
- 丰富的字重变体（100-900）

---

## 6. 主题切换

### Taku 的决定 ❌

**不实现** - Taku 项目不需要主题切换功能，保持单一主题。

---

## 7. 实施状态总结

| 特性 | V0 | Taku | 状态 |
|------|-----|------|------|
| `data-slot` 规范 | ✅ 预置在组件 | ✅ AI 生成时添加 | ✅ 已实施 |
| 颜色空间 | oklch | oklch | ✅ 已实施 |
| @theme inline | ✅ 完整 | ✅ 完整 | ✅ 已实施 |
| Button icon sizes | ✅ 3种 | ✅ 3种 | ✅ 已实施 |
| 字体 | Geist | Inter | ✅ 保持 Inter |
| 主题切换 | ✅ next-themes | ❌ 不需要 | ❌ 不实施 |
| CSS 变量 | ~40个 | ~40个 | ✅ 已实施 |

---

## 8. AI 生成组件示例

根据 CLAUDE.md 规范，AI 生成的组件应该是这样的：

```tsx
// ✅ 正确的生成方式
<Button data-slot="button" variant="default">
  Click me
</Button>

<Card data-slot="card">
  <CardHeader data-slot="card-header">
    <CardTitle data-slot="card-title">Title</CardTitle>
  </CardHeader>
  <CardContent data-slot="card-content">
    Content here
  </CardContent>
</Card>

<Dialog>
  <DialogContent data-slot="dialog-content">
    <DialogHeader data-slot="dialog-header">
      <DialogTitle data-slot="dialog-title">Dialog Title</DialogTitle>
    </DialogHeader>
  </DialogContent>
</Dialog>
```

---

> 本文档基于 V0 生成的 music-player 项目分析，记录 Taku Template 的设计决策和实施状态。
> 
> 最后更新：已完成所有必要的适配工作。
