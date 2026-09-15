/* eslint-disable */
'use client';

import { useEffect } from 'react';
import { TAKU_DESIGN_MODE_OVERRIDES_JSON } from './TakuDesignModeOverrides';
import { installClientLogBridge } from './TakuLogBridge';

type TakuNavigationCommand = 'back' | 'forward' | 'reload';

type NavigationState = {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  updatedAt: number;
};

type NavigationCommandMessage = {
  __taku: true;
  type: 'taku:navigation:command';
  command: TakuNavigationCommand;
};

type NavigationStateMessage = {
  __taku: true;
  type: 'taku:navigation:state';
  state: NavigationState;
};

type SelectedElementSnapshot = {
  slot: string;
  tagName?: string;
  capabilities?: {
    text: boolean;
    typography: boolean;
    fillText: boolean;
    fillBackground: boolean;
    stroke: boolean;
    effects: boolean;
    layout: boolean;
    size: boolean;
  };
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  classList: string[];
  text?: string;
  canEditText: boolean;
  href?: string;
  timestamp: number;
};

type SelectedElementMessage = {
  __taku: true;
  type: 'taku:design-mode:selected-element';
  applicationId?: string;
  selection: SelectedElementSnapshot;
};

type DesignModeClearSelectionReason = 'scroll' | 'esc' | 'unknown';

type DesignModeClearSelectionMessage = {
  __taku: true;
  type: 'taku:design-mode:clear-selection';
  applicationId?: string;
  reason: DesignModeClearSelectionReason;
  timestamp: number;
};

type DesignModePickerStateMessage = {
  __taku: true;
  type: 'taku:design-mode:picker-state';
  applicationId?: string;
  enabled: boolean;
  reason?: string;
  timestamp: number;
};

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function toCssPropertyName(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function setInlineStyle(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(toCssPropertyName(prop), value);
}

function getInlineStyle(el: HTMLElement, prop: string): string {
  return el.style.getPropertyValue(toCssPropertyName(prop));
}

export function TakuBridgeClient() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    installClientLogBridge();

    const state: {
      stack: string[];
      index: number;
      isLoading: boolean;
    } = {
      stack: [window.location.href],
      index: 0,
      isLoading: false,
    };

    // ============================================================
    // Persisted Design Mode Overrides (Phase 2+)
    // ============================================================

    const applyPersistedOverrides = () => {
      const parsed = safeJsonParse(String(TAKU_DESIGN_MODE_OVERRIDES_JSON ?? ''));
      if (!isPlainObject(parsed)) return;

      for (const [slot, entry] of Object.entries(parsed)) {
        if (!slot || !isPlainObject(entry)) continue;

        const stylesRaw = entry.styles;
        const textRaw = entry.text;

        const styles: Record<string, string> = {};
        if (isPlainObject(stylesRaw)) {
          for (const [k, v] of Object.entries(stylesRaw)) {
            if (typeof v === 'string') styles[k] = v;
          }
        }

        const nodes = document.querySelectorAll(`[data-slot="${slot}"]`);
        nodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          for (const [k, v] of Object.entries(styles)) {
            try {
              setInlineStyle(node, k, v);
            } catch {
              // ignore
            }
          }

          if (typeof textRaw === 'string' && textRaw.trim()) {
            const target = resolveTextTarget(node);
            if (target) applyTextToTarget(target, textRaw);
          }
        });
      }
    };

    const postState = () => {
      const payload: NavigationStateMessage = {
        __taku: true,
        type: 'taku:navigation:state',
        state: {
          url: window.location.href,
          canGoBack: state.index > 0,
          canGoForward: state.index < state.stack.length - 1,
          isLoading: state.isLoading,
          updatedAt: Date.now(),
        },
      };
      window.parent?.postMessage(payload, '*');
    };

    const commitUrl = (mode: 'push' | 'replace' | 'pop') => {
      const url = window.location.href;

      if (mode === 'push') {
        if (state.index < state.stack.length - 1) {
          state.stack = state.stack.slice(0, state.index + 1);
        }
        state.stack.push(url);
        state.index = state.stack.length - 1;
      } else if (mode === 'replace') {
        state.stack[state.index] = url;
      } else {
        const found = state.stack.lastIndexOf(url);
        if (found !== -1) {
          state.index = found;
        } else {
          if (state.index < state.stack.length - 1) {
            state.stack = state.stack.slice(0, state.index + 1);
          }
          state.stack.push(url);
          state.index = state.stack.length - 1;
        }
      }

      state.isLoading = false;
      postState();
      applyPersistedOverrides();
    };

    // Patch History API to detect SPA navigations
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = (...args) => {
      originalPushState.apply(window.history, args);
      commitUrl('push');
    };

    window.history.replaceState = (...args) => {
      originalReplaceState.apply(window.history, args);
      commitUrl('replace');
    };

    const onPop = () => commitUrl('pop');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);

    // ============================================================
    // Design Mode: element picker + live preview (Phase 1)
    // ============================================================

    const designState: {
      enabled: boolean;
      applicationId?: string;
      pickerEnabled: boolean;
      selectedEl: HTMLElement | null;
      highlightEl: HTMLDivElement | null;
      maskEl: HTMLDivElement | null;
      scrolling: boolean;
    } = {
      enabled: false,
      pickerEnabled: false,
      selectedEl: null,
      highlightEl: null,
      maskEl: null,
      scrolling: false,
    };

    const previewStyleBackup = new WeakMap<HTMLElement, Record<string, string>>();

    type TextTarget =
      | { kind: 'input'; el: HTMLInputElement | HTMLTextAreaElement }
      | { kind: 'contentEditable'; el: HTMLElement }
      | { kind: 'textNode'; node: Text };

    type PreviewTextBackup =
      | { kind: 'input'; prev: string }
      | { kind: 'contentEditable'; prev: string }
      | { kind: 'textNode'; node: Text; prev: string };

    // 缓存：避免每次输入都 tree-walk
    const textTargetByEl = new WeakMap<HTMLElement, TextTarget>();
    const previewTextBackup = new WeakMap<HTMLElement, PreviewTextBackup>();
    const designCssId = '__taku-design-mode-css__';
    let hoverLogCount = 0;
    let lastHoverLogAt = 0;
    let lastClickLogAt = 0;
    let scrollEndTimer: number | null = null;
    let hintTimer: number | null = null;
    let hintEl: HTMLDivElement | null = null;

    function postDebug(
      level: 'info' | 'warn' | 'error',
      message: string,
      data?: Record<string, unknown>
    ): void {
      try {
        window.parent?.postMessage(
          {
            __taku: true,
            type: 'taku:design-mode:debug',
            applicationId: designState.applicationId,
            level,
            message,
            data,
            timestamp: Date.now(),
          },
          '*'
        );
      } catch {
        // ignore
      }
    }

    function postClearSelection(reason: DesignModeClearSelectionReason): void {
      try {
        const payload: DesignModeClearSelectionMessage = {
          __taku: true,
          type: 'taku:design-mode:clear-selection',
          applicationId: designState.applicationId,
          reason,
          timestamp: Date.now(),
        };
        window.parent?.postMessage(payload, '*');
      } catch {
        // ignore
      }
    }

    function postPickerState(enabled: boolean, reason?: string): void {
      try {
        const payload: DesignModePickerStateMessage = {
          __taku: true,
          type: 'taku:design-mode:picker-state',
          applicationId: designState.applicationId,
          enabled,
          reason,
          timestamp: Date.now(),
        };
        window.parent?.postMessage(payload, '*');
      } catch {
        // ignore
      }
    }

    const ensureDesignModeCss = () => {
      const existing = document.getElementById(designCssId);
      if (existing) {
        postDebug('info', 'css:exists', { styleId: designCssId });
        return;
      }
      const style = document.createElement('style');
      style.id = designCssId;
      style.textContent = [
        // Inspect/Pick：只在 html 挂上 __taku-picker-enabled class 时生效
        'html.__taku-picker-enabled, html.__taku-picker-enabled * { cursor: crosshair !important; }',
        // 悬停蓝框紧贴元素边缘（outline-offset: 0），和选中效果一致
        'html.__taku-picker-enabled [data-slot]:hover { outline: 2px solid rgba(13,111,255,0.85) !important; outline-offset: 0 !important; }',
      ].join('\n');
      document.head.appendChild(style);
      postDebug('info', 'css:injected', { styleId: designCssId });
    };

    // 保留此函数以便将来可能恢复蒙版效果
    const _ensureMaskOverlay = () => {
      if (designState.maskEl) return designState.maskEl;
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = '100%';
      el.style.height = '100%';
      // 移除蓝色蒙版背景，保持透明
      el.style.background = 'transparent';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '2147483646';
      el.style.display = 'none';
      document.body.appendChild(el);
      designState.maskEl = el;
      return el;
    };

    const setMaskVisible = (_visible: boolean) => {
      // 不再显示蓝色蒙版，保持为空操作
      // 如果需要恢复蒙版效果，取消注释下面的代码：
      // const el = _ensureMaskOverlay();
      // el.style.display = visible ? 'block' : 'none';
    };

    const ensureHighlightOverlay = () => {
      if (designState.highlightEl) return designState.highlightEl;
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = '0px';
      el.style.height = '0px';
      el.style.border = '2px solid rgba(13, 111, 255, 0.95)';
      el.style.borderRadius = '6px';
      // 移除超大蓝色阴影，不再有蒙版效果
      el.style.boxShadow = 'none';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '2147483647';
      el.style.display = 'none';
      document.body.appendChild(el);
      designState.highlightEl = el;
      return el;
    };

    let selectedBadgeEl: HTMLDivElement | null = null;

    const ensureSelectedBadgeOverlay = () => {
      if (selectedBadgeEl) return selectedBadgeEl;
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.padding = '4px 8px';
      el.style.borderRadius = '999px';
      el.style.background = 'rgba(0, 0, 0, 0.72)';
      el.style.color = '#fff';
      el.style.fontSize = '12px';
      el.style.lineHeight = '16px';
      el.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '2147483647';
      el.style.display = 'none';
      document.body.appendChild(el);
      selectedBadgeEl = el;
      return el;
    };

    const ensureHintOverlay = () => {
      if (hintEl) return hintEl;
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '50%';
      el.style.top = '16px';
      el.style.transform = 'translateX(-50%)';
      el.style.padding = '8px 12px';
      el.style.borderRadius = '10px';
      el.style.background = 'rgba(0, 0, 0, 0.72)';
      el.style.color = '#fff';
      el.style.fontSize = '12px';
      el.style.lineHeight = '16px';
      el.style.maxWidth = 'min(520px, calc(100vw - 32px))';
      el.style.textAlign = 'center';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '2147483647';
      el.style.display = 'none';
      document.body.appendChild(el);
      hintEl = el;
      return el;
    };

    const hideHint = () => {
      if (!hintEl) return;
      hintEl.style.display = 'none';
    };

    const showHint = (message: string) => {
      const el = ensureHintOverlay();
      el.textContent = message;
      el.style.display = 'block';
      if (hintTimer !== null) window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        hintTimer = null;
        hideHint();
      }, 1200);
    };

    const hideHighlight = () => {
      if (!designState.highlightEl) return;
      designState.highlightEl.style.display = 'none';
      if (selectedBadgeEl) selectedBadgeEl.style.display = 'none';
    };

    const updateHighlight = () => {
      if (!designState.enabled) return;
      if (!designState.selectedEl) return;
      const overlay = ensureHighlightOverlay();
      const rect = designState.selectedEl.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      const badge = ensureSelectedBadgeOverlay();
      const slot = designState.selectedEl.dataset?.slot ?? '';
      const tag = (designState.selectedEl.tagName ?? '').toLowerCase();
      badge.textContent = slot ? `<${tag}>  ${slot}` : `<${tag}>`;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8));
      const top = Math.max(8, rect.top - 24);
      badge.style.left = `${left}px`;
      badge.style.top = `${top}px`;
      badge.style.display = 'block';
    };

    function extractSelectedStyles(el: HTMLElement): Record<string, string> {
      const cs = window.getComputedStyle(el);
      return {
        // Layout / Size / Position (for Figma-like panel defaults)
        display: cs.display,
        position: cs.position,
        top: cs.top,
        right: cs.right,
        bottom: cs.bottom,
        left: cs.left,
        width: cs.width,
        height: cs.height,
        minWidth: cs.minWidth,
        minHeight: cs.minHeight,
        maxWidth: cs.maxWidth,
        maxHeight: cs.maxHeight,
        gap: cs.gap,
        rowGap: cs.rowGap,
        columnGap: cs.columnGap,
        flexDirection: cs.flexDirection,
        flexWrap: cs.flexWrap,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        alignContent: cs.alignContent,
        // Effects / Transform
        transform: cs.transform,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter,
        // Fill advanced
        backgroundImage: cs.backgroundImage,
        backgroundSize: cs.backgroundSize,
        backgroundPosition: cs.backgroundPosition,
        backgroundRepeat: cs.backgroundRepeat,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textAlign: cs.textAlign,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        borderTopWidth: cs.borderTopWidth,
        borderRightWidth: cs.borderRightWidth,
        borderBottomWidth: cs.borderBottomWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderTopColor: cs.borderTopColor,
        borderRightColor: cs.borderRightColor,
        borderBottomColor: cs.borderBottomColor,
        borderLeftColor: cs.borderLeftColor,
        borderTopStyle: cs.borderTopStyle,
        borderRightStyle: cs.borderRightStyle,
        borderBottomStyle: cs.borderBottomStyle,
        borderLeftStyle: cs.borderLeftStyle,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        opacity: cs.opacity,
        '--taku-dm-stroke-width': cs.getPropertyValue('--taku-dm-stroke-width').trim(),
        '--taku-dm-stroke-color': cs.getPropertyValue('--taku-dm-stroke-color').trim(),
        '--taku-dm-stroke-style': cs.getPropertyValue('--taku-dm-stroke-style').trim(),
        '--taku-dm-stroke-position': cs.getPropertyValue('--taku-dm-stroke-position').trim(),
      };
    }

    function findNearestSlotElement(target: HTMLElement | null): HTMLElement | null {
      let cur: HTMLElement | null = target;
      while (cur) {
        const slot = cur.dataset?.slot;
        if (typeof slot === 'string' && slot.trim()) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    function isTextNodeSkippable(textNode: Text, rootEl: HTMLElement): boolean {
      const parent = textNode.parentElement;
      if (!parent) return true;
      const tag = parent.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true;

      // 不跨越“子 slot”边界：避免选中父 slot 时误编辑子 slot 的文本
      let cur: HTMLElement | null = parent;
      while (cur && cur !== rootEl) {
        const slot = cur.dataset?.slot;
        if (typeof slot === 'string' && slot.trim()) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    function findUniqueTextNode(rootEl: HTMLElement): Text | null {
      const doc = rootEl.ownerDocument ?? document;
      const nodes: Text[] = [];

      const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
          const raw = node.textContent ?? '';
          if (!raw.trim()) return NodeFilter.FILTER_REJECT;
          if (isTextNodeSkippable(node, rootEl)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let n = walker.nextNode();
      while (n) {
        nodes.push(n as Text);
        if (nodes.length > 1) break;
        n = walker.nextNode();
      }

      return nodes.length === 1 ? nodes[0] : null;
    }

    function isTargetValidForElement(target: TextTarget, el: HTMLElement): boolean {
      if (target.kind === 'input') return target.el === el;
      if (target.kind === 'contentEditable') return target.el === el;
      // text node target
      return target.node.isConnected && el.contains(target.node);
    }

    function resolveTextTarget(el: HTMLElement): TextTarget | null {
      const cached = textTargetByEl.get(el);
      if (cached && isTargetValidForElement(cached, el)) return cached;

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const next: TextTarget = { kind: 'input', el };
        textTargetByEl.set(el, next);
        return next;
      }

      if (el.isContentEditable) {
        const next: TextTarget = { kind: 'contentEditable', el };
        textTargetByEl.set(el, next);
        return next;
      }

      const node = findUniqueTextNode(el);
      if (!node) return null;
      const next: TextTarget = { kind: 'textNode', node };
      textTargetByEl.set(el, next);
      return next;
    }

    function readTextFromTarget(target: TextTarget): string {
      if (target.kind === 'input') return target.el.value ?? '';
      if (target.kind === 'contentEditable') return target.el.textContent ?? '';
      return target.node.textContent ?? '';
    }

    function applyTextToTarget(target: TextTarget, text: string): void {
      if (target.kind === 'input') {
        target.el.value = text;
        return;
      }
      if (target.kind === 'contentEditable') {
        target.el.textContent = text;
        return;
      }
      target.node.textContent = text;
    }

    function getTextSnapshot(el: HTMLElement): { text?: string; canEditText: boolean } {
      const target = resolveTextTarget(el);
      if (!target) return { canEditText: false };
      const text = readTextFromTarget(target);
      return { text, canEditText: true };
    }

    function computeCapabilities(
      el: HTMLElement,
      canEditText: boolean
    ): {
      text: boolean;
      typography: boolean;
      fillText: boolean;
      fillBackground: boolean;
      stroke: boolean;
      effects: boolean;
      layout: boolean;
      size: boolean;
    } {
      const tag = (el.tagName ?? '').toLowerCase();
      const isForm = tag === 'input' || tag === 'textarea' || tag === 'select';
      const isTextCarrier =
        /^h[1-6]$/.test(tag) || tag === 'p' || tag === 'span' || tag === 'label' || tag === 'li';
      const isInteractive = tag === 'button' || tag === 'a';
      const isContentEditable = Boolean(el.isContentEditable);

      // Text：只在“文本承载/交互/表单/可编辑区域”开放，避免容器（div/section 等）误导用户
      const text =
        isForm || isContentEditable ? canEditText : canEditText && (isTextCarrier || isInteractive);

      const typography = text;
      const fillText = text;

      // 背景/描边/阴影/布局/尺寸：默认开放（Host 会基于自身 UI 支持情况进行细分渲染）
      return {
        text,
        typography,
        fillText,
        fillBackground: true,
        stroke: true,
        effects: true,
        layout: true,
        size: true,
      };
    }

    function postSelectedElement(el: HTMLElement): void {
      const slot = el.dataset?.slot ?? '';
      if (!slot) return;
      const rect = el.getBoundingClientRect();
      const { text, canEditText } = getTextSnapshot(el);
      const href = el instanceof HTMLAnchorElement ? el.href || undefined : undefined;

      const payload: SelectedElementMessage = {
        __taku: true,
        type: 'taku:design-mode:selected-element',
        applicationId: designState.applicationId,
        selection: {
          slot,
          tagName: el.tagName.toLowerCase(),
          capabilities: computeCapabilities(el, canEditText),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: extractSelectedStyles(el),
          classList: Array.from(el.classList),
          text,
          canEditText,
          href,
          timestamp: Date.now(),
        },
      };

      window.parent?.postMessage(payload, '*');
      updateHighlight();
    }

    const onDesignClick = (e: MouseEvent) => {
      if (!designState.enabled) return;
      if (!designState.pickerEnabled) return;

      // Inspect 模式：阻断所有页面点击交互（即使没有命中 data-slot 也不允许触发应用自身行为）
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      // 滚动中：不选择，避免误点；等待 scroll-end（500ms）后可重新选择
      if (designState.scrolling) return;

      const now = Date.now();
      const target = e.target instanceof HTMLElement ? e.target : null;
      const slotEl = findNearestSlotElement(target);
      if (!slotEl) {
        const tag = (target?.tagName ?? '').toLowerCase();
        showHint(tag ? `该 <${tag}> 缺少 data-slot，无法编辑` : '该区域缺少 data-slot，无法编辑');
        if (now - lastClickLogAt > 600) {
          lastClickLogAt = now;
          postDebug('warn', 'click:no-slot', {
            url: window.location.href,
            enabled: designState.enabled,
            pickerEnabled: designState.pickerEnabled,
            targetTag: target?.tagName ?? null,
            targetId: target?.id ?? null,
            targetClass: target?.className ?? null,
          });
        }
        return;
      }

      postDebug('info', 'click:slot', {
        url: window.location.href,
        slot: slotEl.dataset?.slot ?? null,
        targetTag: target?.tagName ?? null,
        slotTag: slotEl.tagName,
      });

      designState.selectedEl = slotEl;
      postSelectedElement(slotEl);
    };

    const resolveSlotElement = (slot: string): HTMLElement | null => {
      if (!slot) return null;
      if (designState.selectedEl && designState.selectedEl.dataset?.slot === slot) {
        return designState.selectedEl;
      }
      const escaped = slot.replace(/["\\]/g, '\\$&');
      return document.querySelector(`[data-slot="${escaped}"]`) as HTMLElement | null;
    };

    function applyPreviewStyle(slot: string, styles: Record<string, string>): void {
      const el = resolveSlotElement(slot);
      if (!el) return;

      const backup = previewStyleBackup.get(el) ?? {};
      for (const [key, value] of Object.entries(styles)) {
        if (typeof value !== 'string') continue;
        if (!(key in backup)) {
          backup[key] = getInlineStyle(el, key);
        }
        try {
          setInlineStyle(el, key, value);
        } catch {
          // ignore invalid style keys
        }
      }
      previewStyleBackup.set(el, backup);
      updateHighlight();
    }

    function applyPreviewContent(slot: string, text: string): void {
      const el = resolveSlotElement(slot);
      if (!el) return;

      const target = resolveTextTarget(el);
      if (!target) return;

      if (!previewTextBackup.has(el)) {
        const prev = readTextFromTarget(target);
        const backup: PreviewTextBackup =
          target.kind === 'textNode'
            ? { kind: 'textNode', node: target.node, prev }
            : { kind: target.kind, prev };
        previewTextBackup.set(el, backup);
      }

      applyTextToTarget(target, text);
      updateHighlight();
    }

    function clearPreview(slot?: string): void {
      const el = slot ? resolveSlotElement(slot) : designState.selectedEl;
      if (!el) return;

      const styleBackup = previewStyleBackup.get(el);
      if (styleBackup) {
        for (const [key, prev] of Object.entries(styleBackup)) {
          try {
            setInlineStyle(el, key, prev);
          } catch {
            // ignore
          }
        }
        previewStyleBackup.delete(el);
      }

      const textBackup = previewTextBackup.get(el);
      if (textBackup) {
        try {
          if (textBackup.kind === 'textNode') {
            if (textBackup.node.isConnected && el.contains(textBackup.node)) {
              textBackup.node.textContent = textBackup.prev;
            } else {
              const target = resolveTextTarget(el);
              if (target?.kind === 'textNode') target.node.textContent = textBackup.prev;
              else if (el.children.length === 0) el.textContent = textBackup.prev;
            }
          } else {
            const target = resolveTextTarget(el);
            if (target && target.kind === textBackup.kind)
              applyTextToTarget(target, textBackup.prev);
          }
        } finally {
          previewTextBackup.delete(el);
        }
      }
    }

    function setDesignModeEnabled(enabled: boolean, applicationId?: string): void {
      designState.enabled = enabled;
      designState.applicationId = applicationId;
      (window as unknown as { __takuApplicationId?: string | null }).__takuApplicationId =
        applicationId ?? null;
      if (!enabled) {
        setPickerEnabled(false);
        clearPreview();
        designState.selectedEl = null;
        hideHighlight();
      } else {
        // 创建 overlay（避免首次点击时抖动）
        ensureDesignModeCss();
        ensureHighlightOverlay();
      }
      postDebug('info', 'design-mode:set-enabled', {
        enabled,
        applicationId: applicationId ?? null,
        url: window.location.href,
      });
    }

    function setPickerEnabled(enabled: boolean): void {
      designState.pickerEnabled = enabled;
      const root = document.documentElement;
      if (enabled) root.classList.add('__taku-picker-enabled');
      else root.classList.remove('__taku-picker-enabled');
      setMaskVisible(enabled);
      // 主动移除旧的 mask 元素（如果存在），彻底消除蓝色蒙版
      if (designState.maskEl) {
        try {
          designState.maskEl.style.display = 'none';
        } catch {
          // ignore
        }
      }
      if (!enabled) {
        designState.scrolling = false;
        if (scrollEndTimer !== null) {
          window.clearTimeout(scrollEndTimer);
          scrollEndTimer = null;
        }
        hideHint();
      }

      // snapshot: data-slot nodes
      const nodes = Array.from(document.querySelectorAll('[data-slot]'));
      const sampleSlots = nodes
        .slice(0, 12)
        .map((n) => (n instanceof HTMLElement ? n.dataset?.slot : null))
        .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));

      postDebug('info', 'picker:set', {
        enabled,
        url: window.location.href,
        htmlHasClass: root.classList.contains('__taku-picker-enabled'),
        cssExists: Boolean(document.getElementById(designCssId)),
        dataSlotCount: nodes.length,
        sampleSlots,
      });
    }

    const onViewportChange = () => updateHighlight();

    const onScroll = () => {
      if (!designState.enabled) return;
      if (!designState.pickerEnabled) return;

      if (!designState.scrolling) {
        designState.scrolling = true;

        // 滚动开始：关闭属性面板（清选中 + 清高亮）
        if (designState.selectedEl) {
          clearPreview();
          designState.selectedEl = null;
          hideHighlight();
          postClearSelection('scroll');
        }
      }

      if (scrollEndTimer !== null) window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        scrollEndTimer = null;
        designState.scrolling = false;
      }, 500);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!designState.enabled) return;
      if (!designState.pickerEnabled) return;
      if (e.key !== 'Escape') return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      if (designState.selectedEl) clearPreview();
      designState.selectedEl = null;
      hideHighlight();
      postClearSelection('esc');
      setPickerEnabled(false);
      postPickerState(false, 'esc');
    };

    document.addEventListener('click', onDesignClick, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown, true);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isPlainObject(event.data)) return;

      const data = event.data as Record<string, unknown>;
      if (data.__taku !== true) return;

      // ============================================================
      // Navigation bridge
      // ============================================================
      if (data.type === 'taku:navigation:command') {
        const msg = data as unknown as NavigationCommandMessage;
        const cmd = msg.command;
        if (cmd !== 'back' && cmd !== 'forward' && cmd !== 'reload') return;

        state.isLoading = true;
        postState();

        if (cmd === 'back') window.history.back();
        else if (cmd === 'forward') window.history.forward();
        else window.location.reload();
        return;
      }

      // ============================================================
      // Design Mode bridge
      // ============================================================
      if (data.type === 'taku:design-mode:command') {
        const cmdRaw = data.command;
        if (!isPlainObject(cmdRaw)) return;
        const cmdType = cmdRaw.type;
        if (typeof cmdType !== 'string') return;

        if (cmdType === 'enable') {
          const appIdRaw = cmdRaw.applicationId;
          const appId = typeof appIdRaw === 'string' ? appIdRaw : undefined;
          setDesignModeEnabled(true, appId);
          return;
        }
        if (cmdType === 'disable') {
          setDesignModeEnabled(false);
          return;
        }

        // 其他命令仅在启用时生效
        if (!designState.enabled) return;

        if (cmdType === 'picker:set') {
          const enabled = Boolean(cmdRaw.enabled);
          setPickerEnabled(enabled);
          return;
        }

        if (cmdType === 'preview-style') {
          const slotRaw = cmdRaw.slot;
          const slot = typeof slotRaw === 'string' ? slotRaw : '';
          const stylesRaw = cmdRaw.styles;
          if (!slot || !isPlainObject(stylesRaw)) return;
          const styles: Record<string, string> = {};
          for (const [k, v] of Object.entries(stylesRaw)) {
            if (typeof v === 'string') styles[k] = v;
          }
          applyPreviewStyle(slot, styles);
          return;
        }

        if (cmdType === 'preview-content') {
          const slotRaw = cmdRaw.slot;
          const textRaw = cmdRaw.text;
          const slot = typeof slotRaw === 'string' ? slotRaw : '';
          const text = typeof textRaw === 'string' ? textRaw : '';
          if (!slot) return;
          applyPreviewContent(slot, text);
          return;
        }

        if (cmdType === 'clear-preview') {
          const slotRaw = cmdRaw.slot;
          const slot = typeof slotRaw === 'string' ? slotRaw : undefined;
          clearPreview(slot);
          return;
        }
      }
    };

    window.addEventListener('message', onMessage);

    // Debug: pointerover 采样（避免刷屏：最多 20 条，每 500ms 一条）
    const onPointerOver = (e: Event) => {
      if (!designState.enabled) return;
      if (!designState.pickerEnabled) return;
      if (!(e.target instanceof HTMLElement)) return;
      const slotEl = findNearestSlotElement(e.target);
      if (!slotEl) return;

      const now = Date.now();
      if (hoverLogCount >= 20) return;
      if (now - lastHoverLogAt < 500) return;
      lastHoverLogAt = now;
      hoverLogCount += 1;

      postDebug('info', 'hover:slot', {
        slot: slotEl.dataset?.slot ?? null,
        tag: slotEl.tagName,
        url: window.location.href,
      });
    };
    document.addEventListener('pointerover', onPointerOver, true);

    // Initial state
    postState();
    applyPersistedOverrides();

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      document.removeEventListener('click', onDesignClick, true);
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('scroll', onScroll, true);
      setDesignModeEnabled(false);
      if (designState.highlightEl) {
        try {
          designState.highlightEl.remove();
        } catch {
          // ignore
        }
        designState.highlightEl = null;
      }
      if (selectedBadgeEl) {
        try {
          selectedBadgeEl.remove();
        } catch {
          // ignore
        }
        selectedBadgeEl = null;
      }
      if (designState.maskEl) {
        try {
          designState.maskEl.remove();
        } catch {
          // ignore
        }
        designState.maskEl = null;
      }
      if (hintEl) {
        try {
          hintEl.remove();
        } catch {
          // ignore
        }
        hintEl = null;
      }
      if (hintTimer !== null) {
        window.clearTimeout(hintTimer);
        hintTimer = null;
      }
      if (scrollEndTimer !== null) {
        window.clearTimeout(scrollEndTimer);
        scrollEndTimer = null;
      }
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}
