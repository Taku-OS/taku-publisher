import 'server-only';

import { ProxyError } from './errors';

const LOG_PREFIX = '[ProxyEnv]';
const HARD_CODED_PROXY_BASE_URL = 'https://ai-proxy.taku.ai';

/**
 * access token 覆盖（tri-state）：
 * - undefined：未覆盖，回退到 process.env.TAKU_SERVICE_API_KEY（spawn 时注入的静态值）
 * - string：使用覆盖值（用于宿主在 TOKEN_REFRESHED 后推送最新 token）
 * - null：显式清除（logout 时宿主推送清除，避免回退到旧 env）
 */
let accessTokenOverride: string | null | undefined;
let accessTokenOverrideUpdatedAtMs: number | null = null;

/**
 * 获取 ai-proxy 根地址（不带 /claude，不带 /gemini，不带 /service）。
 *
 * 约定：模板侧固定使用线上正式域名，避免环境分叉导致调用行为不一致。
 */
export function getProxyBaseUrl(): string {
  return HARD_CODED_PROXY_BASE_URL;
}

/**
 * 获取当前 SubApp 的应用 ID，用于计费归因（X-App-Id）。
 */
export function getProxyAppId(): string {
  const appId = (process.env.TAKU_APPLICATION_ID ?? '').trim();
  if (!appId) {
    throw new ProxyError({
      code: 'MISSING_PROXY_APP_ID',
      message: `${LOG_PREFIX} 缺少环境变量 TAKU_APPLICATION_ID（用于计费归因 X-App-Id）。该 SubApp 必须运行在 Taku 宿主内。`,
    });
  }
  return appId;
}

/**
 * 宿主通过 /__taku/rpc 调用内部 action 来更新 token（解决 1 小时过期问题）。
 *
 * SECURITY:
 * - 不要打印 token
 * - 仅 server-only 可调用
 */
export function setProxyAccessTokenOverride(params: {
  accessToken: string | null;
  updatedAtMs?: number;
}): void {
  // 统一 trim，空串视为清除
  const next =
    typeof params.accessToken === 'string' ? params.accessToken.trim() : params.accessToken;
  accessTokenOverride = next ? next : null;
  accessTokenOverrideUpdatedAtMs =
    typeof params.updatedAtMs === 'number' && Number.isFinite(params.updatedAtMs)
      ? Math.trunc(params.updatedAtMs)
      : Date.now();

  // 同步更新 process.env（提高 Next dev/HMR 下的稳定性）
  // - override 丢失时仍可从 env fallback 到最新 token
  // - 清除时必须同步清除 env，避免回退到旧 token
  if (accessTokenOverride) {
    process.env.TAKU_SERVICE_API_KEY = accessTokenOverride;
  } else {
    delete process.env.TAKU_SERVICE_API_KEY;
  }
}

/**
 * 获取宿主注入的 Supabase access token（用于调用 ai-proxy）。
 *
 * SECURITY:
 * - 这是 secret，只能在 server runtime 使用。
 * - 该模块被标记为 server-only，任何 client component 引入都会在构建时报错。
 */
export function getProxyAccessToken(): string {
  // 1) 覆盖优先（宿主推送的最新 token / 显式清除）
  if (accessTokenOverride !== undefined) {
    if (!accessTokenOverride) {
      throw new ProxyError({
        code: 'MISSING_PROXY_ACCESS_TOKEN',
        message: `${LOG_PREFIX} 缺少 access token。请先在 Taku 中登录。`,
      });
    }
    return accessTokenOverride;
  }

  // 2) fallback：子进程启动时注入的 env（静态）
  const token = (process.env.TAKU_SERVICE_API_KEY ?? '').trim();
  if (!token) {
    // 检测是否可能处于构建阶段（构建时不会注入 TAKU_APPLICATION_INSTANCE_ID）
    const isBuildPhase = !process.env.TAKU_APPLICATION_INSTANCE_ID;
    if (isBuildPhase) {
      throw new ProxyError({
        code: 'MISSING_PROXY_ACCESS_TOKEN',
        message: `${LOG_PREFIX} Service API 只能在运行时调用，不能在构建阶段（getStaticProps/generateStaticParams）使用。请将 Service API 调用移到 Route Handler 或动态渲染中。`,
      });
    }
    throw new ProxyError({
      code: 'MISSING_PROXY_ACCESS_TOKEN',
      message: `${LOG_PREFIX} 缺少环境变量 TAKU_SERVICE_API_KEY。请先在 Taku 中登录。`,
    });
  }
  return token;
}

/**
 * 仅用于 debug/健康检查（不返回 token）。
 */
export function getProxyAccessTokenState(): {
  source: 'override' | 'env' | 'missing';
  hasToken: boolean;
  updatedAtMs?: number | null;
} {
  if (accessTokenOverride !== undefined) {
    return {
      source: 'override',
      hasToken: Boolean(accessTokenOverride),
      updatedAtMs: accessTokenOverrideUpdatedAtMs,
    };
  }

  const envToken = (process.env.TAKU_SERVICE_API_KEY ?? '').trim();
  if (envToken) return { source: 'env', hasToken: true };
  return { source: 'missing', hasToken: false };
}
