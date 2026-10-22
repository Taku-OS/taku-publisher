# Sites 素材自动重试：本地审核说明

基于 `13ffa2a`，分支 `fix/sites-material-auto-retry`。仅本地修改；未 commit / push / 开 PR / 发布。

`packages/publisher-runtime/src/sites/http.ts` 对同一 confirmed upload + ordinal 的素材 start、part、complete 增加自动重试。遇到服务端 `SITE_ASSET_BUSY`、`SITE_ASSET_LEASE_CONFLICT`、`SITE_ASSET_PROVIDER_UNAVAILABLE` 或网络结果丢失时，复用原请求，遵守 `Retry-After`，最多 8 次 HTTP 尝试、每操作总预算 10 分钟。分片保留同一个 Buffer、Content-Length 和 SHA256；401 最多续签一次并共享预算。

重试不涉及项目创建、发布确认、finalize、支付或任意 503。没有新增人工恢复步骤。重试耗尽后保留既有 checkpoint，返回当前错误。

服务端配套修改位于 `/Users/jacky/Developer/Taku/taku-workers-lifecycle-qstash`，需独立审核和发布。旧服务端 409 lease conflict 兼容，但只有新服务端能自动恢复过期且没有 upload ID 的创建租约。

本地验证使用 Bun 安装现有依赖、按工作区顺序运行 TypeScript 编译，再用 Node 原生 test runner。覆盖重试范围、永久错误、8 次上限、10 分钟预算、不截短 Retry-After、秒数 / HTTP-date、相同 Buffer / hash、401 续签、单次发布自动恢复以及项目 / 发布确认不重复。

最终相关回归共 77 个通过（7 个文件），TypeScript 编译通过。可复查：

```sh
bunx tsc -p packages/publisher-runtime/tsconfig.json
node --test packages/publisher-runtime/test/sites-material-retry.test.mjs packages/publisher-runtime/test/sites-publish.test.mjs packages/publisher-runtime/test/sites-assets-download.test.mjs packages/publisher-runtime/test/auth-flow-race.test.mjs packages/publisher-runtime/test/sites-commands.test.mjs packages/publisher-runtime/test/sites-core.test.mjs packages/publisher-runtime/test/sites-sql-sdk.test.mjs
```

跨仓库集成另使用实际 Publisher 客户端、Worker Hono 路由和临时 PG16，R2 为可控替身；创建 / part / complete 结果分别丢失后自动恢复 ready，一个素材 ID、一次容量结算。该验证不代表真实 R2、真实用户认证或生产端到端验收。

完整交付与测试记录见 Worker 仓库 `docs/sites-lifecycle-qstash-local-review-2026-10-22.md`。批准后仍需走 Publisher 正常发布流程；本地源码修改不会自动更新用户已安装的客户端。
