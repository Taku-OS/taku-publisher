# TakuAI Design Mode 架构设计文档

## 概述

Design Mode 是 TakuAI 的核心功能之一，允许用户通过可视化界面直接修改页面元素的样式，无需手写代码。类似 V0、Figma 等设计工具的编辑体验。

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      TakuAI Electron 主应用                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  属性面板 UI  │    │  代码编辑器   │    │   文件管理    │      │
│  │  (React)     │    │  (Monaco)    │    │   (Node.js)  │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┼───────────────────┘               │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │   Design Engine  │                          │
│                    │  (核心引擎)       │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────┐        │
│  │                    IPC Bridge                        │        │
│  └──────────────────────────┬──────────────────────────┘        │
│                             │                                    │
├─────────────────────────────┼────────────────────────────────────┤
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────┐        │
│  │                     WebView                          │        │
│  │  ┌─────────────────────────────────────────────┐    │        │
│  │  │              用户项目 (Next.js)              │    │        │
│  │  │                                              │    │        │
│  │  │   ┌─────────────────────────────────────┐   │    │        │
│  │  │   │        Design Mode 注入脚本          │   │    │        │
│  │  │   │   - 元素选择                         │   │    │        │
│  │  │   │   - 高亮显示                         │   │    │        │
│  │  │   │   - 样式读取                         │   │    │        │
│  │  │   │   - 实时预览                         │   │    │        │
│  │  │   └─────────────────────────────────────┘   │    │        │
│  │  │                                              │    │        │
│  │  └─────────────────────────────────────────────┘    │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块设计

### 2.1 元素选择系统

**功能**：在 WebView 中监听用户点击，识别并选中元素。

```typescript
// design-mode-injector.ts - 注入到 WebView 的脚本

interface SelectedElement {
  element: HTMLElement;
  dataSlot: string;
  rect: DOMRect;
  computedStyles: CSSStyleDeclaration;
  classList: string[];
}

class ElementSelector {
  private selectedElement: SelectedElement | null = null;
  private highlightOverlay: HTMLDivElement;

  constructor() {
    this.highlightOverlay = this.createHighlightOverlay();
    this.attachEventListeners();
  }

  private attachEventListeners() {
    document.addEventListener('click', (e) => {
      if (!this.isDesignModeEnabled()) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const target = e.target as HTMLElement;
      const dataSlot = this.findDataSlot(target);
      
      if (dataSlot) {
        this.selectElement(target, dataSlot);
      }
    }, true);
  }

  private findDataSlot(element: HTMLElement): string | null {
    // 向上查找最近的 data-slot 元素
    let current: HTMLElement | null = element;
    while (current) {
      if (current.dataset.slot) {
        return current.dataset.slot;
      }
      current = current.parentElement;
    }
    return null;
  }

  private selectElement(element: HTMLElement, dataSlot: string) {
    const rect = element.getBoundingClientRect();
    const computedStyles = window.getComputedStyle(element);
    
    this.selectedElement = {
      element,
      dataSlot,
      rect,
      computedStyles,
      classList: Array.from(element.classList),
    };

    this.showHighlight(rect);
    this.sendToMain(this.selectedElement);
  }

  private sendToMain(selected: SelectedElement) {
    // 通过 postMessage 或 IPC 发送到 Electron 主进程
    window.takuaiAPI.sendSelectedElement({
      dataSlot: selected.dataSlot,
      rect: {
        x: selected.rect.x,
        y: selected.rect.y,
        width: selected.rect.width,
        height: selected.rect.height,
      },
      styles: this.extractStyles(selected.computedStyles),
      classList: selected.classList,
    });
  }

  private extractStyles(computed: CSSStyleDeclaration): Record<string, string> {
    // 提取关键样式属性
    return {
      // Typography
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      
      // Colors
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      
      // Layout
      padding: computed.padding,
      margin: computed.margin,
      width: computed.width,
      height: computed.height,
      
      // Border
      borderWidth: computed.borderWidth,
      borderColor: computed.borderColor,
      borderRadius: computed.borderRadius,
      
      // Effects
      boxShadow: computed.boxShadow,
      opacity: computed.opacity,
    };
  }
}
```

### 2.2 属性面板系统

**功能**：根据选中元素的 data-slot 类型，显示对应的可编辑属性。

```typescript
// property-panel.tsx

interface PropertyPanelProps {
  selectedElement: SelectedElementData | null;
  onStyleChange: (property: string, value: string) => void;
}

// 属性面板配置 - 根据 data-slot 类型显示不同属性
const PANEL_CONFIG: Record<string, PropertySection[]> = {
  button: ['typography', 'color', 'background', 'layout', 'border', 'shadow'],
  card: ['background', 'layout', 'border', 'shadow'],
  input: ['typography', 'color', 'background', 'layout', 'border'],
  text: ['typography', 'color'],
  // ... 其他组件
};

type PropertySection = 
  | 'typography'
  | 'color'
  | 'background'
  | 'layout'
  | 'border'
  | 'shadow'
  | 'appearance';

function PropertyPanel({ selectedElement, onStyleChange }: PropertyPanelProps) {
  if (!selectedElement) {
    return <div className="p-4 text-muted-foreground">选择一个元素开始编辑</div>;
  }

  const sections = PANEL_CONFIG[selectedElement.dataSlot] || PANEL_CONFIG.default;

  return (
    <div className="property-panel">
      {sections.includes('typography') && (
        <TypographySection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
      {sections.includes('color') && (
        <ColorSection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
      {sections.includes('background') && (
        <BackgroundSection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
      {sections.includes('layout') && (
        <LayoutSection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
      {sections.includes('border') && (
        <BorderSection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
      {sections.includes('shadow') && (
        <ShadowSection 
          styles={selectedElement.styles}
          onChange={onStyleChange}
        />
      )}
    </div>
  );
}
```

### 2.3 Tailwind 类名映射系统

**功能**：将属性面板的修改转换为 Tailwind 类名。

```typescript
// tailwind-mapper.ts

interface TailwindMapper {
  // 颜色映射
  mapColor(cssColor: string, property: 'text' | 'bg' | 'border'): string;
  
  // 间距映射
  mapSpacing(value: string, property: 'p' | 'm' | 'px' | 'py' | 'mx' | 'my'): string;
  
  // 圆角映射
  mapBorderRadius(value: string): string;
  
  // 阴影映射
  mapBoxShadow(value: string): string;
  
  // 字体映射
  mapFontSize(value: string): string;
  mapFontWeight(value: string): string;
}

class TailwindClassMapper implements TailwindMapper {
  // Tailwind 颜色表
  private colorPalette = {
    // 从 Tailwind 配置中提取
    'rgb(0, 0, 0)': 'black',
    'rgb(255, 255, 255)': 'white',
    'rgb(239, 68, 68)': 'red-500',
    'rgb(59, 130, 246)': 'blue-500',
    // ... 完整的颜色映射
  };

  // 间距映射表
  private spacingScale = {
    '0px': '0',
    '4px': '1',
    '8px': '2',
    '12px': '3',
    '16px': '4',
    '20px': '5',
    '24px': '6',
    '32px': '8',
    '40px': '10',
    '48px': '12',
    '64px': '16',
    '80px': '20',
    '96px': '24',
  };

  mapColor(cssColor: string, property: 'text' | 'bg' | 'border'): string {
    const colorName = this.colorPalette[cssColor] || this.findClosestColor(cssColor);
    return `${property}-${colorName}`;
  }

  mapSpacing(value: string, property: string): string {
    const scale = this.spacingScale[value] || this.findClosestSpacing(value);
    return `${property}-${scale}`;
  }

  mapBorderRadius(value: string): string {
    const radiusMap: Record<string, string> = {
      '0px': 'rounded-none',
      '2px': 'rounded-sm',
      '4px': 'rounded',
      '6px': 'rounded-md',
      '8px': 'rounded-lg',
      '12px': 'rounded-xl',
      '16px': 'rounded-2xl',
      '24px': 'rounded-3xl',
      '9999px': 'rounded-full',
    };
    return radiusMap[value] || 'rounded';
  }

  mapBoxShadow(value: string): string {
    // 简化的阴影映射
    if (value === 'none') return 'shadow-none';
    if (value.includes('0 1px 2px')) return 'shadow-sm';
    if (value.includes('0 1px 3px')) return 'shadow';
    if (value.includes('0 4px 6px')) return 'shadow-md';
    if (value.includes('0 10px 15px')) return 'shadow-lg';
    if (value.includes('0 20px 25px')) return 'shadow-xl';
    if (value.includes('0 25px 50px')) return 'shadow-2xl';
    return 'shadow';
  }

  // 生成完整的类名字符串
  generateClassName(styles: StyleChanges): string {
    const classes: string[] = [];
    
    if (styles.backgroundColor) {
      classes.push(this.mapColor(styles.backgroundColor, 'bg'));
    }
    if (styles.color) {
      classes.push(this.mapColor(styles.color, 'text'));
    }
    if (styles.padding) {
      classes.push(this.mapSpacing(styles.padding, 'p'));
    }
    if (styles.margin) {
      classes.push(this.mapSpacing(styles.margin, 'm'));
    }
    if (styles.borderRadius) {
      classes.push(this.mapBorderRadius(styles.borderRadius));
    }
    if (styles.boxShadow) {
      classes.push(this.mapBoxShadow(styles.boxShadow));
    }
    
    return classes.join(' ');
  }
}
```

### 2.4 代码修改引擎

**功能**：使用 AST 解析和修改源代码中的 className。

```typescript
// code-modifier.ts

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

interface CodeModification {
  filePath: string;
  dataSlot: string;
  oldClassName: string;
  newClassName: string;
}

class CodeModifier {
  async modifyClassName(modification: CodeModification): Promise<string> {
    const { filePath, dataSlot, newClassName } = modification;
    
    // 1. 读取文件内容
    const sourceCode = await fs.readFile(filePath, 'utf-8');
    
    // 2. 解析 AST
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    
    // 3. 遍历 AST 找到目标元素
    let modified = false;
    
    traverse(ast, {
      JSXOpeningElement(path) {
        // 查找 data-slot 属性
        const dataSlotAttr = path.node.attributes.find(
          (attr) => 
            t.isJSXAttribute(attr) && 
            attr.name.name === 'data-slot' &&
            t.isStringLiteral(attr.value) &&
            attr.value.value === dataSlot
        );
        
        if (dataSlotAttr) {
          // 找到目标元素，修改 className
          const classNameAttr = path.node.attributes.find(
            (attr) => 
              t.isJSXAttribute(attr) && 
              attr.name.name === 'className'
          );
          
          if (classNameAttr && t.isJSXAttribute(classNameAttr)) {
            // 更新 className
            classNameAttr.value = t.stringLiteral(newClassName);
            modified = true;
          }
        }
      },
    });
    
    if (!modified) {
      throw new Error(`未找到 data-slot="${dataSlot}" 的元素`);
    }
    
    // 4. 生成新代码
    const { code } = generate(ast, {
      retainLines: true,
      compact: false,
    });
    
    // 5. 写入文件
    await fs.writeFile(filePath, code);
    
    return code;
  }

  // 智能合并类名 - 替换同类型的类，保留其他类
  mergeClassNames(existing: string, newClasses: string): string {
    const existingArr = existing.split(' ').filter(Boolean);
    const newArr = newClasses.split(' ').filter(Boolean);
    
    // 获取类名前缀（如 bg-, text-, p-, m- 等）
    const getPrefix = (cls: string) => {
      const match = cls.match(/^([a-z]+-)/);
      return match ? match[1] : cls;
    };
    
    // 移除同前缀的旧类
    const newPrefixes = new Set(newArr.map(getPrefix));
    const filtered = existingArr.filter(cls => !newPrefixes.has(getPrefix(cls)));
    
    // 合并
    return [...filtered, ...newArr].join(' ');
  }
}
```

### 2.5 实时预览系统

**功能**：在保存代码前，先在 WebView 中实时预览样式变化。

```typescript
// live-preview.ts

class LivePreview {
  private webview: WebviewTag;
  
  constructor(webview: WebviewTag) {
    this.webview = webview;
  }

  // 临时应用样式（不修改源码）
  async previewStyle(elementSelector: string, styles: Record<string, string>) {
    const script = `
      (function() {
        const element = document.querySelector('[data-slot="${elementSelector}"]');
        if (element) {
          Object.assign(element.style, ${JSON.stringify(styles)});
        }
      })();
    `;
    
    await this.webview.executeJavaScript(script);
  }

  // 临时应用类名（不修改源码）
  async previewClassName(elementSelector: string, className: string) {
    const script = `
      (function() {
        const element = document.querySelector('[data-slot="${elementSelector}"]');
        if (element) {
          element.className = '${className}';
        }
      })();
    `;
    
    await this.webview.executeJavaScript(script);
  }

  // 重置预览（刷新页面）
  async resetPreview() {
    this.webview.reload();
  }
}
```

---

## 3. 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        完整数据流                                │
└─────────────────────────────────────────────────────────────────┘

1. 用户点击元素
   │
   ▼
2. WebView 注入脚本捕获点击
   │
   ├── 读取 data-slot
   ├── 读取当前样式
   ├── 读取当前 classList
   │
   ▼
3. 通过 IPC 发送到主进程
   │
   ▼
4. 主进程更新属性面板
   │
   ▼
5. 用户在属性面板修改样式
   │
   ├── 颜色选择器 → 选择蓝色
   │
   ▼
6. Tailwind Mapper 转换
   │
   ├── 蓝色 → bg-blue-500
   │
   ▼
7. 实时预览
   │
   ├── 注入临时样式到 WebView
   ├── 用户看到效果
   │
   ▼
8. 用户确认/继续修改
   │
   ▼
9. 保存修改
   │
   ├── Code Modifier 解析 AST
   ├── 找到 data-slot 对应的元素
   ├── 更新 className
   ├── 写入文件
   │
   ▼
10. 触发 HMR 热更新
    │
    ▼
11. WebView 自动刷新显示最新效果
```

---

## 4. 文件结构

```
takuai-electron/
├── src/
│   ├── main/
│   │   ├── design-mode/
│   │   │   ├── index.ts              # Design Mode 主入口
│   │   │   ├── code-modifier.ts      # AST 代码修改引擎
│   │   │   ├── tailwind-mapper.ts    # Tailwind 类名映射
│   │   │   ├── file-watcher.ts       # 文件监听
│   │   │   └── ipc-handlers.ts       # IPC 通信处理
│   │   │
│   │   └── index.ts
│   │
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── property-panel/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── TypographySection.tsx
│   │   │   │   ├── ColorSection.tsx
│   │   │   │   ├── BackgroundSection.tsx
│   │   │   │   ├── LayoutSection.tsx
│   │   │   │   ├── BorderSection.tsx
│   │   │   │   ├── ShadowSection.tsx
│   │   │   │   └── AppearanceSection.tsx
│   │   │   │
│   │   │   ├── color-picker/
│   │   │   │   └── TailwindColorPicker.tsx
│   │   │   │
│   │   │   └── spacing-input/
│   │   │       └── SpacingInput.tsx
│   │   │
│   │   └── hooks/
│   │       ├── useDesignMode.ts
│   │       └── useSelectedElement.ts
│   │
│   └── preload/
│       └── design-mode-injector.ts   # 注入到 WebView 的脚本
│
└── package.json
```

---

## 5. 属性面板详细设计

### 5.1 Typography 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Font Family | 下拉选择 | font-sans, font-serif, font-mono |
| Font Size | 下拉选择 | text-xs, text-sm, text-base, text-lg... |
| Font Weight | 下拉选择 | font-thin, font-normal, font-bold... |
| Line Height | 输入框 | leading-none, leading-tight, leading-normal... |
| Letter Spacing | 输入框 | tracking-tighter, tracking-normal, tracking-wider... |
| Text Align | 按钮组 | text-left, text-center, text-right, text-justify |
| Text Decoration | 按钮组 | underline, line-through, no-underline |

### 5.2 Color 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Text Color | 颜色选择器 | text-{color}-{shade} |
| Opacity | 滑块 | text-opacity-{value} |

### 5.3 Background 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Background Color | 颜色选择器 | bg-{color}-{shade} |
| Background Opacity | 滑块 | bg-opacity-{value} |
| Gradient | 渐变编辑器 | bg-gradient-to-{direction} |

### 5.4 Layout 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Margin (上/右/下/左) | 四向输入 | m-{value}, mt-{}, mr-{}, mb-{}, ml-{} |
| Padding (上/右/下/左) | 四向输入 | p-{value}, pt-{}, pr-{}, pb-{}, pl-{} |
| Width | 输入框 | w-{value} |
| Height | 输入框 | h-{value} |

### 5.5 Border 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Border Width | 输入框 | border, border-2, border-4... |
| Border Color | 颜色选择器 | border-{color}-{shade} |
| Border Radius | 滑块/输入框 | rounded-none, rounded-sm, rounded-md... |
| Border Style | 下拉选择 | border-solid, border-dashed, border-dotted |

### 5.6 Shadow 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Box Shadow | 预设选择 | shadow-sm, shadow, shadow-md, shadow-lg... |
| Shadow Color | 颜色选择器 | shadow-{color}-{shade} |

### 5.7 Appearance 面板

| 属性 | 控件类型 | Tailwind 映射 |
|------|----------|---------------|
| Opacity | 滑块 | opacity-{value} |
| Cursor | 下拉选择 | cursor-pointer, cursor-default... |
| Overflow | 下拉选择 | overflow-hidden, overflow-auto... |

---

## 6. 技术选型

| 模块 | 技术 | 说明 |
|------|------|------|
| AST 解析 | @babel/parser | 解析 JSX/TSX |
| AST 遍历 | @babel/traverse | 查找目标节点 |
| 代码生成 | @babel/generator | 生成修改后的代码 |
| 属性面板 UI | React + Radix UI | 复用现有组件库 |
| 颜色选择器 | react-colorful | 轻量级颜色选择器 |
| IPC 通信 | Electron IPC | 主进程和渲染进程通信 |
| 文件操作 | Node.js fs | 读写源代码文件 |

---

## 7. 实现优先级

### Phase 1: 基础框架（2周）
- [ ] 元素选择和高亮
- [ ] IPC 通信框架
- [ ] 基础属性面板 UI

### Phase 2: 样式编辑（3周）
- [ ] Typography 面板
- [ ] Color 面板
- [ ] Background 面板
- [ ] Tailwind 类名映射

### Phase 3: 代码修改（2周）
- [ ] AST 解析和修改
- [ ] 实时预览
- [ ] 文件写入

### Phase 4: 完善（2周）
- [ ] Layout 面板
- [ ] Border 面板
- [ ] Shadow 面板
- [ ] Appearance 面板

### Phase 5: 优化（1周）
- [ ] 撤销/重做
- [ ] 批量修改
- [ ] 快捷键支持

---

## 8. 注意事项

### 8.1 处理复杂的 className

```tsx
// 简单情况
<Button className="bg-blue-500" />

// 复杂情况 - 使用 cn() 函数
<Button className={cn("bg-blue-500", isActive && "ring-2")} />

// 更复杂 - 使用变量
<Button className={buttonStyles} />
```

需要处理这些情况，可能需要：
1. 只支持简单的字符串 className
2. 对于复杂情况，提示用户手动修改

### 8.2 保持代码格式

使用 Prettier 或 Biome 在修改后格式化代码，保持一致的代码风格。

### 8.3 处理 CSS Modules / Styled Components

如果项目使用 CSS Modules 或 Styled Components，需要不同的处理逻辑。当前方案主要针对 Tailwind CSS。

### 8.4 性能考虑

- AST 解析可能较慢，考虑缓存
- 实时预览使用临时样式注入，不频繁修改文件
- 批量修改时合并操作

---

## 9. 参考资源

- [Babel AST Explorer](https://astexplorer.net/)
- [Tailwind CSS 颜色表](https://tailwindcss.com/docs/customizing-colors)
- [V0.dev](https://v0.dev) - 参考其 Design Mode 实现
- [Figma API](https://www.figma.com/developers/api) - 参考其属性面板设计

---

> 本文档为 TakuAI Design Mode 的架构设计参考，具体实现可能需要根据实际情况调整。

