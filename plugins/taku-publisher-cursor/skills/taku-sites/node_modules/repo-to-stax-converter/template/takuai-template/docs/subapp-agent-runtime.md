# Taku App Host Agent Runtime（v2）

> 当前状态：v2 SDK、可信 Host 启动证明、逐消息认证、能力目录、大文本分页和不透明媒体资产合同已实现。默认模板仍不申请任何 AI 能力；具体 operation 是否可用只以当前 Desktop Host 返回的 grant 为准。协议仍处于发布前实验阶段，不能仅凭模板代码宣称线上可用。

`taku.agent.run/v2` 是 Taku App 与 Taku Desktop 托管长任务运行时之间的稳定边界。Taku App 只描述“做什么”，不绑定 Codex、Claude Code、模型版本、密钥、代理地址、工作目录或进程参数；Desktop 可以独立更新执行引擎，而采用 v2 SDK 的 Taku App 不需要跟随每次更新。

已经发布、但从未包含 v2 SDK、同源验证 route 和 manifest 声明的旧 Taku App，仍需升级一次。v2 尚未发布，因此没有 v1 兼容或不认证的降级路径。

## 当前能验证什么

- 浏览器 SDK 主动发起 hello，并验证 Desktop 为本次本地 runtime 签发的一次性证明。
- 证明通过后建立最长 10 分钟、不可续期的会话；双方对之后的每一条消息做 HMAC-SHA256 认证。
- `session.confirm` / `session.ready` 完成前，SDK 不会发送任何业务输入。
- RPC 严格绑定 request ID 和 sequence；event 的外层 sequence 必须等于业务 event sequence，继续复用现有 replay、去重和 gap 处理。
- iframe 导航、错误 origin、字段或 MAC 篡改、重放、过期、序列错位、认证超时和传输顺序不可确认都会 fail closed。
- Preview/Edit 的 Next server、READY URL 和内部预热仅使用 `127.0.0.1`。

SDK 认识四个产品级 operation：通用 Agent 执行、报告生成、文生图和文生视频。它们只描述用户想完成的工作，不暴露 provider、模型、CLI、代理地址、路径或密钥。Host 可以只 grant 其中一部分；应用必须先读取已认证 capabilities，再决定是否展示和调用。

正式用户路径是：Planner 创建 Taku App → 应用 manifest 声明所需 operation → SDK 读取已认证 `capabilities()` → Host 根据真实服务端 grant 执行 → 返回进度和结果。普通打包 Desktop 已按服务端授权与真实 runner 接线；应用无需配置开发环境变量或模型。这一接线不代表服务端 grant 已部署或授权已生效，发布前仍须在目标环境逐项确认。

未打包 Desktop 的本地联调授权与正式服务端 grant 是两种不同的验收前提。精确应用的开发 grant、deterministic fake 或手动 QA 面板只能证明对应的联调路径，不能用来证明普通 Planner 创建路径或生产发布已通过。正式验收必须使用目标发布版本和真实 grant；没有 grant 时按真实错误展示不可用，不添加假授权或生成伪结果。

## 按需声明能力

默认 `taku.manifest.json` 没有 `runtimeCapabilities`。Planner/Builder 为需要 AI 的应用按真实用途显式声明，例如报告应用：

```json
{
  "runtimeCapabilities": {
    "protocol": "taku.agent.run/v2",
    "operations": [
      { "id": "research.generateReport", "revision": 1 }
    ]
  }
}
```

唯一 opt-in 示例是 `src/lib/taku-runtime/fixtures/agent-runtime-qa.manifest.json`，覆盖四个 operation，只用于宿主联调，不代表默认应用自动获得 AI 权限。真实 Taku App 只声明自身工作流实际调用的 operation。

需要在真实 Desktop iframe 中查看当前 grant、动态 catalog 和手动运行结果时，使用 [`docs/examples/subapp-agent-runtime-qa`](examples/subapp-agent-runtime-qa/README.md) 的独立 QA 面板。它不会接入默认首页，也不会修改默认 manifest；只有开发者显式挂载页面并点击样例按钮才会启动 run。

声明不等于授权。Host 必须根据真实 document/frame、应用 manifest、账户和运行环境独立计算 grant。未声明返回 `capability_not_declared`，未授权返回 `capability_not_granted`。应用不能在消息中自报 `applicationId`、用户身份、provider、model 或权限来绕过 Host 判断。

## 接口目录（像 API 调试台一样看）

这不是 HTTP API：Taku App 与 Desktop 通过经过认证的 `postMessage` RPC 和事件流通信。因此协议结构用 **AsyncAPI 风格的 channel/message 描述 + JSON Schema** 表达，比 OpenAPI 的 URL/path/verb 模型更贴合；每次握手返回的 `runtime.capabilities.catalog` 才是当前 Host 的机器可读能力目录。应用不要复制一份 provider 或模型列表。

### 协议与 feature negotiation

| 项目 | 值 | 说明 |
| --- | --- | --- |
| 协议 | `taku.agent.run/v2` | operation revision 独立演进 |
| `content-ref-v1` | 可选协商 | 支持大文本 `contentRef` 和 `content.read` |
| `operation-catalog-v1` | 可选协商 | 返回 operation 的 JSON Schema 与宿主固定行为 |
| `asset-open-v1` | 可选协商 | 支持不透明 `assetRef` 和短期播放授权 |

SDK 的 hello 会发送自己理解的 feature。Host 只返回双方都支持的交集；未知 feature 不会让整个 hello 失败。某个调用需要的 feature 没有被接受时，只在该调用处返回 `sdk_unsupported`。

### 四个 operation

| Operation | revision | 主要输入 | 输出 |
| --- | ---: | --- | --- |
| `agent.execute` | 1 | `instruction`，可选 `context`、`language`、输出格式 | `text` / `markdown` / `json`，内联或 `contentRef` |
| `research.generateReport` | 1 | `topic`，可选 `instructions`、`language` | 标题 + 内联 Markdown 或 `contentRef` |
| `media.image.generate` | 1 | `prompt`，可选宽高比；宽高比省略时当前默认为 `1:1` | `images` + 不透明媒体 descriptor |
| `media.video.generate` | 1 | `prompt`，可选宽高比和时长；省略时当前默认为 `16:9`、4 秒 | `videos` + 不透明媒体 descriptor |

`TAKU_AGENT_OPERATION`、`TAKU_AGENT_OPERATION_REVISION` 和 `ResearchGenerateReportInput` 为旧报告 API 的 deprecated 别名，继续兼容；新代码优先使用带 `REPORT` 的名称和 operation-aware 泛型 API。

### RPC methods

| Method | 参数 | 返回/用途 |
| --- | --- | --- |
| `runtime.capabilities` | `{}` | 刷新 grant、feature 交集和可选 operation catalog |
| `agent.start` | operation、revision、`expectedRecoveryScope`、业务 input、idempotency key | 创建或幂等恢复 run |
| `agent.get` | `{runId}` | 最新 snapshot/cursor |
| `agent.subscribe` | `{runId, afterSequence}` | 有序 replay + live event |
| `agent.unsubscribe` | `{subscriptionId}` | 精确退订 |
| `agent.cancel` | `{runId}` | 显式取消 Host run |
| `agent.result` | `{runId}` | 仅成功后读取最终结果 |
| `content.read` | `{runId, contentId, offset, length}` | `length <= 24576` 的 base64url 分页 |
| `asset.open` | `{assetRef}` | 新签发短期、支持 Range 的播放 URL |

### 大文本与媒体资产

内联文本放不下时，Host 返回：

```ts
type ContentRef = {
  contentId: string;
  field: 'content' | 'markdown';
  mediaType: 'text/plain' | 'text/markdown' | 'application/json';
  encoding: 'utf8';
  byteLength: number;
  sha256: string;
  expiresAt: string;
};
```

使用 `readContent()` 或 `readContentText()` 分页读取；SDK 会校验每页的签名响应、offset、累计长度，以及 Host 返回的完整内容 SHA-256 是否始终与 `contentRef` 一致。旧 Host 未协商 `content-ref-v1` 时，小结果仍兼容；大结果必须 fail closed 为 `output_delivery_unsupported`，不能截断或伪造成功。

图片、视频等输出只返回：

```ts
type MediaAsset = {
  assetRef: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'model' | 'other';
  sha256?: string;
  contentType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};
```

`assetRef` 是唯一可传回 Host 的不透明引用，不是 URL 或路径。要预览时调用 `openAsset(assetRef)`；返回的 `playbackUrl` 有很短的有效期且支持 `GET`/`HEAD` 和 byte Range。应用不得持久化、分享或从它推导 provider/模型；过期后重新调用 `openAsset` 获取新授权。

对于页面中持续展示的图片和视频，使用 SDK 的播放租约管理元素 `src`，不要把一次性的 URL 固定留在 React state：

```ts
import { createTakuAgentAssetPlayback } from '@/lib/taku-runtime';

const playback = createTakuAgentAssetPlayback({
  client,
  assetRef: asset.assetRef,
  // 保留生成这份资产时已认证的 scope；不能换成后来登录的新账号 scope。
  expectedRecoveryScope: originalCapabilities.recoveryScope,
  element: videoElement, // HTMLImageElement 也支持；UI 不再另设 src
  onError: () => showPlaybackRetry(),
});
// 用户明确重试，仅重新打开同一资产，不重新 start。
await playback.refresh();
// 组件卸载时清理。不要为单个预览关闭共享 client。
playback.dispose();
```

租约通常提前 5 秒续签，视频换源后恢复 `currentTime` 和播放/暂停状态。临近 Host 绝对 session 边界、返回的期限未前进或剩余不超过 5 秒时，等待实际到期后再进行一次只读请求，避免短 TTL 刷新风暴。旧 session 不能延长；SDK 在到期后的新请求中重新 hello，并重新验证权限与原 `recoveryScope`。`openAsset(assetRef, { expectedRecoveryScope })` 的 scope 保护仅为 SDK 本地约束，不添加协议外字段，也不绕过 Host 校验。

隐藏页面暂停定时续签、忽略迟到结果，重新可见时按期限打开；卸载清理定时器与元素监听器，但不取消共享签名队列中的请求。请求在 SDK 的原超时内有界完成。媒体网络错误最多自动补签一次，失败后停止自动重试并交给显式 `refresh()`；补签与恢复不会重放 `agent.start`。URL 只留在当前租约/元素内，不写入持久化账本。

### Taku App 只表达需求，Proxy 自动选模型

图片和视频供应商的模型、参数与价格会持续变化，因此公共 v1 协议只保留跨供应商稳定的产品参数。Taku App 不发送 provider、model、质量档位或供应商专属参数；Desktop 只负责鉴权、转发和把结果导入应用资产。Taku Proxy 按版本化候选列表、可验证的实时价格与发布策略选择线路：主候选在作业接受前无法安全报价时才选择备用候选；一旦作业被接受，线路与价格快照就固定，网络结果不明时只恢复同一线路，不会跨模型重复提交。这样切换或升级模型时，已经发布的 Taku App 不需要更新。

`quality`、`profile`、批量 `count` 和伪语义 `aspectRatio: "auto"` 都不是公开 v1 输入。稳定的产品默认值由已认证 catalog 明示：图片 `aspectRatio` 当前默认 `1:1`；视频 `aspectRatio` 当前默认 `16:9`，`durationSeconds` 当前默认 `4`。SDK 的 `start()` 不会自行补这些可选字段；Taku App 省略时原样发送，由 Taku Proxy 应用默认值。当前一次图片 operation 只生成一个资产，需要其他版本就再启动一次。Host 的 catalog 可以说明固定行为和当前接受的通用字段，但不能把底层模型选择暴露成应用选项。

当前公开能力只包含文生图和文生视频。图生视频、首尾帧、独立音频、3D/模型等需要新增兼容的通用字段或新 operation revision；未出现在当前 capabilities/catalog/manifest 时，应用不得展示成可用能力。

## 客户端用法

```ts
import {
  createTakuAgentIdempotencyKey,
  getTakuAgentClient,
  TakuAgentError,
  TAKU_AGENT_OPERATION,
  type TakuAgentRunCursor,
} from '@/lib/taku-runtime';

const agent = getTakuAgentClient();
const capabilities = await agent.capabilities();
const granted = capabilities.operations.some(
  ({ id, revision }) => id === TAKU_AGENT_OPERATION && revision === 1
);
if (!granted) throw new Error('This Host did not grant report generation');

// 每个逻辑请求只创建一次；当前页面内的未知投递结果继续复用这个 key。
const idempotencyKey = createTakuAgentIdempotencyKey();
const started = await agent.start({
  operation: TAKU_AGENT_OPERATION,
  operationRevision: 1,
  expectedRecoveryScope: capabilities.recoveryScope,
  idempotencyKey,
  input: {
    topic: 'How local-first AI changes team workflows',
    instructions: 'Compare trade-offs and cite the source material.',
    language: 'en',
  },
});

type TerminalState = 'succeeded' | 'failed' | 'cancelled';
let resolveTerminal!: (state: TerminalState) => void;
let rejectTerminal!: (error: unknown) => void;
const terminalEvent = new Promise<TerminalState>((resolve, reject) => {
  resolveTerminal = resolve;
  rejectTerminal = reject;
});
const failureFromSnapshot = (snapshot: TakuAgentRunCursor['snapshot']) =>
  new TakuAgentError(
    snapshot.error ?? {
      code: 'internal_error',
      message: 'Report generation failed without a Host error payload',
      retryable: false,
    }
  );
const subscription = await agent.subscribe(
  started.snapshot.runId,
  (message) => {
    if (message.event.type === 'output.delta') console.log(message.event.delta);
    if (message.event.type === 'run.result') resolveTerminal('succeeded');
    if (message.event.type === 'run.error') {
      rejectTerminal(
        new TakuAgentError({
          ...message.event.error,
          message: `Report failed: ${message.event.error.message}`,
        })
      );
    }
    if (message.event.type === 'run.state') {
      if (message.event.status === 'succeeded' || message.event.status === 'cancelled') {
        resolveTerminal(message.event.status);
      }
      if (message.event.status === 'failed') {
        // Canonical Host order is failed state, then run.error. Reconcile as a
        // fallback without settling a generic failure before the detailed event.
        void agent
          .get(started.snapshot.runId)
          .then(({ snapshot }) => rejectTerminal(failureFromSnapshot(snapshot)))
          .catch(rejectTerminal);
      }
    }
  },
  {
    afterSequence: started.lastSequence,
    // 订阅错误必须终止页面等待，不能只记录日志后永久挂起。
    onError: rejectTerminal,
  }
);

try {
  const initialState = subscription.snapshot.state;
  if (initialState === 'failed') {
    const latest = await agent.get(started.snapshot.runId);
    throw failureFromSnapshot(latest.snapshot);
  }
  const terminalState =
    initialState === 'succeeded' || initialState === 'cancelled'
      ? initialState
      : await terminalEvent;
  if (terminalState === 'succeeded') {
    const completed = await agent.resultFor(started.snapshot.runId, TAKU_AGENT_OPERATION);
    if ('markdown' in completed.result && completed.result.markdown !== undefined) {
      console.log(completed.result.markdown);
    } else {
      for await (const chunk of agent.readContentText(
        completed.snapshot.runId,
        completed.result.contentRef
      )) {
        console.log(chunk);
      }
    }
  } else {
    throw new Error('Report generation was cancelled');
  }
} finally {
  // 清理失败不能覆盖已经取得的业务结果或业务错误。
  await subscription.unsubscribe().catch(() => undefined);
}
```

其他方法：

- `get(runId)`：读取最新 snapshot 和 `lastSequence`。
- `result(runId)`：任务成功后读取通用最终输出；已知 operation 优先用 `resultFor(runId, operation)` 获得对应类型。
- `cancel(runId)`：发起真实任务取消；`cancelling` 不等于进程树已清理。
- `close()`：拒绝待完成请求、停止业务投递，并对已知订阅做有界的签名退订。

`AbortSignal` 只停止当前页面等待，不会取消 Host 已接受的 run。要停止真实任务，应用必须保存 `runId` 并显式调用 `cancel(runId)`。

上面的最小示例只承诺当前页面内的生命周期。

### 同一标签页刷新恢复

若应用需要支持同一标签页刷新恢复，使用 SDK 的临时账本和恢复 helper，不要自行拼 `sessionStorage` 数据：

```ts
import {
  createTakuAgentRunJournal,
  getTakuAgentClient,
  recoverOrStartTakuAgentRun,
  TakuAgentError,
  TAKU_AGENT_OPERATION,
} from '@/lib/taku-runtime';

const input = { topic: 'How local-first AI changes team workflows', language: 'en' };
const agent = getTakuAgentClient();
const capabilities = await agent.capabilities();
const granted = capabilities.operations.some(
  ({ id, revision }) => id === TAKU_AGENT_OPERATION && revision === 1
);
if (!granted) throw new Error('This Host did not grant report generation');

const journal = createTakuAgentRunJournal({
  storageKey: 'weekly-report:in-flight',
  recoveryScope: capabilities.recoveryScope,
});
const restored = await recoverOrStartTakuAgentRun({
  client: agent,
  journal,
  recoveryScope: capabilities.recoveryScope,
  input,
});

// Immediate succeeded/failed/cancelled snapshots are returned as-is and the helper
// has already attempted to clear the journal. Handle their real business outcome;
// cleanupError is only a secondary recovery warning.
if (restored.cleanupError) console.warn('Recovery journal warning', restored.cleanupError);
if (restored.terminal) {
  if (restored.cursor.snapshot.state === 'succeeded') {
    const completed = await agent.resultFor(
      restored.cursor.snapshot.runId,
      TAKU_AGENT_OPERATION
    );
    if ('markdown' in completed.result && completed.result.markdown !== undefined) {
      console.log(completed.result.markdown);
    } else {
      for await (const chunk of agent.readContentText(
        completed.snapshot.runId,
        completed.result.contentRef
      )) {
        console.log(chunk);
      }
    }
  } else if (restored.cursor.snapshot.state === 'failed') {
    throw new TakuAgentError(
      restored.cursor.snapshot.error ?? {
        code: 'internal_error',
        message: 'Report generation failed without a Host error payload',
        retryable: false,
      }
    );
  } else {
    throw new Error('Report generation was cancelled');
  }
} else {
  let resolveRun!: () => void;
  let rejectRun!: (error: unknown) => void;
  const runFinished = new Promise<void>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  const journalWarning = (error: unknown) => console.warn('Recovery journal warning', error);
  const safelyMutateJournal = (mutation: () => unknown) => {
    try {
      mutation();
    } catch (error) {
      journalWarning(error);
    }
  };

  const subscription = await agent.subscribe(
    restored.cursor.snapshot.runId,
    (message) => {
      // Settle the business outcome before best-effort journal cleanup.
      if (message.event.type === 'run.result') {
        resolveRun();
        safelyMutateJournal(() => journal.clear(restored.journalEntryId));
        return;
      }
      if (message.event.type === 'run.error') {
        rejectRun(new TakuAgentError(message.event.error));
        safelyMutateJournal(() => journal.clear(restored.journalEntryId));
        return;
      }
      if (message.event.type === 'run.state' && message.event.status === 'cancelled') {
        rejectRun(new Error('Report generation was cancelled'));
        safelyMutateJournal(() => journal.clear(restored.journalEntryId));
        return;
      }
      // failed waits for the canonical following run.error; succeeded waits for
      // run.result. Journal failures never prevent those terminal callbacks.
      if (
        message.event.type === 'run.state' &&
        !['failed', 'succeeded'].includes(message.event.status)
      ) {
        safelyMutateJournal(() =>
          journal.update(
            restored.journalEntryId,
            message.sequence,
            message.event.status === 'cancelling' ? 'cancelling' : 'running'
          )
        );
      }
    },
    { afterSequence: restored.cursor.lastSequence, onError: rejectRun }
  );
  try {
    await runFinished;
  } finally {
    await subscription.unsubscribe().catch(journalWarning);
  }
}
```

`recoveryScope` 是 Host 在已认证 capabilities 中返回的不透明值，覆盖 Host 判定 run 可见性所需的完整当前授权边界；具体组成完全由 Host 管理，Taku App 不得解释。账本只会加载 scope、版本和配置 TTL 全部精确匹配的条目；scope 变化时旧条目会被丢弃，应用不得把账号、邮箱、token、release 或 runtime kind 自己拼进 storage key。

`prepare()` 会在返回 start 参数前先写入一个有版本、随机 `entryId`、默认 30 分钟 TTL 的账本。当前 v4 会原位迁移同一默认 key 下仍有效的 v3 report-only 账本，保留原 `runId`、idempotency key 和序号，升级时不会重新发起运行；v3 不能伪装成其他 operation。若页面在 start 结果未知时刷新，账本没有 `runId`，`recoverOrStartTakuAgentRun()` 会用原 input、同一个 idempotency key 和当前 `expectedRecoveryScope` 重试；已有 `runId` 时 helper 只调用 `get(runId)` 对账，不会再次 start。同一 realm 的相同 scope/storage key 调用共享一个 in-flight helper；所有写入和删除还会用捕获的 `entryId` 做 compare-and-set，迟到结果不能覆盖或删除新请求。

只有账本确实不存在时，helper 才会把本次调用视为 fresh start。过期、损坏、未来时间、配置 TTL 不符或 scope 不符的恢复证据会被删除并抛出 `TakuAgentRunRecoveryBlockedError`，本次调用不会自动 start；UI 必须说明恢复证据不可用，并等用户明确点击“重新开始”后再发起一次新调用。确定性的 start 拒绝（如 `input_invalid`、`capability_not_granted`、`idempotency_conflict`）和已有 run 的 `run_not_found` 会只清理它们捕获的 entry；传输超时等未知投递结果保留原 input/key。

若用户明确放弃一个仍有效、但投递结果未知的旧请求，先由该用户操作调用 `journal.discard()`，再创建新逻辑请求；不要在后台自动丢弃并 start，否则可能产生重复工作。

即时 terminal 会在 cursor 未回退且 snapshot 自洽后清理账本；清理失败作为返回值的 `cleanupError`，不能覆盖 succeeded/failed/cancelled 业务结果。非 terminal 写入失败抛出带已接受 `cursor` 的 `TakuAgentRunPersistenceError`，不能伪装成“没有启动”。随后订阅事件时，用 `journal.update(restored.journalEntryId, message.sequence, phase)` 推进，terminal 时用 `journal.clear(restored.journalEntryId)`；两者都要放在独立 `try/catch` 中记录 secondary warning，业务 resolve/reject 必须先执行或置于不受账本异常影响的路径。订阅 `onError` 必须 reject/结束当前 UI 等待；退订清理错误也不能覆盖业务结果。

它只是 `sessionStorage` 中的临时传输账本，不是业务数据真源，只覆盖同 origin、同标签页刷新；不承诺窗口或 Desktop 关闭、跨设备或生产耐久。更长期恢复必须另有已授权的持久化合同，否则应作为发布 blocker 明确报告。

`timeoutMs` 是一次公开 SDK 调用的总预算。`start()` 默认最多等待 120 秒，给用户阅读并回应 Host 授权弹窗的时间；这不是无限等待，也不是任务执行时长上限。其他调用（如 `capabilities()`、`get()`、`result()`）仍默认 10 秒。调用方显式传入的 `timeoutMs`（1–120000 毫秒）或 `signal` 优先；若 SDK 先刷新 `runtime.capabilities`，刷新和随后请求共享同一预算，不会分别获得 120 秒。

在等待窗口内收到 Host 的明确拒绝时，SDK 返回该拒绝；本地超时或 abort 只结束本次等待，不能据此判断 Host 已拒绝或任务已取消。投递结果未知时保留原 input、同一个 idempotency key 和恢复账本：没有 `runId` 时用同一请求恢复，已有 `runId` 时只 `get(runId)` 对账；不要自动换 key 重开，也不要把超时说成“已取消”。真正取消已知运行仍需显式调用 `cancel(runId)`。

## 建立可信会话

1. SDK 创建 32 个随机字节并编码成 43 字符 canonical base64url `clientNonce`，发送 hello。
2. Host 返回 `frameEpoch`、严格 capabilities（包含覆盖当前 run 可见性边界、但对 Taku App 完全 opaque 的 `recoveryScope`）、顶层 `capabilitiesDigest`，以及：

   ```ts
   {
     runtimeInstanceId,
     sessionId,        // 16 个随机字节的 canonical base64url
     proofExpiresAt,   // 启动证明最多 15 秒
     sessionExpiresAt, // 会话最长 10 分钟，绝对过期且不续期
     proof,
   }
   ```

3. SDK 只向固定同源路径 `POST /__taku/host-attestation/verify` 提交公开 transcript。它不接受 Host 提供的 URL，也不会手写浏览器控制的 Fetch Metadata header。
4. route 仅从进程环境读取 `TAKU_CONTROL_TOKEN` 和 `TAKU_APPLICATION_INSTANCE_ID`。它要求：
   - `Origin` 是规范的 `http://127.0.0.1:<port>`，与 `Host` header 精确匹配且与请求 URL 使用相同端口；Next 内部将请求 URL 主机名规范化为 `localhost` 不影响这一检查；
   - `Sec-Fetch-Site: same-origin`、`Sec-Fetch-Mode: cors`、`Sec-Fetch-Dest: empty`；
   - JSON body；
   - `x-taku-agent-session` 精确等于 `sessionId`。
5. route 原子校验并一次性消费 proof 和 nonce。过期、重放、字段不符、缺环境变量、错误 method 或错误 metadata 都只返回通用失败；所有响应 `no-store`、不开放 CORS、不 redirect。
6. route 用 HKDF-SHA256 派生互相独立的 c2h/h2c 32-byte key。浏览器立即把它们导入为不可导出的 WebCrypto HMAC `CryptoKey`，清零临时 byte buffer；authenticator 不保留 session material 对象或 base64url key 字符串。
7. SDK 发送签名 `session.confirm`（c2h/rpc sequence `1`）。只有验证签名 `session.ready`（h2c/rpc sequence `1`）后，才绑定可用 session 并发送业务请求；业务 c2h sequence 从 `2` 开始。

同一 hello 的验证网络失败不会重复使用 proof。失败只终止当前会话；下一次显式 API 调用会生成新的 request ID、nonce 和 hello。上一轮迟到的 hello、验证结果、签名或 ready 按 generation/request ID 丢弃，不能解锁新一轮请求。

## 冻结的字节合同

所有输入均为 UTF-8 编码的无空格 `JSON.stringify` 输出。

### Capabilities

operations 按 JavaScript code-unit 的 `id` 字典序、再按数值 revision 排序；methods 去重后按 `TAKU_AGENT_METHODS` 固定顺序；limits 必须是正 safe integer 且不超过 SDK/Host ceiling。

```ts
JSON.stringify([
  'taku.agent.capabilities/v2',
  recoveryScope,
  operations.map(({ id, revision }) => [id, revision]),
  methods,
  [
    maxConcurrentRuns,
    maxInputBytes,
    maxBufferedEvents,
    maxEventBytes,
    eventRetention,
    maxSubscribersPerRun,
  ],
]);
```

缺失或非法 `recoveryScope`、重复 operation、重复 feature 或非法 limit 会被拒绝。未来 Host 的未知 method/operation/feature 会保留在认证 transcript 中，但只把 SDK 已理解的交集暴露给调用方；digest 为完整 canonical UTF-8 bytes 的 SHA-256 base64url，因此 scope 和未来扩展都受启动证明与会话认证保护。

### 启动证明与会话密钥

```ts
JSON.stringify([
  'taku.agent.attestation/v2',
  protocol,
  requestId,
  clientNonce,
  frameEpoch,
  runtimeInstanceId,
  sessionId,
  capabilitiesDigest,
  proofExpiresAt,
  sessionExpiresAt,
]);
```

`proof = base64url(HMAC-SHA256(UTF8(controlToken), UTF8(canonical)))`。

HKDF-SHA256 使用 `UTF8(controlToken)` 作为 IKM、解码后的 `clientNonce` 作为 salt，长度 32；c2h 与 h2c 分别派生：

```ts
JSON.stringify([
  'taku.agent.session/v1',
  protocol,
  requestId,
  clientNonce,
  frameEpoch,
  runtimeInstanceId,
  sessionId,
  capabilitiesDigest,
  sessionExpiresAt,
  direction, // 'c2h' 或 'h2c'
]);
```

### 逐消息认证

后续 wire 统一为：

```ts
{
  __taku: true,
  protocol: 'taku.agent.run/v2',
  type: 'secure',
  sessionId,
  direction, // 'c2h' 或 'h2c'
  lane,      // 'rpc' 或 'event'
  sequence,  // canonical 正整数十进制字符串
  body,      // 非空、精确 JSON 字符串
  mac,
}
```

MAC canonical：

```ts
JSON.stringify([
  'taku.agent.secure-message/v1',
  protocol,
  sessionId,
  direction,
  lane,
  sequence,
  body,
]);
```

完整 outer envelope 的 UTF-8 JSON 大小硬上限为 65,536 bytes，不是只限制 `body`。c2h request 同时受 Host 公布的 `maxInputBytes + 4 KiB` 限制；event payload 同时受 `maxEventBytes` 限制。

## RPC、事件和失效规则

- c2h RPC 在单一队列中严格递增。签名或 `postMessage` 一旦在占用 sequence 后失败，整段 session 作废，避免留下序列洞。
- h2c response 必须精确匹配仍 pending 的 request ID 和该请求的 c2h sequence，只能接受一次；未知或重放 response 会销毁 session。
- h2c event 的 outer sequence 必须等于业务 event 的数值 sequence。订阅继续按 run 单调递增，重复 event 忽略，gap 返回 `sdk_event_gap` 并尽力精确退订。
- replay 最多为 Host 公布的 `eventRetention`，硬上限 256 条；event payload 按 UTF-8 JSON 计算，硬上限 32,768 bytes。
- `stale_frame`、`account_changed`、会话绝对过期、当前 session 的错误 direction/lane/frame/body/MAC/sequence 都清空 session、grant 和订阅。其他 session ID 或错误 origin 的无关消息不会影响当前 session。
- 清空后不会自动发送新 hello；只有后续显式 API 调用才会重新握手。

## 威胁模型与仍未完成的边界

v2 防止普通第三方 iframe parent 仅靠伪造 hello 冒充 Taku Host，也防止它观察后篡改、伪造或重放业务 wire。它不防止已控制 Taku App 同源 JavaScript 的 XSS，也不替代 Desktop 对真实 document/frame、manifest、账户、Credits、operation 和 runner sandbox 的授权。

因此当前仍保持：

- 默认 manifest 不声明 runtime capability；
- 默认模板不声明任何 operation，是否存在真实 runner 与生产 grant 必须在目标 Desktop 上逐项验收；
- SDK 不直连 Codex/Claude Code、模型、生图/视频供应商或公开 Action endpoint，只调用 Host 已认证且已 grant 的产品级 operation；
- 不把 control token、session key、用户数据或任意 tool/MCP 配置放进 wire、日志、fixture 或文档；
- 不增加猜测性的宽泛 `frame-ancestors`。待 Desktop 给出精确且稳定的父页面 origin/document 合同后，再配置不会误伤真实嵌入方式的 CSP。

Preview/Edit 启动器在输出 READY 前会向固定验证 route 发送一个不带有效 proof 的本机 POST，只为提前编译独立 Next route；它不会消费 attestation。server 与预热请求都只绑定 `127.0.0.1`。

协议 golden vectors 位于 `src/lib/taku-runtime/fixtures/contract-v2.json`，必须与 Desktop 的同名 fixture 字节一致。任何 wire 修改都要同步两端 fixture、合同测试和本文档，不能只改一侧。
