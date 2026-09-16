# Taku App Agent Runtime 本地 QA 面板

这是一个**显式 opt-in** 的开发者示例，用于在真实 Taku Desktop iframe 中观察当前 Host 的 capabilities/catalog，并按实际 grant 手动测试四个产品级 operation。它不会进入默认首页，也不会修改默认 `taku.manifest.json`；页面挂载时只读取能力，只有开发者点击按钮才会启动业务 run。

## 临时接入

在独立测试分支或一次性测试应用中完成下面三步，不要把这些临时接线留在产品页面：

1. 备份根目录 `taku.manifest.json`，再临时用 `src/lib/taku-runtime/fixtures/agent-runtime-qa.manifest.json` 替换它。
2. 将同目录的 `AgentRuntimeQaPanel.tsx` 复制到 `src/components/agent-runtime-qa-panel.tsx`。
3. 新建一个仅本地使用的 Next 页面，并渲染该组件：

   ```tsx
   import AgentRuntimeQaPanel from '@/components/agent-runtime-qa-panel';

   export default function AgentRuntimeQaPage() {
     return <AgentRuntimeQaPanel />;
   }
   ```

用该测试应用的精确 Application ID 配置未打包 Desktop 的本地 grant，然后从 Desktop 打开页面。面板只会展示 Host 当前确实 grant 的 operation；没有 grant、目录未协商、认证失败和运行失败都有显式错误码，不会伪装成空白成功。

这个本地面板不是正式发布验收的替代品。正式验收要从目标打包 Desktop 的 Planner 会话创建应用，使用真实服务端 grant；不能用开发应用 flag 或 deterministic fake 证明该路径可用。

## 面板验证的合同

- 先读取已认证的 `runtime.capabilities` 和动态 operation catalog，不维护另一份能力真值。
- manifest 声明四项能力，但声明本身不等于授权；UI 只渲染 Host 返回的 grant。
- 每个 operation 使用独立恢复账本。同一逻辑请求在投递结果未知或页面刷新后复用原 idempotency key，不会静默创建第二个 run。
- 从 start cursor 的 `lastSequence` 订阅 replay + live event，等待真实 `run.result` / `run.error` / cancelled 终态，并将订阅错误作为当前等待的失败。
- 大文本只通过 `contentRef` + `readContentText()` 分页读取；不会自己拼接特权请求。
- 图片和视频在 React state 中保留不透明 `assetRef` 及生成时的已认证 `recoveryScope`。`createTakuAgentAssetPlayback()` 管理短期 URL：到期前续签、网络错误一次补签、隐藏时暂停与显示时恢复；视频换源后恢复位置及播放/暂停状态。失败可点「Retry playback only」，不会重新生成。
- 播放 URL 不持久化；完成后的预览仅在当前页面保留，整页刷新不会自动重建已清理账本的完成结果。不得把刷新页面当成已完成资产的恢复机制。
- 请求只包含产品级 operation 输入，不携带执行引擎、服务实现、密钥、地址或本地文件信息。
- 媒体示例故意只发送 `prompt`：SDK 不补可选字段，Proxy 根据已认证 catalog 应用当前产品默认值（图片 `1:1`；视频 `16:9`、`4` 秒）。

## 使用边界

- 本示例不会自动发起任何 Agent、图片或视频任务。点击媒体按钮前，应确认当前测试账号额度和测试目的。
- deterministic fake 是否覆盖某项 operation，以当前 Desktop runner 为准；不要因为 manifest 声明了四项就把它们写成“已上线”。
- 播放验收需覆盖超过 5 分钟后 seek，以及超过 10 分钟绝对 session 边界后的继续播放。临近 session 期限时租约不会高频重签；到期后的只读 `openAsset` 会重新 hello，scope 变化则停止。隐藏/恢复、卸载和失败重试也不应启动新的业务 run。
- 如果恢复账本被判定为过期、损坏或 scope 不匹配，面板会返回 `recovery_blocked`，不会自动丢弃证据并重开任务。需要测试者明确决定后，才可手动清理该 operation 的临时账本。
- 完成验证后恢复原 manifest，并删除临时页面与复制出的组件。默认模板应继续保持无 AI capability、无 QA UI。
