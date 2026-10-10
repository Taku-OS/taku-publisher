/**
 * AI Gateway types for SubApps.
 *
 * 说明：
 * - 该文件 **不包含** server-only 指令，允许在 client 侧仅作为类型引用。
 * - 真正的网络调用只能通过 `@/lib/ai/server`（server-only）或 Route Handlers 进行。
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type AiMessage = {
  role: AiRole;
  /**
   * 兼容 OpenAI/UniAPI 的 string 或多模态数组格式。
   */
  content?: string | AiContentPart[];
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
    thought_signature?: string;
  }>;
  tool_call_id?: string;
};

export type AiToolDefinition = {
  name: string;
  description?: string;
  parameters?: unknown;
};

export type AiRequiredCapability = 'completion' | 'embedding' | 'vision' | 'tools' | 'thinking';

export type AiRoutingPolicy = 'prefer_local' | 'local_only' | 'cloud_only';

export type AiCompletionRequest = {
  /**
   * 可选：模型名称。
   *
   * 当前模板在服务端会统一覆盖为固定 Claude 模型，
   * 因此传入值仅用于兼容旧调用方，不作为最终事实源。
   */
  model?: string;
  messages: AiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: string;
  reasoning?: { effort?: 'high' | 'medium' | 'low'; max_tokens?: number };
  tools?: Array<{ type: 'function'; function: AiToolDefinition }>;
  /**
   * 可选：本次调用要求的能力。若本地模型不满足，运行时会按 routingPolicy 决策。
   */
  requiredCapabilities?: AiRequiredCapability[];
  /**
   * 可选：本次调用的最小路由策略。
   * - prefer_local: 本地满足则本地，否则走云端
   * - local_only: 必须本地，不满足则报错
   * - cloud_only: 强制云端
   */
  routingPolicy?: AiRoutingPolicy;
};

export type AiErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};
