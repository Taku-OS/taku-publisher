# 多步 AI 与工具权限边界（Template）

## 1. 默认能力

模板只保留 server-only 的 AI completion、Service API helper 与领域开发骨架，不默认向 browser 开放这些能力，也不提供通用 Agent Loop、文件工具、命令工具或可从 HTTP 调用的工具注册中心。

这是刻意的安全边界：SubApp Route Handler 是客户端可伪造的网络入口，不能把提示词、工具白名单或命令黑名单当作权限控制。

AI、托管服务、外部写入或 browser mutation 的前提，是一个 real, versioned Taku-controlled server authority contract 已经验证 user、app、resource、operation、entitlement 与 usage attribution。If the authority contract is absent, every managed/external capability and browser mutation remains visibly blocked；`server-only`、Server Action 或 Route Handler 都不能单独充当认证边界。

## 2. 推荐实现方式

仅当上述真实服务端 authority contract 已经存在并授权当前操作时，才可以实现多步 AI 能力：

1. 先定义具体产品能力与最小输入/输出，不建立“执行任意工具”的通用接口。
2. 将领域操作实现为 server-only 函数，在任何副作用前重新验证服务端 authority、输入和领域约束。
3. Host Action 可通过 fail-closed 的本地 RPC 调用该操作；本地 control token 不替代托管或外部副作用所需的服务端业务授权。
4. 只有真实 authority contract 提供了 browser 认证通道时，领域专属 Route Handler 才能在重新认证和授权后调用该操作；否则 UI 写操作保持 blocked。
5. 模型调用复用 `@/lib/ai/server`；托管服务调用复用 `@/lib/proxy`，并以 `.taku/context/service-api/` 中发现的契约为准。这些 helper、artifact、环境值或 client ID 都不是 authority。
6. 只向客户端返回稳定、最小且可验证的领域结果，不返回内部轨迹、环境信息或原始工具结果。

## 3. 高权限工具的前置条件

如果产品明确需要文件系统、进程、命令或网络代理能力，必须先由 Taku 宿主提供：

- 宿主认证与逐次授权；
- 服务端重新绑定用户、SubApp、资源和 entitlement，不能信任客户端自报 ID；
- 独立进程级 sandbox，限制文件系统、环境变量、子进程与网络；
- 有界输入、超时、输出上限、审计与撤销机制；
- 针对越权、重放、路径穿越、符号链接、命令注入和数据外传的契约测试。

缺少任一项时，停止实现并把能力标记为 blocked。不要退化为公开或未认证 Route，也不要在模板中附带“暂时不可达”的高权限工具代码。

## 4. 返回值规则

- UI 文本只消费显式的字符串字段。
- 原始模型响应与内部诊断只能留在服务端受控日志中，不能直接返回或渲染。
- Route 层若重映射字段，应通过运行时 schema 校验最终响应形状。
- 失败响应不得泄露堆栈、文件路径、环境变量、提示词或上游凭据。

## 5. 验证清单

- 没有通用工具执行 HTTP 入口。
- 没有客户端可直接调用的原始 collection 写接口。
- Host Action 调用真实 registry 与 server-only operation；缺少真实服务端 authority 时，managed/external capability 和 browser mutation 保持 blocked。
- 有 browser authority contract 时，领域 Route 在每次请求上完成服务端认证和授权后才复用同一个 operation。
- 未认证、未授权或输入无效时，持久化与外部副作用为零。
- 高权限能力若未具备宿主授权和进程级隔离，被明确阻断而不是假装完成。
