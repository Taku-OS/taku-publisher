/**
 * Client Actions 注册入口（应用前端执行）
 *
 * 当你在 `taku.manifest.json` 的某个 action 上声明：
 *   "runtime": "client_postmessage"
 *
 * Taku Host 会把该 action 下发到应用前端（iframe）执行，而不是走服务端 `/__taku/rpc`。
 *
 * 你需要在这里注册对应的 client action handler，例如：
 *
 * ```ts
 * import { registerClientAction } from '@/lib/client-actions/registry';
 *
 * registerClientAction('yourActionName', async (params) => {
 *   // 在这里做 UI 交互：播放音乐、打开弹窗、更新前端状态等
 *   return { ok: true };
 * });
 * ```
 *
 * 注意：
 * - 这段代码运行在浏览器环境（不能用 Node API）。
 * - 如涉及自动播放媒体，可能会被浏览器策略拦截（需要用户手势或降级处理）。
 */

export {};
