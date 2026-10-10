/**
 * GET /__taku/manifest
 *
 * 返回应用根目录下的 taku.manifest.json（或其子集）。
 *
 * 注意：
 * - Next.js App Router 会把以 "_" 开头的目录视为 private folder（不参与路由）
 * - 为了仍然提供外部路径 "/__taku/*"，这里把实现放到 "/api/taku/*"
 * - 由 next.config.ts rewrites 将 "/__taku/*" 映射到 "/api/taku/*"
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const manifestPath = path.join(process.cwd(), 'taku.manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to read taku.manifest.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 }
    );
  }
}
