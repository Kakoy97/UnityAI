# Codex-Unity MCP 当前架构与扩展分析报告

## 1. 当前结构概览

### 1.1 三层职责落地（基于当前代码）

- L1（Cursor / MCP Client）
  - 通过 MCP 工具调用 Sidecar，不直接访问 Unity。
  - 核心入口：`sidecar/src/mcp/mcpServer.js`（stdio JSON-RPC -> HTTP 转发）。

- L2（Node.js Sidecar）
  - 协议网关、校验中枢、队列与状态机、错误标准化、监控出口。
  - 关键模块：
    - 路由层：`sidecar/src/api/router.js`
    - 应用层：`sidecar/src/application/turnService.js`
    - MCP 网关：`sidecar/src/application/mcpGateway/mcpGateway.js`
    - 读服务：`sidecar/src/application/mcpGateway/mcpEyesReadService.js`
    - 写服务：`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`
    - OCC Token：`sidecar/src/application/unitySnapshotService.js`
    - 校验器：`sidecar/src/domain/validators.js`
    - Query Runtime：`sidecar/src/application/queryRuntime/queryStore.js`、`queryCoordinator.js`

- L3（Unity Editor C#）
  - 主线程读/写执行器、Sidecar 回调客户端、全局轮询与重载恢复。
  - 关键模块：
    - 网关：`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`
    - 查询读服务：`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
    - 视觉动作执行器：`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
    - 查询轮询引导：`Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs`
    - 重载恢复引导：`Assets/Editor/Codex/Infrastructure/UnityRuntimeReloadPingBootstrap.cs`
    - 主流程控制：`Assets/Editor/Codex/Application/ConversationController.cs`

### 1.2 当前协议冻结状态

- L2 已启用协议冻结与运行模式冻结：`sidecar/src/ports/contracts.js`
  - 网关模式强制开启。
  - MCP adapter / MCP eyes 强制开启。
  - 旧路由和旧工具名进入 `deprecated_*` 列表并在路由层 410 拒绝。

## 2. 整体操作流程（端到端）

### 2.1 启动与初始化

1. Sidecar 启动后，`bootstrap()` 强制启用 MCP adapter + MCP eyes（`sidecar/src/index.js`）。
2. Unity 侧 `[InitializeOnLoad]` 启动全局轮询：
   - RAG 查询轮询：`UnityRagQueryPollingBootstrap`
   - 域重载恢复 ping：`UnityRuntimeReloadPingBootstrap`

### 2.2 只读链路（MCP Eyes）

1. L1 调用读工具（如 `get_scene_roots`）。
2. `mcpServer.js` 转发至 `/mcp/get_scene_roots`。
3. `router.js` -> `turnService.getSceneRootsForMcp()` -> `mcpEyesReadService.executeUnityReadQuery()`。
4. L2 `queryCoordinator.enqueueAndWait()` 生成 query，等待 Unity 结果（带超时）。
5. Unity 全局轮询 `POST /unity/query/pull` 拉取任务。
6. `ConversationController` 分派到 `UnityRagReadService` 主线程执行。
7. Unity 通过 `POST /unity/query/report` 回报结果。
8. L2 resolve Promise，签发标准 `read_token` 并返回统一骨架：`ok/data/read_token/captured_at`。

### 2.3 写链路（OCC + 双锚点）

1. L1 调用写工具（`submit_unity_task` / `apply_script_actions` / `apply_visual_actions`）。
2. `mcpServer.js` 转发至对应 `/mcp/*` 写入口。
3. L2 先做硬校验：
   - `based_on_read_token` 必填且格式合法
   - `write_anchor.object_id + write_anchor.path` 必填
   - visual actions 联合类型校验（mutation 必须 `target_anchor`，create 必须 `parent_anchor`）
4. L2 OCC 校验（TTL + scene_revision）不通过即 `E_STALE_SNAPSHOT`，不入队。
5. 校验通过后创建 Job，进入 `JobStore + JobQueue + LockManager`。
6. Sidecar 生成 `unity_action_request`，等待 Unity 消费。
7. Unity 通过 `unity.runtime.ping` 获取待执行 action，执行后 `POST /unity/action/result` 回传。
8. L2 更新 Job 状态，必要时继续下一 action 或终态收敛。

## 3. 当前 MCP 具备功能（可用能力）

### 3.1 MCP Tool（当前对外）

1. `submit_unity_task`：通用异步写任务提交。
2. `get_unity_task_status`：查询任务状态。
3. `cancel_unity_task`：取消任务。
4. `apply_script_actions`：结构化脚本/文件写操作。
5. `apply_visual_actions`：结构化 Unity 视觉写操作。
6. `list_assets_in_folder`：列出目录资产。
7. `get_scene_roots`：获取场景根节点。
8. `find_objects_by_component`：按组件检索对象。
9. `query_prefab_info`：查询 Prefab 树结构（`max_depth` 必填）。

### 3.2 非 Tool 但已具备的网关能力

- `/mcp/stream`：SSE 状态流（面向 MCP 客户端消费）。
- `/mcp/metrics`：运行与观测指标。
- `/unity/runtime/ping`：Unity 运行态心跳与恢复。
- `/unity/query/pull` + `/unity/query/report`：Unity 读查询握手通道。

## 4. 核心原理（为什么它能工作）

### 4.1 OCC 防脏读

- `UnitySnapshotService.validateReadTokenForWrite()` 校验：
  - token 基本格式
  - TTL（`issued_at + hard_max_age_ms`）
  - `scene_revision` 与当前快照一致
- 任一失败统一 `E_STALE_SNAPSHOT`，建议固定：`请先调用读工具获取最新 token。`

### 4.2 双锚点防误写

- 顶层 `write_anchor` 必须有 `object_id + path`。
- `actions[]` 采用联合类型硬校验：
  - mutation：`target_anchor`
  - create：`parent_anchor`
- Unity 执行前二次校验 anchor 一致性，冲突返回 `E_TARGET_ANCHOR_CONFLICT`。

### 4.3 LLM 友好错误反馈

- 统一在 L2 做 `withMcpErrorFeedback()`：
  - 规范 `error_code/error_message/suggestion/recoverable`
  - 清洗堆栈、路径、超长文本
  - 对关键错误 suggestion 做固定模板约束

### 4.4 异步安全与自动清理

- Job lease + janitor 机制：
  - heartbeat 超时
  - max runtime 超时
  - reboot wait 超时
- 超时后自动取消、释放锁、推进队列（无人工恢复依赖）。

### 4.5 查询握手解耦

- 读查询采用 L2 存储 + Unity 主动 pull，避免跨线程/主线程阻塞。
- QueryCoordinator 对每个 query 提供 Promise 与超时 reject，保证 L1 不无限等待。

## 5. 关键现状澄清（非常重要）

1. Unity 当前接收 action 的主链路是 `unity.runtime.ping` 回包带 `unity_action_request`，不是 Unity 订阅 `/mcp/stream`。
2. `/mcp/stream` 当前用于 MCP 客户端侧状态流消费，不是 Unity 侧动作下发通道。
3. 读查询已经是独立的 `pull/report` 通道，不依赖窗口焦点（由全局 bootstrap 驱动）。

## 6. 后续扩展 MCP 功能是否容易

### 6.1 结论

- 结论：中等偏容易（工程化基础已具备）。
- 原因：
  - 分层清晰，读/写/回调/校验模块已拆分。
  - 协议与指标有冻结契约，扩展有明确边界。
  - 但扩展必须同时改 L1 schema、L2 validator、L3 DTO/执行器与测试，步骤严格。

### 6.2 扩展成本画像

- 新增“读工具”：低到中（通常 1-2 天，取决于 Unity 查询复杂度）。
- 新增“写动作类型”：中到高（通常 2-5 天，涉及校验、执行器、错误映射、回归测试）。
- 新增“观测/诊断字段”：低（0.5-1 天）。

## 7. 扩展 MCP 功能的标准流程（建议模板）

### 7.1 新增读工具（推荐流程）

1. L3：在 `SidecarContracts.cs` 增加 Request/Response DTO。
2. L3：在 `UnityRagReadService.cs` 实现查询逻辑（主线程安全、预算参数可控）。
3. L3：在 `ConversationController.cs` 的 pulled query 分发中注册新 `query_type`。
4. L2：在 `validators.js` 增加请求校验（禁止隐式默认核心预算）。
5. L2：在 `mcpEyesReadService.js` 增加入口并复用 `executeUnityReadQuery()`。
6. L2：在 `router.js` 新增 `/mcp/<tool>` 路由。
7. L1：在 `mcpServer.js` 注册 tool 定义与 description。
8. QA：补 Sidecar 单测 + Unity EditMode + E2E 验证文档。

### 7.2 新增写动作类型（推荐流程）

1. 先更新契约：`SidecarContracts.cs` + `mcpServer.js` schema + `validators.js` oneOf 规则。
2. 硬约束不退让：必须继续要求 `based_on_read_token` + anchor 规则。
3. L3 执行器：在 `UnityVisualActionExecutor.cs` 增加动作分支与失败码映射。
4. L2 归一化：`mcpErrorFeedback.js` / `turnPolicies.js` 新错误模板与 suggestion。
5. 回调一致性：确保 `unity/action/result` 回执可被 L2 正确匹配。
6. 回归验证：
   - 缺字段/错字段必须拒绝
   - 冲突锚点必须拒绝
   - 合法路径必须成功

### 7.3 上线前检查清单

1. 是否经过 Validator 与 OCC 双闸。
2. 是否破坏 `actions[]` 联合类型约束。
3. 是否新增了可绕过新链路的旁路。
4. 错误 suggestion 是否稳定、可执行、无乱码。
5. `/mcp/metrics` 是否可观察新能力行为。
6. 是否补齐 Sidecar + Unity 双侧测试与验收文档。

## 8. 风险与建议

- 风险 1：若只改 L1/L2 不改 L3 DTO，易出现“请求 accepted 但 Unity 无法执行”的静默挂起。
- 风险 2：若新增动作未进联合类型校验，会引入 schema 漏洞。
- 风险 3：若错误码未进入模板中心，会导致 LLM 重试策略不稳定。

建议：后续扩展都按“契约先行 -> 校验前置 -> 执行器落地 -> 错误模板 -> 回归测试”的固定节奏推进，避免返工。
