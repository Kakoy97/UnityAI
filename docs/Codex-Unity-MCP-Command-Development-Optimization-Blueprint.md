# Codex-Unity MCP 指令开发流程解耦优化蓝图（R11）

## 0. 目标与硬约束

### 0.1 总目标
在不削弱 R10 已落地硬防线（OCC、双锚点、组合动作原子回滚、错误模板）的前提下，将“新增 MCP 指令”升级为可模块化接入的标准流程，达到高解耦、低回归风险、低开发成本。

### 0.2 本轮要解决的问题
1. 新增 MCP 指令需要同时修改 `mcpServer.js`、`router.js`、`turnService.js`、`validators.js`，跨文件触点多，回归风险高。
2. 指令定义、参数校验、错误模板、执行逻辑分散在不同层，职责边界不清晰。
3. 现有结构对 Action 扩展已较优，但对 MCP 指令扩展仍偏手工注册，未形成“单路径模板”。
4. `capture_scene_screenshot` 当前是 `Camera.Render -> RenderTexture` 语义，导致 Overlay UI / Editor 叠加不可见，与“所见即所得”预期有偏差。
5. Cursor 对 UI 任务缺少统一的结构化读能力（Canvas/RectTransform/关键组件树），仅依赖截图会产生定位误差。

### 0.3 不可退让约束
1. 写链路硬防线不得变弱：`based_on_read_token`、`write_anchor`、动作锚点约束继续强制。
2. 指令优化不得破坏既有 API 行为与错误码稳定性（除明确标记迁移窗口）。
3. 不允许引入可绕过新注册中心的隐藏入口。
4. 迁移期间必须保持“对外接口稳定、对内可分步替换”。

---

## 1. 设计原则

1. 新增 MCP 指令优先走“模块自描述 + 注册中心”。
2. 路由层只做转发，校验层只做输入校验，策略层只做错误恢复策略。
3. 指令模块自带：元数据、校验器、处理器、测试夹具。
4. 默认不追求运行时动态加载代码，先实现“编译期插件化 + 运行时能力同步”。

---

## 2. 目标架构（R11）

### 2.1 指令注册中心（Command Registry）
新增 Sidecar 指令注册中心，统一管理 MCP 指令定义：
1. 指令名称、分类（read/write/system）。
2. HTTP 路径、MCP Tool 映射关系。
3. 输入 schema 与 validator 入口。
4. 执行 handler 入口。
5. 错误策略模板 key（用于 suggestion/recoverable）。
6. 生命周期（experimental/stable/deprecated）。

### 2.2 指令模块化目录
建议结构：

```text
sidecar/src/mcp/commands/
  _shared/
    commandTypes.js
    defineMcpCommand.js
  capture_scene_screenshot/
    index.js
    validator.js
    handler.js
    schema.js
  get_action_catalog/
    index.js
    validator.js
    handler.js
  get_action_schema/
    index.js
    validator.js
    handler.js
```

### 2.3 统一元数据接口（草案）

```js
defineMcpCommand({
  name: "capture_scene_screenshot",
  kind: "read",
  lifecycle: "experimental",
  http: { method: "POST", path: "/mcp/capture_scene_screenshot" },
  mcp: { expose: true, description: "Capture current Unity Scene/Game view." },
  inputSchema: captureSceneScreenshotSchema,
  validate: validateCaptureSceneScreenshot,
  execute: async (ctx, req) => executeCaptureSceneScreenshot(ctx, req),
  errorPolicy: "mcp_read_default",
  errorTemplates: {
    E_SCREENSHOT_VIEW_NOT_FOUND: {
      suggestion: "Switch to a valid Scene/Game view, then retry capture_scene_screenshot.",
      recoverable: true,
    },
    E_SCREENSHOT_CAPTURE_FAILED: {
      suggestion: "Check Unity editor state and retry. If repeated, reduce resolution and retry.",
      recoverable: true,
    },
  },
});
```

### 2.4 执行上下文 DI（强制）
Registry 在运行时为每个 command handler 注入 `ctx`，至少包含：
1. `queryCoordinator`：用于 `enqueue + wait report` 挂起等待。
2. `snapshotService`：用于获取 `read_token/scene_revision`。
3. `errorCatalog`：用于局部错误模板注册与查询。
4. `logger`：统一日志上下文。
5. `clock`：统一时间与超时判定。

### 2.5 通用 Query 协调接口（强制）
`turnService` 不再为每个新读指令新增专用方法，统一暴露：

```js
enqueueAndWaitForUnityQuery({
  queryType,
  payload,
  timeoutMs,
  threadId,
  requestId,
})
```

新增读指令必须通过该接口调用 Unity Query 通道，避免修改 `turnService.js` 主体逻辑。

### 2.6 Schema 启动期预编译缓存（强制）
Command Registry 在 Sidecar 启动时完成：
1. 扫描所有 command 模块并提取 `inputSchema`。
2. 预编译 tools/list 所需 schema 结构与描述缓存。
3. 对外提供只读缓存接口：`registry.getToolsListCache()`。

`mcpServer.js` 禁止手写拼装 schema 树，统一读取 registry 缓存。

### 2.7 异步等待防线（强制）
1. `queryCoordinator` 必须支持按 `query_id/request_id/thread_id` 建立等待槽。
2. 每个等待槽必须配置 `timeoutMs`，超时后返回可恢复错误并清理槽位。
3. Unity report 到达时必须做关联匹配与幂等完成，避免重复 resolve。
4. 进程关闭或会话取消时，必须批量中断未完成等待并释放资源。

### 2.8 截图语义分层（强制）
`capture_scene_screenshot` 统一支持显式 `capture_mode`，避免“整视图”歧义：
1. `render_output`（默认）：相机渲染输出（稳定、跨平台一致，适合 3D/相机可见内容）。
2. `final_pixels`（增强）：尽量接近最终 GameView 像素，目标包含 Overlay UI。
3. `editor_view`（可选实验）：Editor SceneView 视觉调试模式，可配置是否包含 gizmos/选中框。

关键约束：
1. 响应必须回传 `capture_mode_effective`，明确实际使用模式。
2. 当请求模式不可用时，必须显式降级并回传 `fallback_reason`。
3. `include_ui` 必须具备可验证语义：在 `render_output` 下仅影响 Camera/WorldSpace UI；在 `final_pixels` 下可覆盖 Overlay UI。

### 2.9 UI 结构化读能力（强制）
新增读指令 `get_ui_tree`（可拆为 UGUI/UITK 两个工具）：
1. UGUI：Canvas 列表、层级 path、active、RectTransform（anchor/pivot/size/pos）、排序信息、关键组件摘要（Image/Text/TMP/Button/LayoutGroup 等）。
2. UITK：UIDocument 列表、VisualTree 节点（name/class/style 摘要、resolved layout、交互可拾取性）。
3. 返回结果需支持路径定位与稳定 ID，便于写指令 anchor 绑定。

设计原则：
1. “结构化树”用于定位和推理。
2. “截图”用于视觉验收。
3. Cursor 默认先读树再截图验证，降低幻觉和误定位。

---

## 3. 分层职责重排

### 3.1 L2（Sidecar）职责边界
1. `router.js`：仅根据注册中心绑定路径并分发，不写业务校验。
2. `mcpServer.js`：仅根据注册中心生成 tools/list 和 tools/call 映射，tools schema 由 registry 预编译缓存提供。
3. `validators.js`：仅保留跨指令通用基础校验；指令私有校验下沉到指令模块。
4. `turnService.js`：仅提供基础服务编排能力与通用 `enqueueAndWaitForUnityQuery`，不为单指令新增专用方法。
5. `turnPolicies.js` / `mcpErrorFeedback.js`：统一错误策略，指令通过 `errorPolicy + errorTemplates` 注入并复用模板。
6. `commandRegistry.js`：负责命令元数据聚合、错误模板注册、tools schema 缓存，不承载业务执行逻辑。

### 3.2 L3（Unity）职责边界
1. 新增读类指令优先复用 `unity/query/pull -> unity/query/report` 通道。
2. 写动作继续走 Action Registry，不与 MCP 指令开发流混合。
3. 对截图类指令，只新增 Query Handler，不进入 `UnityVisualActionExecutor` 写链路。
4. 截图实现必须区分“渲染输出”和“最终像素”两种能力，不允许用单一语义混淆对外描述。
5. UI 结构化树查询与截图查询分离，避免一个 handler 同时承载数据抽取与像素渲染职责。

### 3.3 错误模板并入机制（统一反馈）
1. command 模块通过 `errorTemplates` 声明局部错误模板。
2. registry 启动时将模板注册到只读 `errorCatalogProvider`（按 command name + error code 索引）。
3. `turnPolicies.js` / `mcpErrorFeedback.js` 统一从 `errorCatalogProvider` 读取模板，不直接依赖 command 源文件。
4. 禁止在运行时直接改写全局策略对象，避免跨请求污染。

---

## 4. 新增 MCP 指令标准流程（单一路径）

### 4.1 开发步骤（目标）
1. 在 `sidecar/src/mcp/commands/<command>/` 新建模块。
2. 填写 `schema.js` 与 `validator.js`。
3. 编写 `handler.js`，签名固定为 `execute(ctx, req)`，通过 `ctx.queryCoordinator` 或通用 query 接口访问 Unity。
4. 在 `commands/index.js` 注册导出。
5. 指令自动出现在 tools/list 与 HTTP 路由中（通过注册中心构建与缓存）。
6. 补充测试：validator、handler、router、MCP tool contract。

### 4.2 触点目标（治理指标）
新增普通读指令应满足：
1. 在完成 `R11-L2-04/L2-05` 后，必改文件 <= 5。
2. 不改 `mcpServer.js` 业务逻辑。
3. 不改 `router.js` 路由 if/else 主体。
4. 不改 `validators.js` 全局主流程（只允许通用规则增量）。

### 4.3 视觉任务标准执行顺序（新增）
针对 UI/视觉任务，Cursor 的默认流程应固定为：
1. 先调用 `get_ui_tree`（或等价结构化工具）定位目标节点与参数。
2. 再执行写操作（`apply_visual_actions` 等）。
3. 最后调用 `capture_scene_screenshot` 做外观验收。

约束：
1. 禁止仅凭单张截图直接推断 Overlay UI 结构。
2. 当截图模式不满足任务（例如 `render_output` 看不到 Overlay UI），必须自动切换到 `final_pixels` 或回退结构化验证。

---

## 5. 与 Action 开发链路关系

1. 新增 `Action`：继续走 L3 Action Registry + capability sync，不变。
2. 新增 `MCP 指令`：走 L2 Command Registry 新路径。
3. 读指令（如截图）不进入写链路，不触发 OCC 写执行流程。
4. 两条链路共享错误策略与观测，但实现解耦。
5. UI 场景下，“结构化树”与“截图像素”是并行读能力，不互相替代。

---

## 6. 迁移策略（Strangler for Commands）

### 6.1 迁移顺序
1. 先建立注册中心与模块规范。
2. 再迁移低风险读指令（`get_action_catalog`、`get_action_schema`）。
3. 再新增 `capture_scene_screenshot` 作为首个新读指令试点。
4. 补齐截图语义分层（`render_output/final_pixels`）与降级回执。
5. 新增 `get_ui_tree` 结构化读能力，形成“先树后图”的视觉链路。
6. 最后收口旧的硬编码 tool/router 分支。

### 6.2 兼容策略
1. 迁移期可保留旧入口分支，但只做代理到注册中心。
2. 收口期删除代理壳与重复分支，保留单一执行路径。

---

## 7. 执行顺序与任务矩阵（R11）

### 7.1 执行顺序（按依赖）
1. `Phase 0 / 架构门禁`：R11-ARCH-01 ~ R11-ARCH-03  
2. `Phase 1 / 指令注册中心`：R11-L2-01 ~ R11-L2-05  
3. `Phase 2 / 试点迁移与新增指令`：R11-L2-06、R11-L2-07、R11-L3-01  
4. `Phase 2.5 / 视觉观测增强`：R11-L2-08、R11-L2-09、R11-L3-02、R11-L3-03  
5. `Phase 3 / QA 与收口`：R11-QA-01、R11-QA-02、R11-QA-03、R11-E2E-01、R11-ARCH-04

### 7.2 任务矩阵

| 执行阶段 | 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| Phase 0 | R11-ARCH-01 | L2 职责边界固化 | `sidecar/src/mcp/mcpServer.js`、`sidecar/src/api/router.js`、`sidecar/src/application/turnService.js`、`sidecar/src/domain/validators.js` | 职责注释与边界约束标记 | 无跨职责新增逻辑 |
| Phase 0 | R11-ARCH-02 | 契约快照门禁 | `sidecar/tests/application/*snapshot*` | MCP 指令元数据与错误结构快照 | 契约漂移需显式更新 |
| Phase 0 | R11-ARCH-03 | 架构门禁脚本 | `sidecar/scripts/r11-command-boundary-guard.js`、`sidecar/package.json` | 防止新指令回退到硬编码注册 | CI 可阻断违规 |
| Phase 1 | R11-L2-01 | Command Registry | `sidecar/src/mcp/commandRegistry.js`、`sidecar/src/mcp/commands/index.js` | 指令统一注册中心 | 新指令可通过注册接入 |
| Phase 1 | R11-L2-02 | 路由与 MCP Tool 自动映射 | `sidecar/src/api/router.js`、`sidecar/src/mcp/mcpServer.js` | 从 registry 自动生成 path/tool 映射 | 无新增手写 if/else 分支 |
| Phase 1 | R11-L2-03 | 校验解耦 | `sidecar/src/domain/validators.js`、`sidecar/src/mcp/commands/*/validator.js` | 通用校验与指令私有校验拆分 | 共享校验文件不再持续膨胀 |
| Phase 1 | R11-L2-04 | QueryCoordinator 与通用等待接口 | `sidecar/src/application/turnService.js`、`sidecar/src/application/queryCoordinator.js` | `enqueueAndWaitForUnityQuery` 通用接口 + 超时清理 | 新读指令不再新增 turnService 专用方法 |
| Phase 1 | R11-L2-05 | Tools Schema 启动期缓存 | `sidecar/src/mcp/commandRegistry.js`、`sidecar/src/mcp/mcpServer.js` | 启动时预编译 tools/schema 缓存 | mcpServer 不再手写拼装 schema 树 |
| Phase 2 | R11-L2-06 | 读指令迁移试点 | `sidecar/src/mcp/commands/get_action_catalog/*`、`.../get_action_schema/*` | 现有读指令迁移为模块 | 现有行为/错误码不变 |
| Phase 2 | R11-L2-07 | 新增截图指令 | `sidecar/src/mcp/commands/capture_scene_screenshot/*` | 截图读指令可用 | 可返回 artifact_uri 或 inline 图像，且不改 turnService 主体 |
| Phase 2 | R11-L3-01 | Unity 查询执行支持 | `Assets/Editor/Codex/.../Query*` 相关文件 | `capture_scene_screenshot` query handler | 不影响写动作执行链路 |
| Phase 2.5 | R11-L2-08 | 截图语义契约升级 | `sidecar/src/mcp/commands/capture_scene_screenshot/*`、`sidecar/src/application/turnPolicies.js`、`sidecar/tests/application/*` | `capture_mode` + 降级回执（effective/fallback_reason） | Cursor 可区分 `render_output` 与 `final_pixels` |
| Phase 2.5 | R11-L2-09 | UI 结构化读指令接入 | `sidecar/src/mcp/commands/get_ui_tree/*`、`sidecar/src/mcp/commands/index.js`、`sidecar/src/ports/contracts.js` | `get_ui_tree` 命令模块与 MCP 暴露 | 返回稳定路径与组件摘要，可用于 anchor 定位 |
| Phase 2.5 | R11-L3-02 | Unity UGUI 树查询支持 | `Assets/Editor/Codex/Application/ConversationController.cs`、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | `get_ui_tree` query handler | Canvas/节点/RectTransform 关键字段可读 |
| Phase 2.5 | R11-L3-03 | Unity 最终像素截图支持 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | `final_pixels` 模式与回退策略 | Overlay UI 可观测，失败时回退语义清晰 |
| Phase 3 | R11-QA-01 | Sidecar 回归 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | 指令注册/路由/错误/预算回归 | 常态全绿 |
| Phase 3 | R11-QA-02 | Unity 回归 | `Assets/Editor/Codex/Tests/EditMode/*` | 截图查询与稳定性回归 | 编译 + EditMode 全绿 |
| Phase 3 | R11-QA-03 | 视觉链路回归 | `sidecar/tests/application/*`、`Assets/Editor/Codex/Tests/EditMode/*` | “先树后图”流程回归（UI树 + 截图） | Overlay UI 相关任务失败率显著下降 |
| Phase 3 | R11-E2E-01 | 终局验收 | `Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md`（新增） | 固化端到端验收 | 满足发布门槛 |
| Phase 3 | R11-ARCH-04 | 废弃结构收口 | `sidecar/src/mcp/mcpServer.js`、`sidecar/src/api/router.js`、`sidecar/src/domain/validators.js`、`docs/*.md` | 删除旧硬编码注册与重复分支 | 新增指令仅一条主路径 |

---

## 8. 验收标准

1. 新增 MCP 指令不再需要同时改 `mcpServer + router + turnService + validators` 主体逻辑。
2. 指令注册、校验、执行可在模块目录内闭环完成。
3. `execute(ctx, req)` 依赖注入上下文可用，包含 `queryCoordinator/snapshotService/errorCatalog/logger/clock`。
4. 读指令新增不影响写链路硬防线回归。
5. tools/list 与 route 映射由 registry 自动生成，且 schema 由启动期缓存提供。
6. 指令局部错误模板可并入全局错误策略并被 `mcpErrorFeedback` 感知。
7. `capture_scene_screenshot` 支持明确语义（`capture_mode_effective` + `fallback_reason`）。
8. `get_ui_tree` 可提供稳定 UI 节点路径、RectTransform 与关键组件摘要。
9. UI 视觉任务可按“先结构化树、再截图验收”闭环执行。
10. 旧手工分支在收口阶段删除或硬拒绝，不保留双实现长期并存。

---

## 9. 风险与回滚

### 9.1 主要风险
1. 注册中心引入初期，可能出现指令未注册导致“工具可见但不可调”。
2. 自动映射错误可能导致路由冲突。
3. 指令私有 validator 迁移不完整会出现双重校验分歧。
4. Query 挂起等待链路若无超时与清理，可能出现 Promise 泄漏或请求悬挂。
5. 局部错误模板未纳入全局错误目录时，LLM 反馈会退化为通用未知错误。

### 9.2 回滚策略
1. 保留短期 feature flag：`USE_MCP_COMMAND_REGISTRY`。
2. 每迁移一个指令即补快照与回归，不做大批量一次迁移。
3. 若出现线上异常，先回切到旧映射层（代理模式），不回退业务能力。

---

## 10. 废弃代码收口计划（R11-ARCH-04）

完成注册中心迁移后，计划删除或清理：
1. `mcpServer.js` 中硬编码工具数组与重复 schema 片段。
2. `router.js` 中逐条手写 MCP 指令路由分支（改为 registry dispatch）。
3. `validators.js` 内仅服务单一指令的内联校验大块。
4. 与旧指令接入方式冲突的文档与脚本说明。
5. 含糊的“整视图截图”描述，统一替换为 `render_output/final_pixels/editor_view` 语义说明。

---

## 11. 预期结果

1. 新增 MCP 指令开发体验接近当前 Action 扩展体验。
2. 新增读指令默认不再修改 `turnService.js` 主体逻辑，指令开发触点减少。
3. 主功能模块（写链路）受影响最小化。
4. UI 任务形成“结构化树定位 + 截图验收”双轨读能力，减少仅凭像素推断造成的误操作。
5. 后续可继续演进到“编译期插件化 + 能力动态刷新”，再评估运行时热加载。
