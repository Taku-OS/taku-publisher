# Proxy AI 开发规范（SubApp）

模板保留 `@/lib/proxy` 与 `@/lib/ai/server` 作为 server-only 集成基建，但不默认向 browser 暴露 AI 或 Service capability。`server-only` 只避免凭据进入客户端 bundle，它本身不完成身份、权限、额度或计费授权。

## 授权前置条件

涉及 AI、Service API、第三方账户、额度或计费时，必须使用一个真实、版本化的 Taku 服务端契约，由 Taku-controlled server 验证 user、app、resource、entitlement 和 usage attribution。If the Taku-controlled server authority contract is absent, the feature must remain visibly blocked.

`TAKU_CONTROL_TOKEN` 仅用于本机 Host RPC transport。The control token is not user identity, app ownership, entitlement, or billing authority. 浏览器不能读取、携带或转发它。

硬规则：

- 不要生成公开 AI endpoint、通用 proxy、通用 Service gateway 或任意 tool loop route。
- 不要因为代码运行在 Route Handler 或 server runtime 就认为请求已获授权。
- 不要接受客户端提供的 user ID、app ID、resource ID 或 billing metadata 作为权限证明。
- 不要在 SubApp 中配置模型厂商 key，也不要把宿主注入的 token 输出到响应、日志或 client bundle。
- 没有服务端 authority contract 时，UI 要解释功能为什么不可用，并保留原始数据；不得伪造 AI 结果。

## 领域调用方式

当且仅当真实服务端授权契约已经存在并完成校验后，领域专属的 server-only operation 才可以调用 `@/lib/ai/server`：

```ts
import { aiCompletionJson } from '@/lib/ai/server';

export async function generateSummary(input: unknown) {
  const authorizedInput = await requireTakuServerAuthority(input);
  const upstream = await aiCompletionJson<unknown>({
    messages: [{ role: 'user', content: authorizedInput.text }],
  });
  const text = extractValidatedText(upstream);
  return { ok: true, text };
}
```

上例中的 `requireTakuServerAuthority` 代表产品已经提供并记录的真实契约，不是模板提供的占位 helper；契约不存在时不要实现一个猜测版。

UI 与 Host Action 应复用同一个领域 operation。若 UI 需要网络边界，只能建立领域专属 Route Handler，并在进入 operation 之前完成真实服务端认证、授权、限流和输入验证。

## 领域响应契约

`aiCompletionJson<T>()` 的泛型参数只有编译期作用。上游结果必须作为 `unknown` 处理，通过 schema 或类型守卫做运行时验证，然后投影成稳定的最小响应。

- 不把完整 provider response 透传给客户端。
- 不把原始 response 改名为 debug 字段后返回。
- 不在失败时猜测、补写或伪造业务结果。
- 明确告知用户哪些文本或资产会发给 Taku-managed service。

```ts
const upstream = await aiCompletionJson<unknown>(input);
const parsed = DomainResponseSchema.safeParse(upstream); // 运行时验证
if (!parsed.success) return { ok: false, error: 'invalid upstream response' };

return { ok: true, text: parsed.data.text }; // 稳定的最小响应
```

## 验证清单

1. 无服务端 authority、身份不匹配、无 entitlement、额度不足与超限都 fail closed。
2. browser 无法调用 credential-backed generic capability，也看不到任何 token。
3. Action / UI 使用相同的 domain operation，并有真实 registry / route-equivalent smoke。
4. 外发说明与实际数据流一致；未执行 Host/browser 认证时明确标记为未认证。
5. 日志、错误和 migration evidence 不包含凭据或完整上游响应。
