/**
 * POST /__taku/rpc
 *
 * Taku 主进程的“通用动作调用网关”会调用该接口：
 * - 若应用未启动：主进程会先启动应用并等待 READY
 * - 调用时携带 X-Taku-Control-Token（若存在）
 *
 * 注意：
 * - Next.js App Router 会把以 "_" 开头的目录视为 private folder（不参与路由）
 * - 为了仍然提供外部路径 "/__taku/*"，这里把实现放到 "/api/taku/*"
 * - 由 next.config.ts rewrites 将 "/__taku/*" 映射到 "/api/taku/*"
 *
 * 本实现复用模板已有的 ActionRegistry（src/lib/actions/*），从而：
 * - action 定义在代码里（registerAction）
 * - /__taku/rpc 负责把请求路由到 action handler
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { executeAction, hasAction } from '@/lib/actions';

export const runtime = 'nodejs';

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function controlTokensMatch(presented: string, required: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const requiredBytes = Buffer.from(required, 'utf8');
  return (
    presentedBytes.length === requiredBytes.length && timingSafeEqual(presentedBytes, requiredBytes)
  );
}

export async function POST(request: Request) {
  const requiredToken = process.env.TAKU_CONTROL_TOKEN;
  if (!requiredToken) {
    return NextResponse.json(
      { ok: false, error: 'control authentication unavailable' },
      { status: 503 }
    );
  }

  const token = request.headers.get('x-taku-control-token');
  if (!token || !controlTokensMatch(token, requiredToken)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  await import('@/actions/index');

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ ok: false, error: 'Body must be a JSON object' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const params = isPlainObject(body.params) ? body.params : {};

  if (!action) {
    return NextResponse.json({ ok: false, error: 'action is required' }, { status: 400 });
  }

  if (!hasAction(action)) {
    return NextResponse.json({ ok: false, error: `Action not found: ${action}` }, { status: 404 });
  }

  const result = await executeAction(action, params);
  if (!result.success) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error || `Action failed: ${action}`,
        details: result,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, result });
}
