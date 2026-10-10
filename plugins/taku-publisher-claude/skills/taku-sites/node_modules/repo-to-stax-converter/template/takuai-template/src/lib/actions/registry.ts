/**
 * Action 注册中心
 *
 * 管理 SubApp 的所有可调用 Actions
 */

import type { ActionDefinition, ActionHandler, ActionResult } from './types';

// Action 注册表
const actionRegistry = new Map<string, ActionHandler>();

// Action 元数据（用于生成 manifest）
const actionMetadata = new Map<string, ActionDefinition>();

/**
 * 注册一个 Action
 *
 * @example
 * ```ts
 * registerAction(
 *   {
 *     name: 'play',
 *     description: '播放指定歌曲',
 *     params: {
 *       song: { type: 'string', required: true, description: '歌曲名称' }
 *     }
 *   },
 *   async ({ song }) => {
 *     await player.play(song);
 *     return { success: true, message: `正在播放: ${song}` };
 *   }
 * );
 * ```
 */
export function registerAction<TParams = Record<string, unknown>, TResult = unknown>(
  definition: ActionDefinition,
  handler: ActionHandler<TParams, TResult>
): void {
  const { name } = definition;

  actionRegistry.set(name, handler as ActionHandler);
  actionMetadata.set(name, definition);
}

/**
 * 执行一个 Action
 */
export async function executeAction(
  name: string,
  params: Record<string, unknown> = {}
): Promise<ActionResult> {
  const handler = actionRegistry.get(name);

  if (!handler) {
    return {
      success: false,
      error: `Action not found: ${name}`,
    };
  }

  try {
    const result = await handler(params);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 获取所有已注册的 Action 定义
 */
export function getRegisteredActions(): ActionDefinition[] {
  // 过滤内部动作（避免出现在公开 Action 列表中）
  // 约定：内部动作以 "__taku_internal:" 前缀命名
  return Array.from(actionMetadata.values()).filter((a) => !a.name.startsWith('__taku_internal:'));
}

/**
 * 检查 Action 是否存在
 */
export function hasAction(name: string): boolean {
  return actionRegistry.has(name);
}

/**
 * 获取单个 Action 的定义
 */
export function getActionDefinition(name: string): ActionDefinition | undefined {
  return actionMetadata.get(name);
}

/**
 * 清空所有注册（主要用于测试）
 */
export function clearActions(): void {
  actionRegistry.clear();
  actionMetadata.clear();
}
