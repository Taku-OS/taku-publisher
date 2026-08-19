/**
 * Taku Client Action Bridge (iframe side)
 *
 * 该模块运行在“应用前端”（iframe 内）。
 * 它负责接收 Host (Taku) 的 postMessage 指令，并执行已注册的 client actions，
 * 然后把结果 postMessage 回 Host。
 */

import { executeClientAction, hasClientAction } from './registry';

type ClientActionInvokeMessage = {
  __taku: true;
  type: 'taku:client-action:invoke';
  invocationId: string;
  applicationId?: string;
  action: string;
  params?: Record<string, unknown>;
};

type ClientActionResultMessage =
  | {
      __taku: true;
      type: 'taku:client-action:result';
      invocationId: string;
      applicationId?: string;
      ok: true;
      result?: unknown;
    }
  | {
      __taku: true;
      type: 'taku:client-action:result';
      invocationId: string;
      applicationId?: string;
      ok: false;
      error: string;
    };

let isInitialized = false;

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function parseInvokeMessage(data: unknown): ClientActionInvokeMessage | null {
  if (!isPlainObject(data)) return null;
  if (data.__taku !== true) return null;
  if (data.type !== 'taku:client-action:invoke') return null;

  const invocationId = typeof data.invocationId === 'string' ? data.invocationId.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (!invocationId || !action) return null;

  const applicationId = typeof data.applicationId === 'string' ? data.applicationId : undefined;
  const params = isPlainObject(data.params) ? (data.params as Record<string, unknown>) : undefined;

  return {
    __taku: true,
    type: 'taku:client-action:invoke',
    invocationId,
    applicationId,
    action,
    params,
  };
}

function resolveTargetOrigin(origin: string): string {
  // Electron file:// 场景下 event.origin 可能是 "null"
  if (!origin || origin === 'null') return '*';
  return origin;
}

export function initTakuClientActionBridge(): void {
  if (isInitialized) return;
  isInitialized = true;

  window.addEventListener('message', async (event) => {
    // 仅接收来自 parent 的请求
    if (event.source !== window.parent) return;

    const msg = parseInvokeMessage(event.data);
    if (!msg) return;

    const targetOrigin = resolveTargetOrigin(event.origin);

    const reply = (payload: ClientActionResultMessage) => {
      window.parent.postMessage(payload, targetOrigin);
    };

    if (!hasClientAction(msg.action)) {
      reply({
        __taku: true,
        type: 'taku:client-action:result',
        invocationId: msg.invocationId,
        applicationId: msg.applicationId,
        ok: false,
        error: `Unknown client action: ${msg.action}`,
      });
      return;
    }

    try {
      const result = await executeClientAction(msg.action, msg.params ?? {});
      reply({
        __taku: true,
        type: 'taku:client-action:result',
        invocationId: msg.invocationId,
        applicationId: msg.applicationId,
        ok: true,
        result,
      });
    } catch (error) {
      reply({
        __taku: true,
        type: 'taku:client-action:result',
        invocationId: msg.invocationId,
        applicationId: msg.applicationId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
