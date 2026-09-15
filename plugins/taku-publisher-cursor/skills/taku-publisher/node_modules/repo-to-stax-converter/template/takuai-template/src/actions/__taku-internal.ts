/**
 * Taku 内部 Actions（不面向最终用户）
 *
 * 目标：
 * - 让宿主（Taku 主进程）可以在运行时动态更新 subapp server 的鉴权信息
 * - 解决 Supabase access token 1h 过期后，子进程 env 无法更新的问题
 *
 * 安全：
 * - 该 action 仅应通过 /__taku/rpc 调用（由宿主携带 X-Taku-Control-Token）
 * - 若未设置 TAKU_CONTROL_TOKEN（非宿主环境），直接拒绝执行
 */

import { registerAction } from '@/lib/actions';
import { setProxyAccessTokenOverride } from '@/lib/proxy/env';

const ACTION_NAME = '__taku_internal:set-service-api-auth';

type InternalSetServiceApiAuthParams = {
  accessToken?: unknown;
  updatedAtMs?: unknown;
};

registerAction(
  {
    name: ACTION_NAME,
    description: '[internal] 设置 Service API 鉴权（宿主专用）',
    params: {
      accessToken: {
        type: 'string',
        required: false,
        description: 'Supabase access token；传空字符串/不传表示清除',
      },
      updatedAtMs: {
        type: 'number',
        required: false,
        description: '宿主侧更新时间（毫秒时间戳），用于 debug/诊断',
      },
    },
    returns: {
      type: 'object',
      description: '是否已设置 token（不会返回 token 本身）',
    },
  },
  async (params: InternalSetServiceApiAuthParams) => {
    // 只有宿主环境才允许动态注入；避免 standalone 场景暴露“远程写 token”能力
    if (!process.env.TAKU_CONTROL_TOKEN) {
      return { success: false, error: 'unauthorized' };
    }

    const rawToken = typeof params.accessToken === 'string' ? params.accessToken : '';
    const token = rawToken.trim();

    const updatedAtMsRaw = params.updatedAtMs;
    const updatedAtMs =
      typeof updatedAtMsRaw === 'number' && Number.isFinite(updatedAtMsRaw)
        ? Math.trunc(updatedAtMsRaw)
        : undefined;

    setProxyAccessTokenOverride({ accessToken: token ? token : null, updatedAtMs });

    return {
      success: true,
      data: {
        ok: true,
        hasAccessToken: Boolean(token),
        updatedAtMs: updatedAtMs ?? null,
      },
    };
  }
);
