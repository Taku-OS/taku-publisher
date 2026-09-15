/**
 * TakuAI WebView API Interface
 * 为 TakuAI Electron 应用提供元素分析接口
 *
 * 注意：元素选择器功能由 TakuAI 主应用实现
 * Template 项目只负责提供元素分析能力
 */

import {
  analyzeAllInteractables,
  getSmartElementDescription,
  type SmartElementDescription,
} from './smart-element-analyzer';

// 全局类型声明
declare global {
  interface Window {
    takuaiAPI: {
      getElementDescription: (domId: string) => SmartElementDescription | null;
      analyzeAllElements: () => SmartElementDescription[];
    };

    // 调试工具
    debugTakuAI: () => void;
  }
}

/**
 * 初始化 TakuAI WebView API
 */
function initializeTakuAIAPI() {
  // 主要 API 接口
  window.takuaiAPI = {
    getElementDescription: getSmartElementDescription,
    analyzeAllElements: analyzeAllInteractables,
  };

  // 调试工具
  window.debugTakuAI = () => {
    // 使用 Biome 允许的方式记录信息
    if (process.env.NODE_ENV === 'development') {
      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.group('🔍 TakuAI 调试信息');

      // 分析所有交互元素
      const interactables = analyzeAllInteractables();
      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.log('📊 交互元素统计:', {
        总数: interactables.length,
        按类型分组: groupBy(interactables, (item) => item.basic.tagName),
        按语义角色分组: groupBy(interactables, (item) => item.codeInference.semanticRole),
      });

      // 快捷操作
      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.log('⚡ API 接口:');
      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.log('  window.takuaiAPI.getElementDescription(domId) - 分析指定元素');
      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.log('  window.takuaiAPI.analyzeAllElements() - 分析所有交互元素');

      // biome-ignore lint/suspicious/noConsole: Debug function for development
      console.groupEnd();
    }

    return {
      totalElements: 0, // 这个方法本身在函数中定义了 interactables，这里可以设为 0
      apiStatus: 'ready',
      availableMethods: Object.keys(window.takuaiAPI),
    };
  };

  if (process.env.NODE_ENV === 'development') {
    // biome-ignore lint/suspicious/noConsole: Initialization log for development
    console.log('✅ TakuAI WebView API 已初始化');
    // biome-ignore lint/suspicious/noConsole: Development hint for debugging
    console.log('📘 使用 window.debugTakuAI() 查看调试信息');
  }
}

// 辅助函数
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, number> {
  return array.reduce(
    (groups, item) => {
      const key = keyFn(item);
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    },
    {} as Record<string, number>
  );
}

// 自动初始化
if (typeof window !== 'undefined') {
  // 等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTakuAIAPI);
  } else {
    initializeTakuAIAPI();
  }
}

export { initializeTakuAIAPI };
