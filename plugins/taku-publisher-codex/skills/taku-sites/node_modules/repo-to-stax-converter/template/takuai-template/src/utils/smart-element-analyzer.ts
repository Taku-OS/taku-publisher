/**
 * 智能元素分析器 - 替代 data-tid 系统
 * 为 TakuAI Electron 应用提供丰富的元素上下文信息
 */

export interface SmartElementDescription {
  // 基础元素信息
  basic: {
    tagName: string;
    className: string;
    textContent: string;
    attributes: Record<string, string>;
    id?: string;
  };

  // 结构上下文
  structure: {
    parentChain: ElementInfo[];
    siblingContext: SiblingInfo;
    childrenCount: number;
    nestingLevel: number;
  };

  // React/组件上下文
  component: {
    name?: string;
    displayName?: string;
    props?: Record<string, unknown>;
    hierarchy: string[];
    isRootComponent: boolean;
  };

  // 代码推断信息
  codeInference: {
    probableFile: string;
    confidence: number;
    alternativeFiles: string[];
    codePattern: string;
    semanticRole: string;
  };

  // 交互特征
  interaction: {
    isClickable: boolean;
    hasEventListeners: boolean;
    interactionType: 'button' | 'link' | 'input' | 'display' | 'container';
    nearbyInteractables: ElementInfo[];
  };

  // 视觉特征
  visual: {
    position: DOMRect;
    computedStyles: Partial<CSSStyleDeclaration>;
    visibility: boolean;
    zIndex: number;
  };

  // 语义分析
  semantic: {
    purpose: string;
    userAction: string;
    contextualMeaning: string;
    accessibilityInfo: {
      ariaLabel?: string;
      ariaRole?: string;
      tabIndex?: number;
    };
  };
}

interface ElementInfo {
  tagName: string;
  className?: string;
  textContent?: string;
  role?: string;
}

interface SiblingInfo {
  totalSiblings: number;
  indexInSiblings: number;
  sameTagSiblings: number;
  indexInSameTag: number;
}

/**
 * 分析指定元素，生成丰富的描述信息
 */
export function analyzeElement(element: HTMLElement): SmartElementDescription {
  const basic = extractBasicInfo(element);
  const structure = extractStructuralContext(element);
  const component = extractComponentContext(element);
  const codeInference = inferCodeContext(element, component);
  const interaction = analyzeInteraction(element);
  const visual = extractVisualInfo(element);
  const semantic = analyzeSemantic(element);

  return {
    basic,
    structure,
    component,
    codeInference,
    interaction,
    visual,
    semantic,
  };
}

/**
 * 提取基础元素信息
 */
function extractBasicInfo(element: HTMLElement): SmartElementDescription['basic'] {
  const attributes: Record<string, string> = {};

  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value;
  }

  return {
    tagName: element.tagName.toLowerCase(),
    className: element.className || '',
    textContent: getCleanTextContent(element),
    attributes,
    id: element.id || undefined,
  };
}

/**
 * 提取结构上下文信息
 */
function extractStructuralContext(element: HTMLElement): SmartElementDescription['structure'] {
  return {
    parentChain: getParentChain(element),
    siblingContext: analyzeSiblingContext(element),
    childrenCount: element.children.length,
    nestingLevel: calculateNestingLevel(element),
  };
}

/**
 * 提取React组件上下文
 */
function extractComponentContext(element: HTMLElement): SmartElementDescription['component'] {
  const fiber = findReactFiber(element);

  if (fiber) {
    const componentType = (fiber as { type?: unknown })?.type;
    const props = extractPropsFromFiber(fiber);
    const hierarchy = buildComponentHierarchy(fiber);

    return {
      name: typeof componentType === 'function' ? componentType.name : String(componentType || ''),
      displayName: String((componentType as { displayName?: unknown })?.displayName || ''),
      props,
      hierarchy,
      isRootComponent: hierarchy.length <= 1,
    };
  }

  return {
    hierarchy: [],
    isRootComponent: false,
  };
}

/**
 * 查找React Fiber节点
 */
function findReactFiber(element: HTMLElement): unknown {
  // 查找 React Fiber 节点
  const key = Object.keys(element).find(
    (key) => key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
  );

  return key ? (element as unknown as { [key: string]: unknown })[key] : null;
}

/**
 * 从Fiber节点提取Props
 */
function extractPropsFromFiber(fiber: unknown): Record<string, unknown> {
  try {
    const fiberObj = fiber as { memoizedProps?: unknown; pendingProps?: unknown };
    return (
      (fiberObj?.memoizedProps as Record<string, unknown>) ||
      (fiberObj?.pendingProps as Record<string, unknown>) ||
      {}
    );
  } catch {
    return {};
  }
}

/**
 * 构建组件层级
 */
function buildComponentHierarchy(fiber: unknown): string[] {
  const hierarchy: string[] = [];
  let current = fiber;

  while (current && hierarchy.length < 10) {
    const currentFiber = current as { type?: unknown; return?: unknown };
    if (currentFiber.type && typeof currentFiber.type === 'function') {
      hierarchy.unshift(currentFiber.type.name || 'Anonymous');
    }
    current = currentFiber.return;
  }

  return hierarchy;
}

/**
 * 推断代码上下文
 */
function inferCodeContext(
  element: HTMLElement,
  component: SmartElementDescription['component']
): SmartElementDescription['codeInference'] {
  const pathname = (window.location as { pathname?: string })?.pathname || '/';
  const route = inferRouteFromPath(pathname);

  return {
    probableFile: route.file,
    confidence: route.confidence,
    alternativeFiles: generateAlternativeFiles(element, component),
    codePattern: generateCodePattern(element),
    semanticRole: inferSemanticRole(element),
  };
}

/**
 * 从路径推断路由文件
 */
function inferRouteFromPath(pathname: string): { file: string; confidence: number } {
  if (pathname === '/') return { file: 'src/app/page.tsx', confidence: 0.9 };

  const pathSegments = pathname.split('/').filter(Boolean);

  if (pathSegments.length === 0) return { file: 'src/app/page.tsx', confidence: 0.8 };

  return { file: `src/app/${pathSegments.join('/')}/page.tsx`, confidence: 0.7 };
}

/**
 * 生成替代文件路径
 */
function generateAlternativeFiles(
  _element: HTMLElement,
  component: SmartElementDescription['component']
): string[] {
  const alternatives = ['src/components/', 'src/app/'];

  if (component.name) {
    alternatives.push(`src/components/${component.name}.tsx`);
    alternatives.push(`src/components/${component.name}/index.tsx`);
  }

  return alternatives;
}

/**
 * 生成代码模式
 */
function generateCodePattern(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const className = element.className ? ` className="${element.className}"` : '';
  const id = element.id ? ` id="${element.id}"` : '';

  return `<${tag}${className}${id}>`;
}

/**
 * 推断语义角色
 */
function inferSemanticRole(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();

  const roleMap: Record<string, string> = {
    button: 'action',
    a: 'navigation',
    input: 'input',
    textarea: 'input',
    select: 'input',
    img: 'media',
    video: 'media',
    audio: 'media',
    nav: 'navigation',
    header: 'header',
    footer: 'footer',
    main: 'content',
    aside: 'sidebar',
    section: 'content',
    article: 'content',
  };

  return roleMap[tagName] || 'display';
}

/**
 * 分析交互特征
 */
function analyzeInteraction(element: HTMLElement): SmartElementDescription['interaction'] {
  return {
    isClickable: isElementClickable(element),
    hasEventListeners: hasEventListeners(element),
    interactionType: determineInteractionType(element),
    nearbyInteractables: findNearbyInteractables(element),
  };
}

/**
 * 检查元素是否可点击
 */
function isElementClickable(element: HTMLElement): boolean {
  const clickableTags = ['button', 'a', 'input', 'select', 'textarea'];
  const tagName = element.tagName.toLowerCase();

  return (
    clickableTags.includes(tagName) ||
    element.getAttribute('role') === 'button' ||
    getComputedStyle(element).cursor === 'pointer'
  );
}

/**
 * 检查元素是否有事件监听器
 */
function hasEventListeners(element: HTMLElement): boolean {
  // 检查常见的事件监听器
  const eventProps = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup'];
  return eventProps.some(
    (prop) => (element as unknown as { [key: string]: unknown })[prop] !== null
  );
}

/**
 * 确定交互类型
 */
function determineInteractionType(
  element: HTMLElement
): 'button' | 'link' | 'input' | 'display' | 'container' {
  const tagName = element.tagName.toLowerCase();

  const typeMap: Record<string, 'button' | 'link' | 'input' | 'display' | 'container'> = {
    button: 'button',
    a: 'link',
    input: 'input',
    textarea: 'input',
    select: 'input',
    div: 'container',
    span: 'display',
  };

  return typeMap[tagName] || 'display';
}

/**
 * 查找附近的可交互元素
 */
function findNearbyInteractables(element: HTMLElement): ElementInfo[] {
  const siblings = Array.from(element.parentElement?.children || []);

  return siblings
    .filter((sibling) => sibling !== element && isElementClickable(sibling as HTMLElement))
    .slice(0, 5)
    .map((el) => ({
      tagName: el.tagName.toLowerCase(),
      className: el.className,
      textContent: el.textContent?.slice(0, 50),
      role: el.getAttribute('role') || undefined,
    }));
}

/**
 * 提取视觉信息
 */
function extractVisualInfo(element: HTMLElement): SmartElementDescription['visual'] {
  const rect = element.getBoundingClientRect();
  const computedStyles = getComputedStyle(element);

  return {
    position: rect,
    computedStyles: {
      display: computedStyles.display,
      position: computedStyles.position,
      backgroundColor: computedStyles.backgroundColor,
      color: computedStyles.color,
      fontSize: computedStyles.fontSize,
      fontWeight: computedStyles.fontWeight,
    },
    visibility: rect.width > 0 && rect.height > 0 && computedStyles.visibility !== 'hidden',
    zIndex: Number.parseInt(computedStyles.zIndex, 10) || 0,
  };
}

/**
 * 分析语义信息
 */
function analyzeSemantic(element: HTMLElement): SmartElementDescription['semantic'] {
  return {
    purpose: inferElementPurpose(element),
    userAction: inferUserAction(element),
    contextualMeaning: inferContextualMeaning(element),
    accessibilityInfo: {
      ariaLabel: element.getAttribute('aria-label') || undefined,
      ariaRole: element.getAttribute('role') || undefined,
      tabIndex: element.tabIndex >= 0 ? element.tabIndex : undefined,
    },
  };
}

/**
 * 推断元素用途
 */
function inferElementPurpose(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const textContent = element.textContent?.trim() || '';

  if (tagName === 'button') {
    if (textContent.includes('提交') || textContent.includes('保存')) return '表单提交';
    if (textContent.includes('取消') || textContent.includes('关闭')) return '取消操作';
    return '触发操作';
  }

  if (tagName === 'a') return '页面导航';
  if (['input', 'textarea', 'select'].includes(tagName)) return '数据输入';

  return '内容展示';
}

/**
 * 推断用户操作
 */
function inferUserAction(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();

  const actionMap: Record<string, string> = {
    button: '点击',
    a: '点击导航',
    input: '输入数据',
    textarea: '输入文本',
    select: '选择选项',
  };

  return actionMap[tagName] || '查看';
}

/**
 * 推断上下文含义
 */
function inferContextualMeaning(element: HTMLElement): string {
  const parent = element.parentElement;
  if (!parent) return '独立元素';

  const parentTag = parent.tagName.toLowerCase();
  const parentClass = parent.className;

  if (parentTag === 'nav' || parentClass.includes('nav')) return '导航项';
  if (parentTag === 'form' || parentClass.includes('form')) return '表单项';
  if (parentClass.includes('header')) return '头部元素';
  if (parentClass.includes('footer')) return '底部元素';

  return '页面内容';
}

// 辅助方法
function getCleanTextContent(element: HTMLElement): string {
  return element.textContent?.trim().slice(0, 100) || '';
}

function getParentChain(element: HTMLElement): ElementInfo[] {
  const chain: ElementInfo[] = [];
  let current = element.parentElement;

  while (current && current !== document.body && chain.length < 10) {
    chain.push({
      tagName: current.tagName.toLowerCase(),
      className: current.className,
      textContent: current.textContent?.slice(0, 50),
      role: current.getAttribute('role') || undefined,
    });
    current = current.parentElement;
  }

  return chain;
}

function analyzeSiblingContext(element: HTMLElement): SiblingInfo {
  const parent = element.parentElement;
  if (!parent) {
    return {
      totalSiblings: 0,
      indexInSiblings: 0,
      sameTagSiblings: 0,
      indexInSameTag: 0,
    };
  }

  const siblings = Array.from(parent.children);
  const sameTagSiblings = siblings.filter((sibling) => sibling.tagName === element.tagName);

  return {
    totalSiblings: siblings.length,
    indexInSiblings: siblings.indexOf(element),
    sameTagSiblings: sameTagSiblings.length,
    indexInSameTag: sameTagSiblings.indexOf(element),
  };
}

function calculateNestingLevel(element: HTMLElement): number {
  let level = 0;
  let current = element.parentElement;

  while (current && current !== document.body) {
    level++;
    current = current.parentElement;
  }

  return level;
}

/**
 * 分析所有可交互元素
 */
export function analyzeAllInteractables(): SmartElementDescription[] {
  const interactableSelectors = [
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[tabindex="0"]',
  ];

  const elements = document.querySelectorAll(interactableSelectors.join(', '));

  return Array.from(elements)
    .filter((element) => {
      const htmlElement = element as HTMLElement;
      return htmlElement.offsetParent !== null; // 过滤不可见元素
    })
    .map((element) => {
      const description = analyzeElement(element as HTMLElement);
      return {
        ...description,
        basic: {
          ...description.basic,
          domId:
            (element as HTMLElement).getAttribute('id') ||
            `element-${Math.random().toString(36).slice(2, 11)}`,
        },
      };
    });
}

/**
 * 根据DOM ID获取元素的智能描述
 */
export function getSmartElementDescription(domId: string): SmartElementDescription | null {
  const element = document.getElementById(domId);
  if (!element) return null;

  return analyzeElement(element);
}

/**
 * 根据描述查找元素
 */
export function findElementByDescription(description: string): HTMLElement | null {
  const allElements = document.querySelectorAll('*');

  for (const element of Array.from(allElements)) {
    const htmlElement = element as HTMLElement;
    const elementDescription = analyzeElement(htmlElement);

    if (
      elementDescription.basic.textContent.includes(description) ||
      elementDescription.basic.className.includes(description) ||
      elementDescription.codeInference.semanticRole.includes(description)
    ) {
      return htmlElement;
    }
  }

  return null;
}

/**
 * 调试信息输出
 */
export function debugElementAnalysis(element: HTMLElement): void {
  if (process.env.NODE_ENV === 'development') {
    const analysis = analyzeElement(element);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.group('🔍 元素分析结果');
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('基础信息:', analysis.basic);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('结构信息:', analysis.structure);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('组件信息:', analysis.component);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('代码推断:', analysis.codeInference);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('交互特征:', analysis.interaction);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('视觉特征:', analysis.visual);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.log('语义分析:', analysis.semantic);
    // biome-ignore lint/suspicious/noConsole: Debug function for development
    console.groupEnd();
  }
}
