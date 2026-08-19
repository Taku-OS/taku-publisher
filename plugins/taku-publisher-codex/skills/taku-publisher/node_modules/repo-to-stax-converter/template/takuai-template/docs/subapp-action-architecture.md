# SubApp Action 架构

SubApp 用 `taku.manifest.json` 声明 Taku Host 可以发现和调用的能力。The manifest is the sole Host Action catalog；运行时 registry 只负责执行已经由 manifest 声明的 Action，不能反向成为能力发现入口。

## 唯一的 Host 调用链

```text
taku.manifest.json
  -> Taku Desktop catalog
  -> Host-authenticated POST /__taku/rpc
  -> control token availability + timing-safe header validation
  -> lazy await import(src/actions/index.ts)
  -> Action registry
  -> server-only domain operation
  -> durable store / managed service
```

- Host 从 manifest 读取 Action 定义，不从 SubApp 的 HTTP runtime 拉取 catalog。
- `/__taku/rpc` 是唯一的 Host Action transport，必须在 `TAKU_CONTROL_TOKEN` 缺失、空或不匹配时 fail closed。
- RPC route 模块顶层不得静态 side-effect import `src/actions/index.ts`。只有 token 存在且 request header 通过 `node:crypto` 的 `timingSafeEqual` 校验后，POST handler 才能 `await import('@/actions/index')`，并且必须先于任何 `hasAction` 或 `executeAction`。
- `TAKU_CONTROL_TOKEN` 只证明请求来自本机 Taku Host transport。The control token is not user identity, app ownership, entitlement, or billing authority.
- 不要建立公开的 Action catalog、通用 Action executor、通用 collection、proxy、upload、filesystem、shell 或 tool 路由。
- browser UI 不能读取、转发或复用 Host control token。

## 业务授权边界

本地 Host transport 与业务授权是两个不同问题。涉及远端共享数据、第三方账户、计费、额度、所有权或其他 managed/external write 时，必须先有版本化的 Taku 服务端契约，在 Taku-controlled server 上验证用户、应用、资源、权限和使用归因。

If the real Taku-controlled server authority contract is absent, the capability must remain visibly blocked. 不要用本地环境变量、客户端传入的 ID、隐藏 UI 状态或 Host control token 猜测授权。

Host Action 仅操作当前 SubApp 私有本地数据时，仍需在 server-only domain operation 中做输入验证、领域约束与持久化。Browser-originated mutation remains blocked unless a real Taku-controlled server authority contract authenticates and authorizes it；`Server Action`、`server-only` 与领域专属 Route Handler 都不能单独充当认证边界。

## Manifest 与实现

根目录 manifest 必须使用静态、可验证的定义：

```json
{
  "name": "music-player",
  "description": "音乐播放器",
  "version": "1.0.0",
  "actions": [
    {
      "name": "play",
      "description": "播放指定歌曲",
      "params": {
        "song": {
          "type": "string",
          "required": true,
          "description": "歌曲名称"
        }
      }
    }
  ]
}
```

对应 Action 在 `src/actions/` 注册，并由 `src/actions/index.ts` 明确导入：

```ts
// src/actions/music.ts
import { registerAction } from '@/lib/actions';
import { playTrack } from '@/lib/music/server';

registerAction(
  {
    name: 'play',
    description: '播放指定歌曲',
    params: {
      song: { type: 'string', required: true, description: '歌曲名称' },
    },
  },
  async ({ song }) => playTrack({ song }),
);
```

```ts
// src/actions/index.ts
import './music';

export {};
```

`src/actions/index.ts` 及其导入模块的顶层只负责执行 `registerAction`，不能在加载时读写数据库、访问网络/文件系统、启动进程或产生其他业务效果。所有业务效果必须发生在 Action handler 或 handler 调用的 server-only domain operation 内；因此未认证的 route import 或 POST 不会加载业务 Actions，也不会触发业务效果。

注册定义与 manifest 的 name、description、params、returns 语义必须一致。定义必须是递归静态对象字面量，避免 spreads、computed values、helper calls 或 imported schema constants 破坏静态验证。

## Action 与 UI 必须同源

Action 修改后，用户重新打开 UI 必须看到相同状态。不要让 Action 写内存变量、UI 却读 `localStorage`；这会产生 split-brain。

推荐结构：

```text
Host Action handler -> one server-only domain operation -> SQLite

authorized browser route --(only with real Taku server authority)--> same operation
```

- 每个 mutation 只实现一次 domain operation。
- operation 负责 schema 验证、领域约束和 durable write。
- 有真实服务端 authority 时，browser route 与 Host Action handler 复用同一个 operation；否则 browser mutation 保持 blocked。
- 通用 store 只是持久化机制，不是授权边界；不得把原始 record CRUD 暴露给浏览器。
- 对外发送的用户输入必须在 UI 中清楚说明；服务不可用或授权缺失时返回真实 blocked 状态，不得伪造成功或降级成假数据。

## 可执行验证

Action 测试必须加载真实 registry，而不是 mock 一份平行实现：

```ts
import '@/actions/index';
import { executeAction, hasAction } from '@/lib/actions';
```

上述显式 import 只用于 app-local Action contract test。RPC route test 必须从空 registry 开始，证明 route 模块导入、缺少 token 和错误 token 均不会加载 `src/actions/index.ts`，认证成功后才加载以内部 Action 为稳定哨兵的 registration root；它不得依赖生成 workspace 会删除的示例 Action。产品 Action 的真实 handler 与返回结构由产品域测试覆盖。

最小门禁包括：

1. manifest 与注册定义语义一致。
2. 每个 public Action 调用真实 handler，并断言实际 `data` 结构和 nesting。
3. 缺少与错误 Host token 均被拒绝；缺少服务端业务授权时 managed/external 操作保持 blocked。
4. 已授权 UI mutation 与 Host Action 共用同一 domain operation 和 durable store；缺授权时验证 UI 写操作保持 blocked。
5. 未声明 Action、无效输入、上游错误与持久化失败都有可读的失败结果。

Host/browser 端到端认证若尚未执行，必须标记为未认证，不能用本地单测替代。
