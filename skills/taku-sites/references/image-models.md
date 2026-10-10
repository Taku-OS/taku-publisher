# 图片型号选择与 v2 报价

SubApp 与 Site 的图片生成、图片编辑使用同一模型目录。此参考用于新应用的选型；旧 v1 请求保留旧默认和严格输入，不把 model 塞进 `start`、`generateImage` 或 `editImage`。

## 构建阶段

1. 用户已经点名型号，或项目已经保存预算/型号偏好时沿用，不重复询问。
2. 未指定时问一次：“图片模型你更倾向便宜优先，还是质量优先？也可以指定型号。”用既有对话或选择交互；超时、取消和推荐项不是用户明确回答，也不是付费授权。可以先制作不调用付费接口的 UI，不能把未回答记为已经选择。
3. 按确切 operation 查询 live 目录。内部 SubApp 用 `service_search`，内部 Site 用 `site_capability_search`；外部 Publisher 用 `sites-image-models --operation media.image.generate --json`（编辑换为 `media.image.edit`，query/cursor/limit 按命令 help）。`@API` 只是发现线索。
4. 保留精确 model ID、parameterSchemaVersion、parameters 和各 surface 的 availability。displayName 不是 model ID；provider endpoint 不是允许提交的 ID。目录中的 priceVersion 不是 credits 金额。没有可比较的报价，不声称哪个实际更便宜；便宜按同尺寸/数量的报价比较，质量结合模型能力，不把价格高等同于质量高。
5. Planner 把已确认的预算/型号、目录版本和参数写入 Builder 的现有 spec（实施中的变更走既有 steer）。Builder 将选择落到应用业务配置，例如 `src/config/image-models.ts`；生成/编辑分别配置。不要新增 Site manifest 字段、Builder 执行模型设置或服务端权限字段。

尺寸参数按当次目录决定。`type: 'size'` 的 `sizeConstraints` 描述宽高、像素面积、可选宽高比及正整数 `widthStep` / `heightStep`；默认值和用户选择都必须满足这些限制，宽高分别是对应步长的整倍数。例如步长为 16 时，不能选 2047 像素；其他型号可能用 1，不统一套用同一网格。Publisher 目录命令与导出 SDK 固定协商 `generation-references-v1`，继承整数选项、尺寸步长、旧 v1 配对规则及 v2 多参考图 / 显式蒙版契约，不增加权限或改变付款人。旧服务端不含尺寸规则的原目录仍可读；缺少尺寸规则或 `parameters: null` 时不要猜测上限或改为空对象。新版约束缺步长、步长非法或默认值不在网格时拒绝目录；不静默降级掩盖缺失规则，修复后重试同一查询。分页 cursor 只沿同次目录格式使用。目录可读、尺寸有效也不代表型号 ready，报价与提交继续由服务端核验。

对象参数使用当次目录的 `type: 'object'` 和 `structuredSchema`。按其中的 `properties`、`required`、类型、数值范围、`maxItems` / `maxBytes` 组装闭合对象；只提交已公开的字段，数组保持原顺序。只有明确 `nullable: true` 的字段可以为 `null`；省略、`null` 和空字符串是不同意图。保留原生数字、布尔值、Unicode 和完整嵌套对象，不转成字符串、展开成请求头或补上未选择的默认值。服务端按该型号和参数版本逐一校验；此协议不开放任意 JSON、provider URL、凭据或付款人字段。没有对象 schema、目录无效或型号 unavailable 时保留选择并报告缺口，不能猜供应商参数或绕过旧 reader。报价与恢复使用保存的完整参数和原 requestId / executionId / quoteId，不把“宽高相同”当成嵌套意图一致。

整数参数存在 `integerValues` 时，使用目录列出的数字选项。例如 Lightning 步数 `[1,2,4,8]` 的合法选择是 1、2、4、8，提交原生数字。`minimum: 1` / `maximum: 8` 不表示整个 1—8 区间可选；默认 4 也不表示只允许 4。字符串 `"4"`、集合外值和小数应在报价前报参数错误，保留用户原选择，供用户修改；不要转字符串、取整或换成默认值。未显式选择的参数保持未提交，由既有服务端合同处理默认值。型号没有该字段时继续按该型号自己的参数合同处理。

编辑型号的 `inputContract.schema` 为 `taku.image-input-contract.v1` 时，按其 `roles: ['source', 'mask']` 和 `sameDimensions: true` 制作原图及蒙版两个输入位。分别经 SDK 的 `createInput` → `uploadInput` 取得不同的 owned input ID，`input_ids` 固定为 `[sourceInputId, maskInputId]`；两张图宽高必须一致，不用输入数量或显示名称猜角色。当前此契约要求恰好两项，不能遗漏、复用同一 input ID 或在恢复时重排原意图。v2 的多参考图 / 可选蒙版用法见下方 GPT 示例，不套用恰好两项限制。普通编辑没有该字段时按自身目录规则，不强加蒙版，也不猜测蒙版颜色/透明度等未公开约定。生成不使用编辑的 source / mask 契约；可选生成参考图见下方 v3 规则。服务端核验实际 owned bytes、尺寸、当前授权和已保存的输入顺序；输入角色由应用槽位决定，服务端不会从图片内容自动识别哪张是原图或蒙版。不能用客户端宽高或 provider URL 绕过核验。输入/目录不满足要求时保留现有项目和型号，说明缺口，不静默改成整图 remix 或另一个型号。

应用配置形状（值必须来自当次目录与用户选择）：

```ts
const imageChoice = {
  operation: 'media.image.generate',
  model: '<exact live catalog id>',
  parameterSchemaVersion: '<exact live version>',
  parameters: { /* only this model's public parameters */ },
};
// economy/quality 是项目偏好；不要作为请求参数发给 SDK。
```

选中型号 unavailable、旧 Host/SDK 不支持 v2 或目录不可达时，显示明确状态，向 Planner 报告具体缺口。不能静默换型号、忽略选择走旧默认、直连 provider 或伪造输出。缺口解除后沿原项目继续，不另建项目。

## 可选生成参考图

生成型号公开 `inputContract.schema: 'taku.image-input-contract.v3'` 时，按 `roles: ['reference']`、`sameDimensions: false` 和 `generationReferences` 制作参考图输入位。当前 minimumReferences 为 0，maximumReferences 等于该型号 maximumInputs；纯文字生成允许零张，参考图按用户顺序提交不同的 opaque owned input ID。保持 operation 为 `media.image.generate`，不切换成编辑端点，不提交 provider URL 或客户端尺寸证明。没有 v3 契约的生成型号不接收参考图，不能丢掉用户图片继续收费。

目录表示只说明输入规则，不增加上传、调用权限或 ready。生成参考图按下面步骤明确选择 `media.image.generate` 取得 owned input ID；SubApp 须握手确认 `image-model-generation-references-v1`。当前运行环境未提供桥接时报告具体缺口并保留选择，不借用编辑 scope 或伪造 input ID。下面报价函数按当前型号容量验证密集唯一 ID，服务端继续核验实际图片归属和上限。

## 应用运行

SubApp：从 `@/lib/taku-runtime` 获取 `getTakuAgentClient()`，先确认 manifest 的 exact operation、当前签名 grant 与 `image-model-execution-v2` feature；在 Client Component 内使用客户端本身作为下面的 api，surface 为 `subapp`。选图及 prepare 都显式传入同一 operation，按下方用户输入步骤取得 inputId。上传与生成的逻辑 ID 分开保存；取消拾图不启动任务。不要自行读取文件路径或字节。

Site：使用 `createTakuSitesClient()` 的 `taku.media` 作为 api；保留 required auth、实际 image_generate/image_edit operation 和相应 scope。当前预览使用 `site-preview`，发布站使用 `site-published`；从受管运行上下文确定，不从型号是否 ready 反推运行环境。生成参考图和编辑按下方步骤显式选择 operation，使用 `createInput` → `uploadInput` 的 input_id。Worker 不导入浏览器 SDK，不转发身份 Cookie，也不倒手生成结果 bytes。

### 用户图片输入

上传参考图是独立于生成的步骤，不自动报价或提交。先从项目配置取精确 operation；每张图片使用单独、稳定的上传 requestId，生成 requestId 另存。生成参考图保持 `media.image.generate`，编辑 / mask 保持 `media.image.edit`；SDK 省略 operation 的兼容默认仍是 edit，不适用于生成参考图。

SubApp 在 Client Component 的用户动作中调用下例。当前 Host 协商 `image-model-operation-grants-v1` 时，图片 v2 的精确授权在已认证 capabilities.imageOperations 中；operations 是旧 Agent runner 的交集，空数组不代表图片模型不可用。未协商时才检查旧 operations。还须有 execution / content / picker 与 prepare 方法，生成额外要求 `image-model-generation-references-v1`。这些检查只用于 UI 准入，SDK / Host / 服务端继续核验当前身份与授权；不可自行构造 capabilities 或 grant。

<!-- runnable:subapp-image-input:start -->
```js
async function pickConfiguredSubAppImage(api, operation, requestId) {
  if (!['media.image.generate', 'media.image.edit'].includes(operation)) {
    throw new Error('image_model_input_invalid');
  }
  const capabilities = await api.capabilities();
  const features = capabilities.features ?? [];
  const grants = features.includes('image-model-operation-grants-v1')
    ? capabilities.imageOperations : capabilities.operations;
  if (!features.includes('content-ref-v1') ||
      !features.includes('asset-pick-v1') ||
      !features.includes('image-model-execution-v2') ||
      !capabilities.methods.includes('asset.pick') ||
      !capabilities.methods.includes('media.image.input.prepare') ||
      !Array.isArray(grants) ||
      !grants.some(item => item.id === operation && item.revision === 1) ||
      (operation === 'media.image.generate' &&
        !features.includes('image-model-generation-references-v1'))) {
    throw new Error('image_model_inputs_unavailable');
  }
  const picked = await api.pickAsset({ operation });
  if (picked.length === 0) return null;
  return api.prepareImageInput({
    operation, assetRef: picked[0].assetRef, requestId,
  });
}
```
<!-- runnable:subapp-image-input:end -->

取消返回 null，不上传、不生成。多张参考图由明确的 UI 输入位逐张选取，保存返回的 inputId、expiresAt 和用户顺序，不读取本机路径 / bytes。旧 Host 缺少生成桥接时显示具体不可用原因；不能借用 edit grant 上传后伪称生成已授权。

Site 在浏览器用户事件取得 File / Blob，使用 createInput 的所选 operation 和原上传 requestId。下例的 checkpoint 是本次用户 / Site 会话的临时上传记录（operation、requestId、permit）；传入的 saveCheckpoint 必须在返回前完成保存。网络结果未知时复用保存的 permit 和同一图片，不另建输入。permit 过期或身份变化时报告具体错误并保留原意图，不能跨账号 / Site 复用。permit 是短期上传能力，不写日志、源码、长期公共数据或页面 URL。

<!-- runnable:site-image-input:start -->
```js
async function uploadConfiguredSiteImage(api, image, checkpoint, saveCheckpoint) {
  if (!checkpoint ||
      !['media.image.generate', 'media.image.edit'].includes(checkpoint.operation) ||
      typeof checkpoint.requestId !== 'string' ||
      typeof saveCheckpoint !== 'function' ||
      !(image instanceof Blob) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) ||
      image.size < 1 || image.size > 20 * 1024 * 1024) {
    throw new Error('image_model_input_invalid');
  }
  const saved = structuredClone(checkpoint);
  if (!saved.permit) {
    saved.permit = await api.createInput(image.type, {
      operation: saved.operation, requestId: saved.requestId,
    });
    await saveCheckpoint(structuredClone(saved));
  }
  return api.uploadInput(saved.permit, image);
}
```
<!-- runnable:site-image-input:end -->

每张图片先保存上传 requestId，再调用本例，成功后记录 input_id / expires_at；按用户槽位顺序传给下方报价函数。输入只存活到 receipt 的 expires_at，不是永久素材或 30 天生成结果。永久素材存储是另一个独立授权合同，不在本次图片交付范围内。实际字节、MIME、尺寸、归属、配额、operation 和 Site 状态由服务端核验；checkpoint 和客户端信息不能代替权限证明。上传失败或取消不能作为已取得输入，更不能继续付费提交。

下面的函数可放进业务模块，传入真实 SDK。它读取当次目录、核对配置，再请求报价；它不会提交生成、选择替代模型或询问用户。

<!-- runnable:image-model-quote:start -->
```js
async function quoteConfiguredImage(api, choice, input, surface) {
  if (!choice) throw new Error('image_model_selection_required');
  const selection = structuredClone(choice);
  const intent = { requestId: input.requestId, prompt: input.prompt,
    inputIds: [...(input.inputIds ?? [])], signal: input.signal };
  if (!['media.image.generate', 'media.image.edit'].includes(selection.operation) ||
      !['subapp', 'site-preview', 'site-published'].includes(surface)) {
    throw new Error('image_model_choice_invalid');
  }
  let cursor;
  let catalogVersion;
  const seen = new Set();
  for (let page = 0; page < 32; page++) {
    const catalog = await api.listImageModels({
      operation: selection.operation, query: selection.model, limit: 50,
      ...(cursor ? { cursor } : {}),
    }, { signal: intent.signal });
    if (catalogVersion && catalogVersion !== catalog.catalogVersion) {
      throw new Error('image_model_catalog_changed');
    }
    catalogVersion = catalog.catalogVersion;
    const model = catalog.models.find(item => item.id === selection.model);
    if (model) {
      if (!model.operations.includes(selection.operation) ||
          model.availability[surface].status !== 'ready') {
        throw new Error('image_model_unavailable');
      }
      if (model.parameterSchemaVersion !== selection.parameterSchemaVersion) {
        throw new Error('image_model_parameters_changed');
      }
      for (const [name, value] of Object.entries(selection.parameters ?? {})) {
        const choices = model.parameters?.[name]?.integerValues;
        if (choices !== undefined && (!Array.isArray(choices) ||
            !Number.isSafeInteger(value) || !choices.includes(value))) {
          throw new Error('image_model_parameters_invalid');
        }
      }
      const sourceRule = model.parameters?.source_input;
      if (selection.operation === 'media.image.edit' && sourceRule !== undefined) {
        if (sourceRule.type !== 'integer' || sourceRule.minimum !== 1 ||
            sourceRule.maximum !== model.maximumInputs ||
            !Number.isSafeInteger(model.maximumInputs) || model.maximumInputs < 1 ||
            model.maximumInputs > 16) {
          throw new Error('image_model_parameters_changed');
        }
        if (intent.inputIds.length < 1 || intent.inputIds.length > model.maximumInputs ||
            !intent.inputIds.every(id => typeof id === 'string' && /^min_[a-f0-9]{32}$/.test(id)) ||
            new Set(intent.inputIds).size !== intent.inputIds.length) {
          throw new Error('image_model_inputs_invalid');
        }
        const hasSource = Object.prototype.hasOwnProperty.call(selection.parameters ?? {}, 'source_input');
        if (!hasSource && intent.inputIds.length > 1) {
          throw new Error('image_model_source_selection_required');
        }
        const source = hasSource ? selection.parameters.source_input : sourceRule.default;
        if (!Number.isSafeInteger(source) || source < 1 || source > intent.inputIds.length) {
          throw new Error('image_model_inputs_invalid');
        }
      }
      let generationReferences = false;
      if (selection.operation === 'media.image.generate') {
        const contract = model.inputContract;
        const policy = contract?.generationReferences;
        generationReferences = contract?.schema === 'taku.image-input-contract.v3' &&
          contract.sameDimensions === false && Array.isArray(contract.roles) &&
          contract.roles.length === 1 && contract.roles[0] === 'reference' &&
          policy?.minimumReferences === 0 && Number.isSafeInteger(policy.maximumReferences) &&
          policy.maximumReferences >= 1 && policy.maximumReferences <= 16 &&
          policy.maximumReferences === model.maximumInputs;
        const maximum = generationReferences ? policy.maximumReferences : 0;
        if ((model.maximumInputs !== 0 && !generationReferences) ||
            intent.inputIds.length > maximum ||
            !intent.inputIds.every(id => typeof id === 'string' && /^min_[a-f0-9]{32}$/.test(id)) ||
            new Set(intent.inputIds).size !== intent.inputIds.length) {
          throw new Error('image_model_inputs_invalid');
        }
      }
      return api.quoteImageRequest(selection.operation, {
        schema_version: 'taku.managed-media-request.v2',
        model: selection.model,
        parameter_schema_version: selection.parameterSchemaVersion,
        prompt: intent.prompt,
        parameters: selection.parameters,
        ...(selection.operation === 'media.image.edit' || generationReferences
          ? { input_ids: intent.inputIds ?? [] } : {}),
      }, { requestId: intent.requestId, signal: intent.signal });
    }
    if (!catalog.nextCursor) throw new Error('image_model_unavailable');
    if (seen.has(catalog.nextCursor)) throw new Error('image_model_catalog_unavailable');
    seen.add(catalog.nextCursor);
    cursor = catalog.nextCursor;
  }
  throw new Error('image_model_catalog_unavailable');
}
```
<!-- runnable:image-model-quote:end -->

### 原图与多张参考图

当编辑目录明确公开一基序号参数 `source_input` 时，应用需要一个“原图”槽位和独立的参考图槽位。用户选定原图后，在保存的 owned `input_ids` 中找到对应位置，把位置加一保存为 `parameters.source_input`。原图在第五位就是 5；其余图片保持原顺序，不能为了让原图排第一而改动已保存的输入、报价或恢复记录。

当前 Luma Uni-1 / Max 编辑档案各支持原图加最多八张参考图，总计不超过九张。上限 9 不表示只有两张图时也能选择 9。单图可按当次目录默认选择；多图缺少明确原图槽位或用户说明时，问一次哪张是原图，暂不报价。已有原图选择或项目配置时直接沿用，不重复问、不自动猜第一张。下面报价示例会在多图缺少显式选择、非整数、实际越界或输入无效时返回错误，供 UI 保留原意图并请求更正。

生成档案仍用 v3 可选参考图合同，不设置 `source_input`；显式蒙版继续用自身 source / mask 合同。根据 live 目录和精确 operation 构建 UI，不把此规则强加给没有该参数的型号。源图片、输入顺序或选择改变是新意图，需要新报价与新 requestId；网络结果未知、重新登录或上传链接续签保持原意图与原 ID，先读取已有 execution/quote，不再提交收费任务。

这些检查只是应用输入反馈。SDK / Host / Worker / Proxy 继续核验当前身份、实际素材、参数与授权；目录和客户端槽位不能作为 ownership、billing 或 ready 的证明。原图选择 UI 的构建及真实 Agent 问答仍须实际验收。

### BRIA 参考图

目录中的 `bria-guided-image-base`、`bria-guided-image-fast`、`bria-guided-image-hd` 是参考图编辑档案，operation 为 `media.image.edit`。它们与 BRIA 纯文生图、GenFill 蒙版编辑分别选型；按用户选择保存精确 ID，报价前继续核对对应 surface 是否 ready。下面只支持这三个档案的 `-edit-v2-2026-10-07` 参数合同；目录版本改变时说明需要更新参考，不猜新参数。

经当前授权取得 1—4 个不同的 owned input ID，保留用户输入顺序。每张 JPEG / PNG / WebP 不超过 12,000,000 bytes，多张图宽高比相同，宽高可以不同；服务端核验实际素材，不由应用提交尺寸或格式证明。这个档案不用 source / mask 槽位。用户选择的 1—4 个控制项中，`input: 1` 指第一个 input ID，同一个来源可用于多个控制项，每个上传来源至少使用一次。方法可选边缘 `controlnet_canny`、深度 `controlnet_depth`、重新着色 `controlnet_recoloring`、色块 `controlnet_color_grid`；scale 可选 0—1，0 保留为 0，未选的方法或 scale 不补默认。

下列函数只构造应用本地意图：把控制项转为目录允许的标量参数，并复制输入顺序。它不读取图片、不选择型号、不报价或提交任务，也不能证明 input ID 的归属；SDK / 服务端仍执行鉴权、素材与参数校验。

<!-- runnable:bria-reference-intent:start -->
```js
function createBriaReferenceIntent(model, inputIds, controls) {
  const models = ['bria-guided-image-base', 'bria-guided-image-fast', 'bria-guided-image-hd'];
  if (!model || !models.includes(model.id) ||
      !model.operations.includes('media.image.edit') ||
      model.parameterSchemaVersion !== `${model.id}-edit-v2-2026-10-07`) {
    throw new Error('bria_reference_model_unsupported');
  }
  if (!Array.isArray(inputIds) || inputIds.length < 1 || inputIds.length > 4 ||
      inputIds.some(id => typeof id !== 'string' || !/^min_[a-f0-9]{32}$/.test(id)) ||
      new Set(inputIds).size !== inputIds.length ||
      !Array.isArray(controls) || controls.length < 1 || controls.length > 4) {
    throw new Error('bria_reference_intent_invalid');
  }
  const methods = ['controlnet_canny', 'controlnet_depth', 'controlnet_recoloring', 'controlnet_color_grid'];
  const parameters = { num_images: 1 };
  const used = new Set();
  controls.forEach((control, index) => {
    if (!control || typeof control !== 'object' || Array.isArray(control) ||
        Object.keys(control).some(key => !['input', 'method', 'scale'].includes(key)) ||
        !Number.isInteger(control.input) || control.input < 1 || control.input > inputIds.length ||
        (control.method !== undefined && !methods.includes(control.method)) ||
        (control.scale !== undefined && (!Number.isFinite(control.scale) || control.scale < 0 || control.scale > 1))) {
      throw new Error('bria_reference_intent_invalid');
    }
    const slot = index + 1;
    parameters[`guidance_input_${slot}`] = control.input;
    if (control.method !== undefined) parameters[`guidance_method_${slot}`] = control.method;
    if (control.scale !== undefined) parameters[`guidance_scale_${slot}`] = control.scale;
    used.add(control.input);
  });
  if (used.size !== inputIds.length) throw new Error('bria_reference_intent_invalid');
  return { choice: { operation: 'media.image.edit', model: model.id,
    parameterSchemaVersion: model.parameterSchemaVersion, parameters }, inputIds: [...inputIds] };
}
```
<!-- runnable:bria-reference-intent:end -->

使用当次目录的已选型号、owned input ID 和用户控制项调用 `createBriaReferenceIntent`，与本次 prompt / 原 requestId 一起保存。保存后传给 `quoteConfiguredImage(api, intent.choice, intent, surface)`。控制项数组只在应用配置内使用，请求提交 `guidance_input_N` / `guidance_method_N` / `guidance_scale_N` 与 `input_ids`；原生 `guidance` 数组和 provider URL 由服务端构造。重开或未知结果恢复使用保存的原意图，不重新调用构造函数生成新 requestId；用户主动改变配置才建立新意图。单次输出固定一张，费用取真实报价，不在应用硬编码单价。

### GPT Image 2.5 多参考图与可选蒙版

`gpt-image-2.5-flare-reference-mask` 和 `gpt-image-2.5-sunburst-reference-mask` 是两个独立的编辑档案。下面示例只接受各自的 `-edit-v2-2026-10-08` 参数版本和目录中的 `taku.image-input-contract.v2` / `referenceMask` 规则；当前 surface 是否可调用仍由 live availability 和服务端判断。

用户提供 1—16 张 source，按选定顺序取得不同的 owned input ID；source 尺寸可以不同。需要局部编辑时另收一张不同的 owned mask，并明确绑定第一张 source：mask 的实际宽高必须与第一张 source 一致。没有选择 mask 时全部输入都是 source，不添加 `mask_input`；不能凭第二张图、输入数量、文件名或颜色猜测蒙版。SDK / 服务端核验实际图片、归属及参数，构造函数不提供这些证明。

下例把可选 mask 放在来源数组之后，`mask_input` 为从 1 开始的显式位置，总输入最多 17 张。函数只复制本地意图；与 prompt / 原 requestId 保存后传给 `quoteConfiguredImage`，沿原 execution / quote ID 查回，不自动提交或硬编码费用。

<!-- runnable:gpt-reference-mask-intent:start -->
```js
function createGptReferenceMaskIntent(model, sourceIds, maskId) {
  const models = ['gpt-image-2.5-flare-reference-mask', 'gpt-image-2.5-sunburst-reference-mask'];
  const contract = model?.inputContract;
  const policy = contract?.referenceMask;
  const selector = model?.parameters?.mask_input;
  if (!model || !models.includes(model.id) ||
      !Array.isArray(model.operations) || !model.operations.includes('media.image.edit') ||
      model.parameterSchemaVersion !== `${model.id}-edit-v2-2026-10-08` ||
      model.maximumInputs !== 17 || model.maximumOutputs !== 1 ||
      contract?.schema !== 'taku.image-input-contract.v2' || contract.sameDimensions !== false ||
      !Array.isArray(contract.roles) || contract.roles.length !== 2 ||
      contract.roles[0] !== 'source' || contract.roles[1] !== 'mask' ||
      policy?.minimumSources !== 1 || policy.maximumSources !== 16 ||
      policy.maskParameter !== 'mask_input' || policy.maskMatchesFirstSource !== true ||
      selector?.type !== 'integer' || selector.minimum !== 2 || selector.maximum !== 17 ||
      Object.hasOwn(selector, 'default')) {
    throw new Error('gpt_reference_mask_model_unsupported');
  }
  const validId = id => typeof id === 'string' && /^min_[a-f0-9]{32}$/.test(id);
  if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 16 ||
      ![...sourceIds].every(validId) || new Set(sourceIds).size !== sourceIds.length ||
      (maskId !== undefined && (!validId(maskId) || sourceIds.includes(maskId)))) {
    throw new Error('gpt_reference_mask_intent_invalid');
  }
  const inputIds = [...sourceIds];
  const parameters = { num_images: 1 };
  if (maskId !== undefined) {
    inputIds.push(maskId);
    parameters.mask_input = inputIds.length;
  }
  return { choice: { operation: 'media.image.edit', model: model.id,
    parameterSchemaVersion: model.parameterSchemaVersion, parameters }, inputIds };
}
```
<!-- runnable:gpt-reference-mask-intent:end -->

在第一次网络请求之前保存本次 requestId 与完整选择/输入。报价成功后保存原 execution_id 和 quote.quoteId，展示真实型号、参数及有效期。按 quote.schema 区分费用：`taku.image-model-quote.v1` 的 `credits` 是固定报价；`taku.image-model-quote.v2` 的 `maximumCredits` 是用户确认的最大预算，不是最终扣费，不得展示为最终价格或已扣费。仅在 model_receipt.billingStatus === 'settled' 后展示 `model_receipt.chargedCredits` 为实扣；pending/review 仍未结算，不能将预算或预扣标成实扣。用户确认固定报价或最大预算后仅调用一次 `submitImageRequest(operation, executionId, quoteId)`；禁用重复点击。SubApp 扣当前操作者，正式 Site 扣登录访客，Site 本地预览扣开发者，构建问答不能替代运行时身份/授权。

未知提交或页面重开先 `findImageExecution(operation, originalRequestId)`；已有 execution 则 `getImageExecution`。按返回的 next_action：quote 使用保存的原 requestId/输入取回报价，submit 等有效报价与当前付费确认，poll 只查询原 execution，none 读取原终态。不要因为超时、报价失败、结果未就绪或链接过期换 ID 重新生成。用户主动改变型号/参数/输入才建立新的业务意图，并保留旧任务供恢复。

成功后用 `getImageOutputs(operation, executionId)` 读取全部输出，按 output_index 调用 `getImageOutputLink`，直接用于 img/download，不下载成 Worker 内存 Blob；按原 ID 和序号更新过期链接。临时结果保留原 30 天，链接最多 5 分钟，不存临时 URL。永久保存是独立授权且占用账号空间的素材操作，不延长临时 expiry，不再次生成收费。取消使用 `cancelImageExecution` 并查询原任务终态，取消回执不等于已经取消。

SDK 与目录测试、fixture 和生产 build 只证明本地接线。真实 Agent 制作、安装用户、当前身份/付款人、型号/报价/账本和归档须独立验收，未验收端点不能写 ready。
