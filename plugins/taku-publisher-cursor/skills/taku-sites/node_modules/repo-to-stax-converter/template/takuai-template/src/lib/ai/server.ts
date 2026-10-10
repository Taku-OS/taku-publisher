import 'server-only';

import { proxyJson, proxySse } from '@/lib/proxy';
import { buildClaudeMessagesRequest } from './claude-adapter';
import type { AiCompletionRequest, AiRequiredCapability, AiRoutingPolicy } from './types';

// ============================================================
// Local LLM（Ollama）检测
// ============================================================

export type LocalLlmCapability = AiRequiredCapability;

function isLocalLlmEnabled(): boolean {
  return process.env.TAKU_LOCAL_LLM_ENABLED === 'true';
}

function getLocalLlmBaseUrl(): string {
  return (process.env.TAKU_LOCAL_LLM_BASE_URL ?? 'http://localhost:11434').replace(/\/+$/, '');
}

function getLocalLlmModel(): string {
  const model = process.env.TAKU_LOCAL_LLM_MODEL;
  if (!model)
    throw new Error(
      '[AI] TAKU_LOCAL_LLM_MODEL is not set. Taku should inject this when local LLM is enabled.'
    );
  return model;
}

function readLocalLlmCapabilities(): LocalLlmCapability[] {
  const raw = process.env.TAKU_LOCAL_LLM_CAPABILITIES ?? '';
  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(isLocalLlmCapability);
}

function isLocalLlmCapability(value: string): value is LocalLlmCapability {
  return (
    value === 'completion' ||
    value === 'embedding' ||
    value === 'vision' ||
    value === 'tools' ||
    value === 'thinking'
  );
}

function inputContainsImages(input: AiCompletionRequest): boolean {
  return (input.messages ?? []).some((message) =>
    Array.isArray(message.content)
      ? message.content.some((part) => part?.type === 'image_url')
      : false
  );
}

function inferRequiredCapabilities(input: AiCompletionRequest): LocalLlmCapability[] {
  const inferred = new Set<LocalLlmCapability>(input.requiredCapabilities ?? []);

  if ((input.messages ?? []).length > 0) inferred.add('completion');
  if (inputContainsImages(input)) inferred.add('vision');
  if (Array.isArray(input.tools) && input.tools.length > 0) inferred.add('tools');
  if (input.reasoning || input.reasoning_effort) inferred.add('thinking');

  return Array.from(inferred);
}

function getMissingLocalCapabilities(required: LocalLlmCapability[]): LocalLlmCapability[] {
  const localCapabilities = readLocalLlmCapabilities();
  if (localCapabilities.length === 0) {
    // Conservative fallback: when capability metadata is missing, only assume plain
    // text completion is available. Do not silently allow vision/tools/thinking calls.
    return required.filter((capability) => capability !== 'completion');
  }
  return required.filter((capability) => !localCapabilities.includes(capability));
}

function resolveRoutingPolicy(
  input: AiCompletionRequest,
  options?: AiCompletionOptions
): AiRoutingPolicy {
  if (options?.routingPolicy) return options.routingPolicy;
  if (options?.localOnly) return 'local_only';
  if (input.routingPolicy) return input.routingPolicy;
  return 'prefer_local';
}

// ============================================================
// OpenAI → Claude 响应格式归一化（JSON）
// ============================================================

interface OpenAiChoice {
  index?: number;
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAiChatCompletion {
  id?: string;
  object?: string;
  model?: string;
  choices?: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ClaudeContentBlock {
  type: 'text';
  text: string;
}

interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface ClaudeNormalizedResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<ClaudeContentBlock | ClaudeToolUseBlock>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

const OPENAI_TO_CLAUDE_STOP_REASON: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
};

function normalizeOpenAiToClaude(raw: OpenAiChatCompletion): ClaudeNormalizedResponse {
  const choice = raw.choices?.[0];
  const message = choice?.message;

  const content: Array<ClaudeContentBlock | ClaudeToolUseBlock> = [];

  if (message?.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (message?.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = { raw_arguments: tc.function.arguments };
      }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: raw.id ?? `msg_local_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: raw.model ?? getLocalLlmModel(),
    stop_reason: OPENAI_TO_CLAUDE_STOP_REASON[choice?.finish_reason ?? ''] ?? 'end_turn',
    usage: {
      input_tokens: raw.usage?.prompt_tokens ?? 0,
      output_tokens: raw.usage?.completion_tokens ?? 0,
    },
  };
}

// ============================================================
// OpenAI → Claude SSE 流格式转换
// ============================================================

interface OpenAiSseChunk {
  id?: string;
  object?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createOpenAiToClaudeSseTransform(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let sentPrologue = false;
  let outputTokens = 0;

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6).trim();

        if (payload === '[DONE]') {
          controller.enqueue(
            encoder.encode(
              sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }) +
                sseEvent('message_delta', {
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn' },
                  usage: { output_tokens: outputTokens },
                }) +
                sseEvent('message_stop', { type: 'message_stop' })
            )
          );
          continue;
        }

        let parsed: OpenAiSseChunk;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (!sentPrologue) {
          sentPrologue = true;
          controller.enqueue(
            encoder.encode(
              sseEvent('message_start', {
                type: 'message_start',
                message: {
                  id: parsed.id ?? `msg_local_${Date.now()}`,
                  type: 'message',
                  role: 'assistant',
                  content: [],
                  model: parsed.model ?? getLocalLlmModel(),
                  stop_reason: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              }) +
                sseEvent('content_block_start', {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                })
            )
          );
        }

        const choice = parsed.choices?.[0];
        const delta = choice?.delta;

        if (delta?.content) {
          outputTokens++;
          controller.enqueue(
            encoder.encode(
              sseEvent('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content },
              })
            )
          );
        }

        if (choice?.finish_reason) {
          const stopReason = OPENAI_TO_CLAUDE_STOP_REASON[choice.finish_reason] ?? 'end_turn';
          const usageTokens = parsed.usage?.completion_tokens ?? outputTokens;
          controller.enqueue(
            encoder.encode(
              sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }) +
                sseEvent('message_delta', {
                  type: 'message_delta',
                  delta: { stop_reason: stopReason },
                  usage: { output_tokens: usageTokens },
                }) +
                sseEvent('message_stop', { type: 'message_stop' })
            )
          );
        }
      }
    },

    flush(controller) {
      if (!sentPrologue) {
        controller.enqueue(
          encoder.encode(
            sseEvent('message_start', {
              type: 'message_start',
              message: {
                id: `msg_local_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: getLocalLlmModel(),
                stop_reason: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }) +
              sseEvent('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              })
          )
        );
      }
      controller.enqueue(
        encoder.encode(
          sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }) +
            sseEvent('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: outputTokens },
            }) +
            sseEvent('message_stop', { type: 'message_stop' })
        )
      );
    },
  });
}

// ============================================================
// Local LLM — 直连 Ollama（OpenAI 兼容端点）
// ============================================================

/**
 * 将 AiCompletionRequest 转为 OpenAI Chat Completion 格式（Ollama 兼容）。
 */
function buildOpenAiRequest(input: AiCompletionRequest, stream: boolean) {
  const localCapabilities = readLocalLlmCapabilities();
  if (inputContainsImages(input) && !localCapabilities.includes('vision')) {
    throw new Error(
      `Local model (${getLocalLlmModel()}) does not support image understanding. ` +
        `Capabilities: ${localCapabilities.join(',') || 'none'}.`
    );
  }

  const messages = (input.messages ?? []).map((m) => ({
    role: m.role === 'tool' ? ('user' as const) : m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : (m.content?.map((p) => {
            if (p.type === 'text') return { type: 'text' as const, text: p.text };
            return { type: 'text' as const, text: '[image]' };
          }) ?? ''),
  }));

  return {
    model: getLocalLlmModel(),
    messages,
    stream,
    ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
    ...(typeof input.max_tokens === 'number' ? { max_tokens: input.max_tokens } : {}),
  };
}

async function localCompletionJson<T = unknown>(input: AiCompletionRequest): Promise<T> {
  const baseUrl = getLocalLlmBaseUrl();
  const body = buildOpenAiRequest(input, false);

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local LLM error ${res.status}: ${text}`);
  }

  const raw: OpenAiChatCompletion = await res.json();
  return normalizeOpenAiToClaude(raw) as T;
}

async function localCompletionSse(input: AiCompletionRequest): Promise<Response> {
  const baseUrl = getLocalLlmBaseUrl();
  const body = buildOpenAiRequest(input, true);

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local LLM error ${res.status}: ${text}`);
  }

  const transformed = res.body!.pipeThrough(createOpenAiToClaudeSseTransform());

  const outHeaders = new Headers();
  outHeaders.set('content-type', 'text/event-stream; charset=utf-8');
  outHeaders.set('cache-control', 'no-cache, no-transform');
  outHeaders.set('x-accel-buffering', 'no');

  return new Response(transformed, { status: 200, headers: outHeaders });
}

// ============================================================
// 模型来源追踪
// ============================================================

export type AiModelSource = 'local' | 'proxy';

let _lastModelSource: AiModelSource | null = null;

/**
 * 获取最近一次 AI 调用使用的模型来源。
 * 子应用可在 Route Handler 中调用此函数，将来源信息返回给前端。
 */
export function getLastModelSource(): AiModelSource | null {
  return _lastModelSource;
}

/**
 * 查询当前运行时是否启用了本地模型路由。
 * 注意：宿主可能会注入本地模型元信息，但只有启用后调用才会真正走本地。
 */
export function isLocalModelAvailable(): boolean {
  return isLocalLlmEnabled();
}

/**
 * 获取当前配置的本地模型名称（如 qwen2.5:3b）。未配置时返回 null。
 */
export function getLocalModelName(): string | null {
  try {
    return getLocalLlmModel();
  } catch {
    return null;
  }
}

/**
 * 获取当前配置的本地模型能力（如 completion / vision / tools）。
 */
export function getLocalModelCapabilities(): LocalLlmCapability[] {
  return readLocalLlmCapabilities();
}

// ============================================================
// 统一入口（自动选择 Local LLM 或 Cloud Proxy）
// ============================================================

export interface AiCompletionOptions {
  /**
   * 为 true 时，强制只使用本地模型，失败则抛错（不降级到云端）。
   * 适用于用户明确要求"使用本地模型"的场景。
   */
  localOnly?: boolean;
  /**
   * 显式指定本次调用的路由策略。优先级高于 input.routingPolicy。
   */
  routingPolicy?: AiRoutingPolicy;
}

/**
 * 统一 AI Completion（非流式 JSON）。
 *
 * 响应格式：始终返回 Claude Messages API 格式（与 proxy 路径一致），
 * 本地 Ollama 的 OpenAI 格式响应会自动转换。调用方只需按 Claude 格式解析。
 *
 * 路由策略：
 * - TAKU_LOCAL_LLM_ENABLED=true 时优先走本地 Ollama。
 * - localOnly=true 时，本地失败直接抛错，不降级。
 * - localOnly=false（默认）时，本地失败会降级到 ai-proxy 并打印警告。
 * - 未启用本地模型时直接走 ai-proxy（localOnly=true 会抛错）。
 */
export async function aiCompletionJson<T = unknown>(
  input: AiCompletionRequest,
  options?: AiCompletionOptions
): Promise<T> {
  const routingPolicy = resolveRoutingPolicy(input, options);
  const localOnly = routingPolicy === 'local_only';
  const requiredCapabilities = inferRequiredCapabilities(input);
  const missingCapabilities = getMissingLocalCapabilities(requiredCapabilities);
  const configuredLocalModel = getLocalModelName();

  if (routingPolicy === 'cloud_only') {
    _lastModelSource = 'proxy';
    console.log('[AI] Using cloud proxy (Claude) due to routingPolicy=cloud_only');
    const request = buildClaudeMessagesRequest({ ...input, stream: false });
    return await proxyJson<T>('/claude/v1/messages', {
      method: 'POST',
      json: request,
      timeoutMs: 120_000,
    });
  }

  if (configuredLocalModel && missingCapabilities.length > 0) {
    const message =
      `Local model (${configuredLocalModel}) is missing required capabilities: ${missingCapabilities.join(', ')}. ` +
      `Available: ${getLocalModelCapabilities().join(',') || 'none'}.`;

    if (localOnly) {
      throw new Error(`${message} routingPolicy=local_only, will not fall back to cloud proxy.`);
    }

    console.warn(`[AI] ${message} Falling back to cloud proxy.`);
    _lastModelSource = 'proxy';
    const request = buildClaudeMessagesRequest({ ...input, stream: false });
    return await proxyJson<T>('/claude/v1/messages', {
      method: 'POST',
      json: request,
      timeoutMs: 120_000,
    });
  }

  if (isLocalLlmEnabled()) {
    try {
      const result = await localCompletionJson<T>(input);
      _lastModelSource = 'local';
      console.log(`[AI] ✅ Using local model: ${getLocalLlmModel()}`);
      return result;
    } catch (err) {
      if (localOnly) {
        console.error('[AI] ❌ Local LLM failed (localOnly=true, no fallback):', err);
        throw new Error(
          `Local model (${getLocalLlmModel()}) failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'localOnly is enabled, will not fall back to cloud proxy.'
        );
      }
      console.warn('[AI] ⚠️ Local LLM failed, falling back to cloud proxy:', err);
    }
  } else if (localOnly) {
    throw new Error(
      'localOnly is enabled but TAKU_LOCAL_LLM_ENABLED is not set. ' +
        'Please set a default local model in Taku Settings → Local Models.'
    );
  }

  _lastModelSource = 'proxy';
  console.log('[AI] Using cloud proxy (Claude)');
  const request = buildClaudeMessagesRequest({ ...input, stream: false });
  return await proxyJson<T>('/claude/v1/messages', {
    method: 'POST',
    json: request,
    timeoutMs: 120_000,
  });
}

/**
 * 统一 AI Completion（流式 SSE）。
 *
 * 响应格式：始终返回 Claude Messages SSE 事件格式（message_start →
 * content_block_start → content_block_delta* → content_block_stop →
 * message_delta → message_stop）。本地 Ollama 的 OpenAI SSE 格式会自动转换。
 *
 * 路由策略同 aiCompletionJson。
 * 返回的是可直接 `return` 的 Response（SSE 透传）。
 */
export async function aiCompletionSse(
  input: AiCompletionRequest,
  options?: AiCompletionOptions
): Promise<Response> {
  const routingPolicy = resolveRoutingPolicy(input, options);
  const localOnly = routingPolicy === 'local_only';
  const requiredCapabilities = inferRequiredCapabilities(input);
  const missingCapabilities = getMissingLocalCapabilities(requiredCapabilities);
  const configuredLocalModel = getLocalModelName();

  if (routingPolicy === 'cloud_only') {
    _lastModelSource = 'proxy';
    console.log('[AI] Using cloud proxy (Claude SSE) due to routingPolicy=cloud_only');
    const request = buildClaudeMessagesRequest({ ...input, stream: true });
    return await proxySse('/claude/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
      timeoutMs: 180_000,
    });
  }

  if (configuredLocalModel && missingCapabilities.length > 0) {
    const message =
      `Local model (${configuredLocalModel}) is missing required capabilities: ${missingCapabilities.join(', ')}. ` +
      `Available: ${getLocalModelCapabilities().join(',') || 'none'}.`;

    if (localOnly) {
      throw new Error(`${message} routingPolicy=local_only, will not fall back to cloud proxy.`);
    }

    console.warn(`[AI] ${message} Falling back to cloud proxy.`);
    _lastModelSource = 'proxy';
    const request = buildClaudeMessagesRequest({ ...input, stream: true });
    return await proxySse('/claude/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
      timeoutMs: 180_000,
    });
  }

  if (isLocalLlmEnabled()) {
    try {
      const result = await localCompletionSse(input);
      _lastModelSource = 'local';
      console.log(`[AI] ✅ Using local model (SSE): ${getLocalLlmModel()}`);
      return result;
    } catch (err) {
      if (localOnly) {
        console.error('[AI] ❌ Local LLM SSE failed (localOnly=true, no fallback):', err);
        throw new Error(
          `Local model (${getLocalLlmModel()}) SSE failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'localOnly is enabled, will not fall back to cloud proxy.'
        );
      }
      console.warn('[AI] ⚠️ Local LLM SSE failed, falling back to cloud proxy:', err);
    }
  } else if (localOnly) {
    throw new Error(
      'localOnly is enabled but TAKU_LOCAL_LLM_ENABLED is not set. ' +
        'Please set a default local model in Taku Settings → Local Models.'
    );
  }

  _lastModelSource = 'proxy';
  console.log('[AI] Using cloud proxy (Claude SSE)');
  const request = buildClaudeMessagesRequest({ ...input, stream: true });
  return await proxySse('/claude/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    timeoutMs: 180_000,
  });
}
