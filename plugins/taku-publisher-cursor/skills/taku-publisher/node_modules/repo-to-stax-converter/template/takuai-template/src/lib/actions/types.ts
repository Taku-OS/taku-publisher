/**
 * SubApp Action 类型定义
 *
 * 定义 Taku AIOS 与 SubApp 交互的 Action 规范
 */

// ============================================
// Action 参数定义
// ============================================

export type ActionParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ActionParamSchema {
  type: ActionParamType;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

// ============================================
// Action 定义
// ============================================

export interface ActionDefinition {
  name: string;
  description: string;
  params?: Record<string, ActionParamSchema>;
  returns?: {
    type: ActionParamType;
    description?: string;
  };
}

// ============================================
// Action 执行
// ============================================

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export type ActionHandler<TParams = Record<string, unknown>, TResult = unknown> = (
  params: TParams
) => Promise<ActionResult<TResult>>;

// ============================================
// Action 上下文（可选，用于高级场景）
// ============================================

export interface ActionContext {
  /** 调用来源：sommelier（AI 调用）或 user（用户直接调用） */
  source: 'sommelier' | 'user' | 'system';
  /** 请求 ID，用于追踪 */
  requestId?: string;
  /** 用户 ID（如果有） */
  userId?: string;
}

// ============================================
// Manifest 定义
// ============================================

export interface TakuManifest {
  name: string;
  description?: string;
  version?: string;
  actions: ActionDefinition[];
}
