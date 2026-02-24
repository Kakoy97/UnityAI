# Codex Unity Gemini 交接上下文包（Current State + Pain Points）

- 文档版本: v1.0
- 更新时间: 2026-02-24
- 目的: 让 Gemini 在最短时间内理解当前系统结构、主流程、已落地能力与关键痛点，避免误判。

## 1. 建议给 Gemini 的阅读顺序

1. `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
2. `Assets/Docs/Codex-Unity-Refactor-Roadmap.md`
3. `Assets/Docs/Codex-Unity-Refactor-Execution-Plan.md`
4. `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
5. `Assets/Docs/Codex-Unity-MVP-Plan.md`
6. `Assets/Docs/Codex-Unity-Cursor-Integration-Guide.md`
7. `Assets/Docs/Codex-Unity-Cursor-Integration-Fixes.md`
8. `sidecar/README.md`

说明:
- 1-4 是重构主线与阶段门禁。
- 5 是协议与边界基线。
- 6-7 是 Cursor 接入操作面。
- 8 是 sidecar 命令与回归脚本入口。

## 2. 当前系统结构（事实）

### 2.1 运行拓扑

1. Unity Editor 面板（ConversationController）  
2. Sidecar HTTP 服务（TurnService + TurnStore）  
3. Planner（Codex app-server / 本地回退）  
4. MCP 包装服务（`sidecar/src/mcp/mcpServer.js`）  
5. Cursor（作为 MCP Client）

### 2.2 对外 MCP 能力（当前）

当前 MCP 公开工具只有:
1. `submit_unity_task`
2. `get_unity_task_status`
3. `cancel_unity_task`

关键事实:
- 当前未实现 MCP `resources/list` / `resources/read`。
- 当前没有 `get_current_selection` 这类“直接读取 Unity 当前状态”的 MCP 工具。

参考:
- `sidecar/src/mcp/mcpServer.js`

### 2.3 Sidecar HTTP 端点（当前）

核心端点包含:
1. `/turn/send`, `/turn/status`, `/turn/cancel`
2. `/unity/compile/result`, `/unity/action/result`
3. `/unity/query/components/result`（Unity 回传查询结果）
4. `/mcp/submit_unity_task`, `/mcp/get_unity_task_status`, `/mcp/cancel_unity_task`, `/mcp/stream`, `/mcp/metrics`
5. `/state/snapshot`（状态快照，不是实时 Unity selection API）

参考:
- `sidecar/src/api/router.js`

## 3. 两条主链路（必须区分）

### 3.1 Unity 面板直连链路（相对“有上下文”）

1. Unity 面板先要求有选中对象，再发 `turn.send`。  
2. `turn.send.payload.context` 带 `selection` + `selection_tree`。  
3. Sidecar 规划后下发文件动作/视觉动作。  
4. Unity 执行动作并回传 `unity.action.result`。  

参考:
- `Assets/Editor/Codex/Application/ConversationController.cs`
- `Assets/Editor/Codex/Infrastructure/UnitySelectionContextBuilder.cs`

### 3.2 Cursor MCP 链路（相对“任务导向”）

1. Cursor 调 `submit_unity_task`。  
2. Sidecar 转换为 `turn.send`。  
3. 若未提供 context，会使用默认占位 context。  
4. Planner 在需要时可通过内部桥接调用 `query_unity_components`。  
5. 查询回路是 Sidecar 发 `unity.query.components.request`，Unity 回 `unity.query.components.result`。  

关键事实:
- `query_unity_components` 是 planner 内部桥接能力，不是 Cursor 直接可见 MCP 工具。

参考:
- `sidecar/src/application/turnService.js`
- `sidecar/src/adapters/codexAppServerPlanner.js`
- `Assets/Editor/Codex/Application/ConversationController.cs`

## 4. 能力矩阵（你现在最关心的“眼睛 + 手脚”）

### 4.1 眼睛（读取 Unity 实时状态）

现状:
1. Unity 面板链路: 有（通过 `turn.send context` 注入）  
2. Cursor MCP 链路: 弱（无公开读工具；无法直接读“当前选中节点”）  
3. MCP resources: 无

结论:
- 对 Cursor 来说，“眼睛”能力不完整，依赖猜测或历史上下文。

### 4.2 手脚（执行 Unity 操作）

现状:
1. 文件层动作: 已落地（有白名单和尺寸限制）  
2. 视觉层动作: 已落地（add/remove/replace/create）  
3. 错误回传: 有明确错误码（目标不存在、组件解析失败等）  

参考:
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- `sidecar/src/domain/validators.js`

## 5. 关键痛点（优先级）

## P0
1. Cursor 没有“读当前选中对象/层级/组件”的显式 MCP 工具，导致规划前信息不充分。  
2. MCP 无 resources 能力，`@` 工具体验可见性弱，用户难以确认“可读上下文”。  

## P1
1. MCP 任务在未传 context 时会落到默认占位 context，存在误导风险。  
2. 查询组件能力是“内部桥接”，不是可组合的通用读 API。  

## P2
1. 对象定位以 path 为主，场景结构变化后易失效。  
2. 执行后验证偏状态化，缺“预期 vs 实际”结构化差异视图。  

## 6. 当前架构的优点（不要丢）

1. 执行安全边界清晰: 写路径白名单、文件大小限制、结构校验。  
2. 状态机完善: compile/action 阶段、超时、取消、恢复。  
3. 可观测性较好: Step8 质量门禁、回归脚本、失败回放。  
4. 错误反馈可恢复: error_code + suggestion + recoverable 标记。  

## 7. 与 Gemini 讨论时建议聚焦的问题

1. 是否同意“先补读能力，再放开写能力”的顺序。  
2. 读能力最小闭环工具集应包含哪些（selection/hierarchy/components/prefab/console/compile）。  
3. 是否引入 `read -> plan -> execute -> verify` 强制闭环，以及 read token 新鲜度校验。  
4. 如何把内部 `query_unity_components` 提升为公开 MCP 读工具，且不破坏现有链路。  
5. 如何在不推翻现有 Step0-8 资产的前提下演进（渐进重构而非重写）。

## 8. 给 Gemini 的结论提示词（一句话）

当前系统已经具备“受控执行器”能力，但尚未具备“对 Cursor 完整开放的感知层”；请以最小破坏原则设计“读能力优先”的演进方案。

