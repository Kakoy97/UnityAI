# Unity AI 架构自检报告（基于代码事实）

审计范围：
- L2（Sidecar / MCP Command / Queue / OCC / Error Policy）
- L3（Unity Command/Action 执行端、Registry、DTO、主线程调度）
- 读写安全护栏（read_token、anchor、错误码、tools/schema 预算）

---

## 1. Executive Summary

- 整体扩展性评价：**中（3/5）**。MCP Command 与 Unity Action 都已引入 registry，但仍有中心化主干文件与 legacy 兼容耦合。
- 最大风险 Top 1：**Command 多真相源**（`commands/index.js` + `contracts.js` 冻结清单 + 快照测试）导致新增命令时容易漏改。
- 最大风险 Top 2：**Action legacy 桥接仍在主路径**（legacy anchor / legacy top-level action 字段仍被读取），影响长期可维护性。
- 最大风险 Top 3：**错误码泛化兜底仍存在**（多层 fallback 到通用码），排障粒度下降。
- 推荐优先改造 Top 1：收敛 L2 命令“单一真相源”，把冻结清单改为生成物或 CI 自动校验。
- 推荐优先改造 Top 2：分阶段移除 legacy payload/anchor 桥接，统一 `action_data` + 标准 anchor。
- 推荐优先改造 Top 3：收敛错误码兜底边界，要求 L3 回执强制带细分 error_code。

---

## 2. Current Architecture Map（L1/L2/L3 边界与调用链）

### 2.1 主调用链（写）

```text
L1 MCP Client
  -> JSON-RPC tools/list|tools/call
     (sidecar/src/mcp/mcpServer.js:210,238,247)
  -> McpCommandRegistry.dispatchMcpTool
     (sidecar/src/mcp/commandRegistry.js:549)
  -> HTTP /mcp/* route
  -> router dispatchHttpCommand
     (sidecar/src/api/router.js:89)
  -> TurnService
     (sidecar/src/application/turnService.js:477,497)
  -> McpGateway.submitUnityTask + jobQueue/jobStore/lock
     (sidecar/src/application/mcpGateway/mcpGateway.js:207)
  -> UnityDispatcher.buildUnityActionRequest
     (sidecar/src/application/unityDispatcher/runtimeUtils.js:184)
  -> Unity /unity.action.request
  -> ConversationController.ExecutePendingActionAndReportAsync
     (Assets/Editor/Codex/Application/ConversationController.cs:851)
  -> UnityVisualActionExecutor.Execute -> McpActionRegistry.TryGet
     (Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs:36,53)
  -> /unity/action/result callback
     (sidecar/src/api/router.js:109)
```

### 2.2 主调用链（读 Query）

```text
L1 tool call (e.g. get_ui_tree)
  -> commandRegistry.dispatchHttpCommand
  -> TurnService -> McpEyesReadService.executeUnityReadQuery
     (sidecar/src/application/mcpGateway/mcpEyesReadService.js:427)
  -> QueryCoordinator.enqueueAndWaitForUnityQuery
     (sidecar/src/application/queryRuntime/queryCoordinator.js:39)
  -> Unity pull: /unity/query/pull
     (sidecar/src/api/router.js:130)
  -> ConversationController.ExecutePulledReadQueryAsync
     (Assets/Editor/Codex/Application/ConversationController.cs:1926)
  -> UnityQueryRegistry.DispatchAsync
     (Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs:47)
  -> Unity /unity/query/report
     (sidecar/src/api/router.js:137)
  -> Sidecar issueReadTokenForQueryResult
     (sidecar/src/application/mcpGateway/mcpEyesReadService.js:512)
```

### 2.3 关键入口文件

- MCP 入口：`sidecar/src/mcp/mcpServer.js`（JSON-RPC method switch）
- MCP HTTP 入口：`sidecar/src/api/router.js`（先 registry，后系统 route 分支）
- Command 分发中心：`sidecar/src/mcp/commandRegistry.js`
- Command 定义中心：`sidecar/src/mcp/commands/index.js`
- Unity 入口控制器：`Assets/Editor/Codex/Application/ConversationController.cs`
- Action 分发中心：`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- Action 注册中心：`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`

---

## 3. MCP Command 扩展流程评估

### 3.1 新增一个 MCP 指令当前需要改哪些文件

按现有代码，新增命令通常需要改：

1. 命令模块文件（新增）
- `sidecar/src/mcp/commands/<new_command>/validator.js`
- `sidecar/src/mcp/commands/<new_command>/handler.js`

2. 命令中心定义（必须）
- `sidecar/src/mcp/commands/index.js`：
  需要新增 import 与 `MCP_COMMAND_DEFINITIONS` 项（`index.js:3-38,70`）。

3. 协议冻结/可见性清单（通常必须）
- `sidecar/src/ports/contracts.js`：
  `mcp_read_http_routes/mcp_write_http_routes/mcp_tool_names`（`contracts.js:110-174`）
  与可见性 allowlist（`contracts.js:185-194`）。

4. 测试快照（通常必须）
- `sidecar/tests/application/r11-command-contract-snapshot.test.js`（`67-117` 有固定工具列表与 required 字段快照）
- `sidecar/tests/application/r12-tool-registry-consistency.test.js`（`32-63`）

5. 错误模板（如新增错误码）
- `sidecar/src/application/turnPolicies.js`（`MCP_ERROR_FEEDBACK_TEMPLATES`，`turnPolicies.js:49` 起）

已解耦点：
- 一般不再需要改 `mcpServer.js` 的 tool-name 分发（已统一 `dispatchMcpTool`，`mcpServer.js:526`）。
- 一般不再需要改 `router.js` 的 MCP 命令 route（已统一 `dispatchHttpCommand`，`router.js:89`）。

### 3.2 是否存在中心化 switch-case / 枚举 / 白名单耦合

- `tools/call` 不再按工具名 `switch`，这是正向解耦（`mcpServer.js:247-253`, `commandRegistry.js:549`）。
- 但存在**中心化注册+白名单耦合**：
  - 命令定义集中在单文件数组（`commands/index.js:70`）。
  - 工具可见性由 `security_allowlist` 与 `disabled_tools` 控制（`contracts.js:185-194`）。
  - 快照测试固定工具清单，新增命令必须同步（`r11-command-contract-snapshot.test.js:67-117`）。

### 3.3 是否可做到模块自描述注册（schema/validator/handler/errorTemplates）

- **部分可做到**：每个命令已有独立 handler/validator 文件（如 `get_tool_schema` 模块）。
- **未完全做到**：
  - 注册不是模块自发现，仍由 `commands/index.js` 手工汇总。
  - 错误模板仍全局集中在 `turnPolicies.js`，不是命令模块局部自注册。

### 3.4 MCP Command 扩展性评分

- 评分：**3/5**
- 理由（代码证据）：
  - 有 registry 分发（`commandRegistry.js:416,549`）是明显进步。
  - 但新增命令仍要触达中心文件与冻结清单（`commands/index.js:70`、`contracts.js:110-194`），未达到“新增只改模块目录”的高度解耦。

---

## 4. Action 扩展流程评估

### 4.1 新增一个 Action 当前需要改哪些文件

常规新增 Action（不改协议形状）最小改动：

1. 新增或扩展 handler
- `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs`
  或新增 handler 文件，继承 `McpVisualActionHandler<T>`。

2. 注册 capability + handler（必须）
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
  （`BuildDefaultRegistry` 与 `registry.Register(...)`，`32-40`, `44+`, `291+`）。

3. 仅在没有现成 primitive 时改执行 primitive
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`（`RunXxx` 系列）。

4. 测试
- `Assets/Editor/Codex/Tests/EditMode/*`（如 handler/registry/composite 用例）。

### 4.2 L2 是否仍需维护 action_type 枚举/oneOf

- 写入入口 `apply_visual_actions` 不对 action_type 做硬枚举拒绝：
  - schema 描述明确“Unknown action types are allowed”（`commands/index.js:303-304`）。
  - 测试验证 unknown action submit-open（`validators.anchor-hardcut.test.js:191,250`）。
- 但仍有**已知类型耦合规则**：
  - `validators.js` 内保留 `ALLOWED_VISUAL_ACTION_TYPES` 与若干已知动作字段规则（`validators.js:708-713`, `3567+`）。
  - Unity action result 校验对已知 legacy 类型仍有特殊字段要求（`validators.js:1147-1268`）。

### 4.3 L3 是否 registry 化？是否仍有 switch-case

- 主分发已 registry 化：
  - `UnityVisualActionExecutor.Execute` 使用 `_registry.TryGet(actionType, out handler)`（`UnityVisualActionExecutor.cs:52-65`）。
- 未见按 action_type 的中心 switch-case。
- 但执行器仍含大量静态 `RunXxx` primitive，handler 多为 thin wrapper 调这些方法（`BuiltInVisualActionHandlers.cs:89,110,135,164`）。

### 4.4 Action 数据承载扩展性（action_data 透传与字段丢失）

- 支持扩展：
  - L2 要求 `action_data` 为对象（`validators.js:216-224`），并禁止外部直接传 `legacy_stringified_action_data`（`228-234`）。
  - L2->L3 会构建 `legacy_stringified_action_data`（`runtimeUtils.js:427-430`，`turnPayloadBuilders.js:157-168`）。
  - L3 handler 统一反序列化 `legacy_stringified_action_data`（`McpVisualActionContext.cs:45-67`）。
- 仍有 legacy 双轨：
  - `resolveVisualActionData` 会从 top-level 旧字段回退构建 `legacy_stringified_action_data`（`turnPayloadBuilders.js:73-116`）。
  - DTO 仍保留 legacy 字段（`SidecarContracts.cs:282-295`）。

### 4.5 Action 扩展性评分

- 评分：**3/5**
- 理由（代码证据）：
  - Registry + typed handler 方向正确（`UnityVisualActionExecutor.cs:52-65`；`McpActionRegistry.cs:240-313`）。
  - 但 bootstrap 手工注册集中、legacy 兼容桥接未清理，新增 Action 仍可能触达主干文件（`McpActionRegistryBootstrap.cs:32-40,44+`）。

---

## 5. Coupling & Redundancy Findings（重点）

### F1
症状：MCP Command 注册中心单点化，新增命令必须改中心数组。  
证据：`sidecar/src/mcp/commands/index.js:3-38,70`（集中 import + `MCP_COMMAND_DEFINITIONS`）。  
影响：多人并行开发命令时冲突高；命令模块不能独立接入。  
建议：改为“命令模块 manifest + loader”模式，`index.js` 仅聚合目录扫描结果。  
优先级：**P1**

### F2
症状：MCP 命令存在多真相源（定义、冻结清单、快照测试）。  
证据：`contracts.js:110-194`、`r11-command-contract-snapshot.test.js:67-117`、`r12-tool-registry-consistency.test.js:32-63`。  
影响：新增命令容易出现“定义存在但 tools/list 不可见/被策略阻断”。  
建议：保留安全 allowlist，但将冻结清单从 registry 派生并在 CI 比对，减少手工同步。  
优先级：**P0**

### F3
症状：Router 仍有较长手工 if 链（Unity callback/metrics/stream 等）。  
证据：`sidecar/src/api/router.js:102-183`。  
影响：新增系统 endpoint 仍要改核心 router 主干。  
建议：引入 system-route registry，把 callback/stream/metrics 也改为声明式注册。  
优先级：**P2**

### F4
症状：`validators.js` 职责过载且与命令级校验工具重复。  
证据：`sidecar/src/domain/validators.js`（3700+ 行，`validateMcpSubmitUnityTask`/`validateMcpApplyVisualActions`/callback/context/composite 同文件）；`sidecar/src/mcp/commands/_shared/validationUtils.js:3-46`。  
影响：规则漂移风险高，新增校验难定位，review 成本高。  
建议：按域拆分（write/read/callback/composite/capability），共用一个 `validation-core`。  
优先级：**P1**

### F5
症状：Action legacy 桥接仍在主路径（legacy anchor 与 top-level action 字段回退）。  
证据：`runtimeUtils.js:23-30,319-337`（legacy anchor fallback）；`turnPayloadBuilders.js:73-116`（legacy 字段打包 `legacy_stringified_action_data`）；`validators.js:81-91`（字段回退读取）。  
影响：协议语义长期双轨，扩展动作时易出现“到底该写 action_data 还是旧字段”的歧义。  
建议：加 telemetry 后分阶段关停 legacy fallback（warn -> deny -> remove）。  
优先级：**P0**

### F6
症状：L3 Action 注册点集中在单个 bootstrap，新增 action 需改主干文件。  
证据：`McpActionRegistryBootstrap.cs:32-40,44-90,291-309`。  
影响：Action 包扩展并行开发冲突高，注册代码增长快。  
建议：拆分为多文件 registration module（按 domain/value-pack），bootstrap 只聚合模块。  
优先级：**P1**

### F7
症状：L3 执行器仍偏“巨型 primitive 容器”，handler 多数只是转调 `RunXxx`。  
证据：`UnityVisualActionExecutor.cs:108+` 大量 `RunXxx`；`BuiltInVisualActionHandlers.cs:89,110,135,164`；`ValuePackVisualActionHandlers.cs:107+`。  
影响：新增底层能力时仍需改核心执行器，回归面大。  
建议：将 primitive 按 domain 下沉为独立服务，executor 仅负责 registry/错误边界。  
优先级：**P1**

### F8
症状：Query payload 双通道（`query_payload_json` + `payload`/聚合 DTO）并存。  
证据：`queryCoordinator.js:67-79,333-345`；`IUnityQueryHandler.cs:112-133,160-170`；`SidecarContracts.cs:716-754`。  
影响：新增 query 字段需要双通道兼容，容易出现序列化/反序列化偏差。  
建议：统一 `query_payload_json` 为唯一载荷，`UnityPulledQueryPayload` 改为最小兼容层并计划移除。  
优先级：**P1**

### F9
症状：错误码在多个层级仍回退通用码，细粒度错误可能被吞。  
证据：`UnityVisualActionExecutor.cs:69,89,1474`（回退 `E_ACTION_EXECUTION_FAILED`）；`IMcpVisualActionHandler.cs:19`；`HttpSidecarGateway.cs:329-335`（缺码补 `E_ACTION_RESULT_MISSING_ERROR_CODE`）。  
影响：线上排障需要反查日志上下文，自动化恢复策略精度下降。  
建议：要求 handler/result 必带 error_code；fallback 仅保留在最外层并度量命中率。  
优先级：**P1**

### F10
症状：read_token 存在 L3 与 L2 双重签发。  
证据：`UnityRagReadService.cs:117,2014-2033`（Unity 生成 token）；`mcpEyesReadService.js:512-524`（Sidecar 再签发 token）。  
影响：谁是权威 token 容易混淆，未来 OCC 规则收紧时可能出现行为不一致。  
建议：明确单一签发方（建议 L2 `unitySnapshotService`），L3 仅返回 revision/scope 原始信息。  
优先级：**P2**

### F11（文档与实现不一致）
症状：蓝图要求删除 legacy/旧执行路径，但代码仍保留关键兼容分支。  
证据：文档 `docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md:524,553`；代码 `runtimeUtils.js:23-30,319-337`、`turnPayloadBuilders.js:73-116`、`UnityVisualActionExecutor.cs:108+`。  
影响：团队对“是否已完成收口”认知不一致，改造优先级容易被误判。  
建议：更新蓝图状态（Done/In-progress/Deferred）并绑定当前 commit 的真实完成度。  
优先级：**P1**

---

## 6. Extensibility Roadmap（3阶段）

### Phase 1（先收敛 L2 命令与契约）

目标：降低“新增 MCP 命令需要改主干文件”的次数，先解决多真相源。  
涉及文件：
- `sidecar/src/mcp/commands/index.js`
- `sidecar/src/mcp/commandRegistry.js`
- `sidecar/src/ports/contracts.js`
- `sidecar/src/api/router.js`
- `sidecar/tests/application/r11-command-contract-snapshot.test.js`
- `sidecar/tests/application/r12-tool-registry-consistency.test.js`
风险点：安全 allowlist 与自动生成策略冲突（需保留 fail-closed）。  
验收标准：
- 新增一个 read 命令不改 `mcpServer.js` / `turnService.js`。
- CI 自动校验 `registry routes/tools` 与 freeze contract 一致。
- tools/list 可见性规则回归测试通过。

### Phase 2（Action 路径去 legacy + 模块化注册）

目标：让新增 Action 接入稳定在 “handler + registration module + test” 三件套。  
涉及文件：
- `sidecar/src/application/unityDispatcher/runtimeUtils.js`
- `sidecar/src/application/turnPayloadBuilders.js`
- `sidecar/src/domain/validators.js`
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- `Assets/Editor/Codex/Domain/SidecarContracts.cs`
风险点：移除 legacy fallback 可能影响旧调用方。  
验收标准：
- 关闭 legacy fallback 后，协议只接受标准 anchor + `action_data`。
- 新增 action 不需要改 executor 主类（无新增 `RunXxx`）。
- unknown action 仍 submit-open / execute fail-closed（既有测试继续绿）。

### Phase 3（Query 载荷统一 + 错误码保真收口）

目标：统一 query 载荷通道与错误码边界，提升长期可维护性。  
涉及文件：
- `sidecar/src/application/queryRuntime/queryCoordinator.js`
- `sidecar/src/application/queryRuntime/queryStore.js`
- `Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`
- `Assets/Editor/Codex/Domain/SidecarContracts.cs`
- `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`
- `sidecar/src/application/turnPolicies.js`
风险点：Unity 端 `JsonUtility` 对 DTO 变更敏感。  
验收标准：
- `query_payload_json` 成为唯一权威输入，legacy payload 路径可禁用。
- Action/Query 失败默认透传细分码，`E_ACTION_EXECUTION_FAILED` 命中率可监控并显著下降。
- 契约快照与 EditMode 回归全绿。

---

## 7. Appendix

### 7.1 关键文件索引

#### L2（Sidecar / MCP）
- `sidecar/src/mcp/mcpServer.js`
- `sidecar/src/api/router.js`
- `sidecar/src/mcp/commandRegistry.js`
- `sidecar/src/mcp/commands/index.js`
- `sidecar/src/mcp/commands/*/validator.js`
- `sidecar/src/mcp/commands/*/handler.js`
- `sidecar/src/application/turnService.js`
- `sidecar/src/application/mcpGateway/mcpGateway.js`
- `sidecar/src/application/mcpGateway/mcpEyesWriteService.js`
- `sidecar/src/application/mcpGateway/mcpEyesReadService.js`
- `sidecar/src/application/unityDispatcher/runtimeUtils.js`
- `sidecar/src/application/turnPayloadBuilders.js`
- `sidecar/src/application/queryRuntime/queryCoordinator.js`
- `sidecar/src/application/jobRuntime/jobQueue.js`
- `sidecar/src/application/jobRuntime/jobStore.js`
- `sidecar/src/application/jobRuntime/jobLeaseJanitor.js`
- `sidecar/src/application/unitySnapshotService.js`
- `sidecar/src/domain/validators.js`
- `sidecar/src/ports/contracts.js`
- `sidecar/src/application/turnPolicies.js`

#### L3（Unity）
- `Assets/Editor/Codex/Application/ConversationController.cs`
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/IMcpVisualActionHandler.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/BuiltInVisualActionHandlers.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/CompositeVisualActionHandler.cs`
- `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs`
- `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`
- `Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`
- `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
- `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`
- `Assets/Editor/Codex/Domain/SidecarContracts.cs`

### 7.2 错误码/错误模板位置（当前实现）

统一错误模板主表：
- `sidecar/src/application/turnPolicies.js` 的 `MCP_ERROR_FEEDBACK_TEMPLATES`（`49+`）

当前模板键（由代码抽取）：
- `E_SCHEMA_INVALID`
- `E_CONTEXT_DEPTH_VIOLATION`
- `E_READ_REQUIRED`
- `E_STALE_SNAPSHOT`
- `E_PRECONDITION_FAILED`
- `E_SELECTION_UNAVAILABLE`
- `E_UNITY_NOT_CONNECTED`
- `E_SCREENSHOT_VIEW_NOT_FOUND`
- `E_SCREENSHOT_CAPTURE_FAILED`
- `E_CAPTURE_MODE_DISABLED`
- `E_UI_TREE_SOURCE_NOT_FOUND`
- `E_UI_TREE_QUERY_FAILED`
- `E_UI_HIT_TEST_SOURCE_NOT_FOUND`
- `E_UI_HIT_TEST_QUERY_FAILED`
- `E_COMMAND_DISABLED`
- `E_TARGET_NOT_FOUND`
- `E_TARGET_CONFLICT`
- `E_TARGET_ANCHOR_CONFLICT`
- `E_ACTION_SCHEMA_INVALID`
- `E_RESOURCE_NOT_FOUND`
- `E_MCP_EYES_DISABLED`
- `E_JOB_CONFLICT`
- `E_TOO_MANY_ACTIVE_TURNS`
- `E_FILE_PATH_FORBIDDEN`
- `E_FILE_SIZE_EXCEEDED`
- `E_FILE_EXISTS_BLOCKED`
- `E_ACTION_COMPONENT_NOT_FOUND`
- `E_ACTION_HANDLER_NOT_FOUND`
- `E_ACTION_DESERIALIZE_FAILED`
- `E_ACTION_PAYLOAD_INVALID`
- `E_ACTION_RESULT_MISSING_ERROR_CODE`
- `E_ACTION_CAPABILITY_MISMATCH`
- `E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`
- `E_COMPOSITE_PAYLOAD_INVALID`
- `E_COMPOSITE_ALIAS_INVALID`
- `E_COMPOSITE_ALIAS_DUPLICATED`
- `E_COMPOSITE_ALIAS_FORWARD_REF`
- `E_COMPOSITE_ALIAS_NOT_FOUND`
- `E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED`
- `E_COMPOSITE_BUDGET_EXCEEDED`
- `E_COMPOSITE_STEP_FAILED`
- `E_COMPOSITE_ROLLBACK_INCOMPLETE`
- `E_WAITING_FOR_UNITY_REBOOT`
- `E_JOB_HEARTBEAT_TIMEOUT`
- `E_JOB_MAX_RUNTIME_EXCEEDED`
- `E_WAITING_FOR_UNITY_REBOOT_TIMEOUT`
- `E_JOB_NOT_FOUND`
- `E_JOB_RECOVERY_STALE`
- `E_STREAM_SUBSCRIBERS_EXCEEDED`
- `E_NOT_FOUND`

补充归一入口：
- `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`（`withMcpErrorFeedback` / `validationError`）


