/**
 * Client Action Registry
 *
 * 用于在“应用前端（浏览器）”注册可被 Taku Host 触发的 UI Actions。
 *
 * 典型场景：
 * - 播放/暂停音乐
 * - 切换页面/弹出 UI
 * - 操作前端状态（而非服务端逻辑）
 */

export type ClientActionHandler<TParams = Record<string, unknown>, TResult = unknown> = (
  params: TParams
) => Promise<TResult> | TResult;

const clientActionRegistry = new Map<string, ClientActionHandler>();

export function registerClientAction<TParams = Record<string, unknown>, TResult = unknown>(
  name: string,
  handler: ClientActionHandler<TParams, TResult>
): void {
  const actionName = typeof name === 'string' ? name.trim() : '';
  if (!actionName) {
    throw new Error('registerClientAction: name is required');
  }
  if (typeof handler !== 'function') {
    throw new Error(`registerClientAction: handler must be a function (${actionName})`);
  }
  clientActionRegistry.set(actionName, handler as ClientActionHandler);
}

export function hasClientAction(name: string): boolean {
  return clientActionRegistry.has(name);
}

export async function executeClientAction(
  name: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const actionName = typeof name === 'string' ? name.trim() : '';
  const handler = clientActionRegistry.get(actionName);
  if (!handler) {
    throw new Error(`Client action not found: ${actionName}`);
  }
  return await handler(params);
}
