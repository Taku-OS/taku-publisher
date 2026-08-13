import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Fix: avoid Turbopack inferring a wrong workspace root when multiple lockfiles exist
    // (can cause massive scans / slow builds / "stuck" builds in multi-subapp setups).
    root: __dirname,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 关键：将 preview/edit 的 .next 输出隔离，避免 next dev 覆盖/清理 prod build 产物，
  // 从而导致“启动过 edit 后，下次打开 preview 又要 build”。
  distDir:
    process.env.TAKU_RUNTIME_KIND === 'preview'
      ? '.next-preview'
      : process.env.TAKU_RUNTIME_KIND === 'edit'
        ? '.next-edit'
        : '.next',
  async rewrites() {
    // Next.js App Router treats folders starting with "_" as private (not routable).
    // We still want public endpoints like "/__taku/rpc" & "/__taku/manifest".
    // So we implement handlers under "/api/__taku/*" and rewrite to them here.
    return [{ source: '/__taku/:path*', destination: '/api/taku/:path*' }];
  },
  // 其他配置...
};

// Dev 侧辅助日志（给 Taku 排障用）
// 注意：真正的 READY marker 由 scripts/start-edit.js 输出（HTTP 探活后再输出），避免误判。
if (process.env.TAKU_RUNTIME_KIND === 'edit' && process.env.NODE_ENV === 'development') {
  process.nextTick(() => {
    const port = process.env.DEV_PORT || process.env.PORT || '3000';
    console.log('\x1b[36m%s\x1b[0m', '[TAKUAI-INFO]', `Dev server booting on port ${port}`);

    // 延迟访问首页进行预编译，增加重试机制
    const checkCompilation = async (retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await fetch(`http://localhost:${port}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (response.ok) {
            console.log('\x1b[36m%s\x1b[0m', '[TAKUAI-COMPILED]', `Template homepage compiled and accessible`);
            return;
          }
        } catch (error: unknown) {
          if (attempt === retries) {
            // 最后一次重试失败，静默处理，不显示错误
            return;
          }
          // 重试前等待
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    };

    setTimeout(() => checkCompilation(), 3000);
  });
}

export default nextConfig;
