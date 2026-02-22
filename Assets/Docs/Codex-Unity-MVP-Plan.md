# Unity + Codex app-server MVP 技术规格（v2.1）

- 状态：Active Evolving
- 日期：2026-02-22
- 适用范围：Unity Editor + Bridge Client + Local Sidecar + codex app-server + Workspace
- 文档目标：定义可直接编码的接口字段、状态机、错误码、验收清单

## 1. 强约束总览（已拍板）

1. 单脑决策：仅 Codex 负责意图理解与任务分配，不做多 Agent 路由。
2. 两层映射：Script Layer=Sidecar 文件写入；Visual Layer=Unity Native API 执行。
3. 双阶段回合：`turn.completed.phase` 必填，取值仅 `planning` 或 `final`。
4. 编译门禁：视觉层动作只能在编译成功后执行。
5. 组件标识：视觉层使用 `component_assembly_qualified_name`。
6. 视觉失败回传：`unity.action.result` 必含 `success` 和 `error_message`。
7. 自动修复上限：每轮最多 1 次（编译失败或视觉层失败共用计数）。
8. 上下文熔断：`turn.send.selection_tree.max_depth=2`，超深仅数量截断。
9. 文件防覆盖：`file_actions[*].overwrite_if_exists` 必填，默认 `false`。
10. 并发防乱序：MVP 仅允许单活跃请求；UI 发送按钮锁定至 `turn.completed/turn.error/turn.cancelled`。
11. 取消机制：支持 `turn.cancel`，Sidecar 必须返回 `turn.cancelled` 并清理当前状态。
12. 超时熔断：Codex 软超时 60s，硬超时 200s；Unity 编译等待超时 120s。
13. 文件系统安全：仅允许写 `Assets/Scripts/AIGenerated/`；禁止 `ProjectSettings/`、`Packages/`；单文件上限 100KB。
14. 文件编码：统一 `utf-8` + `\n`；MVP 不自动回滚部分成功写入。
15. Planner 双阶段隔离：Reasoning 阶段可探索代码；Extraction 阶段禁用工具并强制 JSON 输出。
16. Extraction 标准：可执行轮次 `task_allocation` 必须包含 `reasoning_and_plan`（Thought-Before-Action）。
17. 诊断可观测性：`text_turn_started/completed`、`extraction_started/completed` 事件必须可见并带阶段耗时。
18. MCP 接入传输：采用推送优先（`stdio`/`SSE`），`get_unity_task_status` 仅为兜底查询。
19. MCP 审批模式：`submit_unity_task` 必填 `approval_mode`，默认 `auto`，防止跨端确认死锁。
20. MCP 并发控制：workspace 级全局互斥锁，任意时刻仅允许一个 running job。
21. MCP 幂等保证：`submit_unity_task` 必填 `idempotency_key`，重复提交必须返回同一 `job_id`。
22. MCP 背压策略：队列必须有上限（建议 `max_queue=1`），超限立即拒绝并返回 `E_JOB_CONFLICT`。
23. MCP 恢复策略：`running/queued` 任务需持久化，Sidecar 重启后必须恢复或回收。

## 2. 架构与职责边界

```text
Unity Editor
-> Bridge Client（通信适配 + UI 锁定）
-> Local Sidecar（流程编排 + 文件执行 + 状态记忆）
-> codex app-server（AI 决策）
-> Workspace
```

1. Unity 负责：上下文采集、视觉层动作执行、编译结果与动作结果回传。
2. Sidecar 负责：协议翻译、任务拆分、顺序调度、幂等/并发防护、超时控制。
3. Codex 负责：解释、代码计划、`task_allocation` 输出、一次自动修复方案。

## 2.5 2026-02-21 增量落地（相对 v1）

1. Planner 已升级为双阶段：`runTextTurn -> runExtractionTurn`，先自然语言规划，再结构化提取。
2. Reasoning/Extraction 权限已隔离：Reasoning 注入探索工具（`read_file/search_code`）；Extraction 使用 `tool_choice=none`、`response_format={type:"json_object"}`、`outputSchema`。
3. Sidecar 已支持真实流式透传：`chat.delta`/`chat.message` 来自 Codex 原始输出，不再本地拼接伪流。
4. Extraction Schema 已扩展：
   - 文件动作：`create_file/update_file/rename_file/delete_file`
   - 视觉动作：`add_component/remove_component/replace_component/create_gameobject`
   - `task_allocation.reasoning_and_plan`（执行轮次必填）
5. 本地硬校验已落地：禁止 `.unity/.prefab/.asset`、禁止越权路径、禁止 MCP 字段越权。
6. 超时/保活机制已升级：Codex 软超时 60s、硬超时 200s，静默阶段 Keepalive，超时会触发 AbortController 终止后台请求。
7. 诊断埋点已落地：`text_turn_started/completed`、`extraction_started/completed` 事件可用于精确定位卡顿阶段。
8. Unity 视觉执行器已支持模糊匹配：精确匹配优先，失败后模糊匹配（歧义即失败），覆盖 `add/remove/replace` 关键解析路径。

## 2.6 2026-02-22 Roadmap 对齐（MCP 准备项）

1. 已确认采用 “L1 Brain + MCP Adapter + Sidecar Kernel + Unity Executor” 分层，不推翻现有执行内核。
2. 已确认 Job Ticket 异步模式：`submit_unity_task/get_unity_task_status/cancel_unity_task`。
3. 已确认传输策略：MCP 主链路推送优先（`stdio`/`SSE`），查询仅做兜底。
4. 已确认 HITL 策略：通过 `approval_mode` 显式控制，MCP 默认 `auto`。
5. 已确认并发与幂等：全局互斥 + `idempotency_key` + 有界队列。
6. 已确认恢复策略：job 状态持久化并支持重启恢复。

## 2.7 2026-02-22 Step 0/1 门禁审计快照

1. Step 0（基线冻结）通过：
   - 20 轮 smoke 回归通过率 100%（`25/25 pass`）。
   - 独立端口短超时复现 `E_COMPILE_TIMEOUT` 与 `E_CODEX_TIMEOUT` 均通过。
2. Step 1（执行内核稳定化）通过：
   - timeout 清扫继续触发 `AbortController.abort()`，并保留 `diag.timeout.abort` 诊断事件。
   - 增加回滚开关 `ENABLE_TIMEOUT_ABORT_CLEANUP`（默认 `true`）。
3. 基线产物路径：
   - `sidecar/.state/smoke-turn-report-20260222_094514782_06820_328.json`
   - `sidecar/.state/smoke-turn-report-20260222_094520196_17588_254.json`
   - `sidecar/.state/smoke-turn-report-20260222_094528115_33576_146.json`
4. 进入条件判定：
   - 可进入 Step 2（Planner/Prompt 轻量化）。

### 2.1 分层结构（高内聚 + 低耦合）

#### Unity 进程分层

1. `Presentation Layer`：`CodexChatWindow`、状态提示、按钮锁定、日志展示。
2. `Application Layer`：`ConversationController`，负责回合编排与 UI 状态切换。
3. `Domain Layer`：`TurnStateMachine`、错误码映射、策略判定（确认、超时、重试上限）。
4. `Port Layer`：`ISidecarGateway`、`ICompileEventSource`、`IActionExecutor` 等接口契约。
5. `Adapter/Infrastructure Layer`：HTTP 实现、Unity API 实现、EditorPrefs/磁盘持久化实现。

#### Sidecar 进程分层

1. `API Layer`：HTTP 路由与请求解码（`/turn/send`、`/turn/cancel` 等）。
2. `Application Layer`：`TurnOrchestrator`，负责顺序执行（文件 -> 编译 -> 视觉动作）。
3. `Domain Layer`：回合状态机、策略守卫（白名单、幂等、并发、超时、重试）。
4. `Port Layer`：`IModelClient`、`IFileWriter`、`IUnityBridge`、`IStateStore` 接口定义。
5. `Adapter/Infrastructure Layer`：Codex 客户端、文件系统、内存/磁盘状态存储、日志与计时器。

### 2.2 依赖方向（必须单向）

1. 依赖规则：`Presentation -> Application -> Domain -> Port <- Adapter/Infrastructure`。
2. Domain 层不得依赖 Unity API、HTTP、Node 原生 IO、具体 SDK。
3. Application 层只依赖 Domain 与 Port，不直接操作外部系统。
4. Adapter 仅通过 Port 注入，不允许跨层“反向调用业务对象”。
5. 任意跨层快捷调用（例如 UI 直接写文件）视为违规实现。

### 2.3 扩展点设计（保证高扩展）

1. 视觉动作扩展：新增动作时实现 `IVisualActionHandler`，由注册表按 `action.type` 分发，禁止大 `switch` 膨胀。
2. 文件动作扩展：新增 `create_file/update_file/delete_file` 时实现 `IFileActionHandler`，统一走策略守卫。
3. 传输扩展：`ISidecarGateway` 允许未来从 HTTP 切换到 WebSocket/NamedPipe，不影响上层业务。
4. 模型扩展：`IModelClient` 允许后续切换不同模型提供方，保持 `task_allocation` 输出协议不变。
5. 存储扩展：`IStateStore` 支持从内存替换为 SQLite/文件快照，保障域重载和崩溃恢复。

### 2.4 目录建议（落地结构）

1. Unity：`Assets/Editor/Codex/UI`、`Assets/Editor/Codex/Application`、`Assets/Editor/Codex/Domain`、`Assets/Editor/Codex/Ports`、`Assets/Editor/Codex/Infrastructure`。
2. Sidecar：`sidecar/src/api`、`sidecar/src/application`、`sidecar/src/domain`、`sidecar/src/ports`、`sidecar/src/adapters`、`sidecar/src/infrastructure`。
3. 协议共享：`contracts/`（JSON Schema/TS types/C# DTO 生成源），避免两端手写漂移。

## 3. 统一事件封包（Envelope）

除 `chat.delta` 外，事件统一结构：

```json
{
  "event": "string",
  "request_id": "string",
  "thread_id": "string",
  "turn_id": "string",
  "timestamp": "2026-02-19T08:00:00Z",
  "payload": {}
}
```

字段规则：

1. `request_id`：同一 request/result 必须一致。
2. `thread_id` + `turn_id`：唯一标识回合上下文。
3. `timestamp`：ISO-8601 UTC。

`chat.delta` 轻量结构：`event/thread_id/turn_id/seq/delta`。

## 4. 接口字段级规格

### 4.1 Unity -> Sidecar

#### 4.1.1 `session.start`

```json
{
  "event": "session.start",
  "request_id": "req_session_001",
  "thread_id": "t_001",
  "turn_id": "u_000",
  "timestamp": "2026-02-19T08:00:00Z",
  "payload": {
    "workspace_root": "E:/UnityHub/UnityAI",
    "model": "codex",
    "policy": {
      "max_auto_fix_attempts": 1,
      "allowed_visual_actions": [
        "add_component",
        "remove_component",
        "replace_component",
        "create_gameobject"
      ],
      "allowed_write_roots": ["Assets/Scripts/AIGenerated/"],
      "forbidden_write_roots": ["ProjectSettings/", "Packages/"],
      "max_file_bytes": 102400,
      "default_overwrite_if_exists": false,
      "codex_soft_timeout_ms": 60000,
      "codex_hard_timeout_ms": 200000,
      "compile_timeout_ms": 120000
    }
  }
}
```

#### 4.1.2 `turn.send`

发送前置条件（Unity 端 Pre-flight）：

1. `Selection.activeGameObject != null`，否则本地提示错误并禁止发请求。
2. 发送按钮置灰并显示“思考/执行中”。

```json
{
  "event": "turn.send",
  "request_id": "req_turn_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:00Z",
  "payload": {
    "user_message": "给主预制体加 HelloWorld 逻辑",
    "context": {
      "selection": {
        "mode": "selection",
        "target_object_path": "Scene/MainRoot",
        "prefab_path": "Assets/Prefabs/MainRoot.prefab"
      },
      "selection_tree": {
        "max_depth": 2,
        "root": {
          "name": "MainRoot",
          "path": "Scene/MainRoot",
          "depth": 0,
          "components": ["Transform"],
          "children": [
            {
              "name": "ChildA",
              "path": "Scene/MainRoot/ChildA",
              "depth": 1,
              "components": ["Transform"],
              "children": [
                {
                  "name": "Leaf1",
                  "path": "Scene/MainRoot/ChildA/Leaf1",
                  "depth": 2,
                  "components": ["Transform"],
                  "children_truncated_count": 3
                }
              ]
            }
          ]
        },
        "truncated_node_count": 3,
        "truncated_reason": "max_depth_exceeded"
      }
    }
  }
}
```

#### 4.1.3 `unity.compile.result`

```json
{
  "event": "unity.compile.result",
  "request_id": "req_compile_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:20Z",
  "payload": {
    "success": false,
    "duration_ms": 3210,
    "errors": [
      {
        "code": "CS0246",
        "file": "Assets/Scripts/AIGenerated/HelloWorld.cs",
        "line": 7,
        "column": 13,
        "message": "The type or namespace name 'MonoBehaviourX' could not be found"
      }
    ]
  }
}
```

#### 4.1.4 `unity.action.result`

```json
{
  "event": "unity.action.result",
  "request_id": "req_action_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:35Z",
  "payload": {
    "action_type": "add_component",
    "target_object_path": "Scene/MainRoot",
    "component_assembly_qualified_name": "Game.HelloWorld, Assembly-CSharp",
    "success": false,
    "error_code": "E_ACTION_DEPENDENCY_MISSING",
    "error_message": "Missing required component: Rigidbody",
    "duration_ms": 18
  }
}
```

字段要求：`success`、`error_message` 必填。

#### 4.1.5 `turn.cancel`

```json
{
  "event": "turn.cancel",
  "request_id": "req_turn_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:05Z",
  "payload": {
    "reason": "user_clicked_cancel"
  }
}
```

#### 4.1.6 `unity.runtime.ping`

用于域重载后恢复：

```json
{
  "event": "unity.runtime.ping",
  "request_id": "req_ping_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:30Z",
  "payload": {
    "status": "just_recompiled"
  }
}
```

### 4.2 Sidecar -> Unity

#### 4.2.1 `chat.delta`

```json
{
  "event": "chat.delta",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "seq": 12,
  "delta": "我将先创建脚本并等待编译完成。"
}
```

#### 4.2.2 `chat.message`

```json
{
  "event": "chat.message",
  "request_id": "req_msg_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:10Z",
  "payload": {
    "role": "assistant",
    "content": "计划已生成，开始执行脚本层动作。"
  }
}
```

#### 4.2.3 `files.changed`

```json
{
  "event": "files.changed",
  "request_id": "req_files_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:15Z",
  "payload": {
    "changes": [
      {
        "type": "create_file",
        "path": "Assets/Scripts/AIGenerated/HelloWorld.cs"
      }
    ]
  }
}
```

#### 4.2.x `file_actions.apply`（Phase 3 调试接口）

在 Codex 真正输出 `task_allocation` 之前，MVP 开发阶段允许 Sidecar 暴露调试 HTTP 端点：

1. `POST /file-actions/apply`
2. 事件体 `event=file_actions.apply`
3. 载荷 `payload.file_actions[]` 与正式协议字段一致（`type/path/content/overwrite_if_exists`）
4. 成功返回 `files.changed` 结构；失败返回 `turn.error`（带 `error_code`）

#### 4.2.y `unity.compile.result`（Phase 4 调试回传接口）

在真实双向事件总线接入前，MVP 开发阶段允许 Unity 通过 HTTP 主动回传编译结果：

1. `POST /unity/compile/result`
2. 事件体 `event=unity.compile.result`
3. 载荷包含 `payload.success:boolean`，可选 `payload.duration_ms` 与 `payload.errors[]`
4. Sidecar 仅在 `compile_pending` 阶段接受该事件：
   - 成功：推进为 `turn.completed`
   - 失败：推进为 `turn.error(E_COMPILE_FAILED)`

#### 4.2.z `unity.action.result`（Phase 5 调试回传接口）

在真实事件总线完善前，MVP 开发阶段允许 Unity 通过 HTTP 主动回传视觉层动作执行结果：

1. `POST /unity/action/result`
2. 事件体 `event=unity.action.result`
3. 载荷至少包含 `payload.action_type`、`payload.target`、`payload.component_assembly_qualified_name`、`payload.success`、`payload.error_message`
4. Sidecar 仅在 `action_confirm_pending/action_executing` 阶段接受该事件：
   - 成功且无后续动作：推进为 `turn.completed`
   - 成功且仍有后续动作：返回下一个 `unity.action.request`
   - 失败：推进为 `turn.error(E_ACTION_EXECUTION_FAILED)`（或使用回传的具体 `E_ACTION_*`）

#### 4.2.4 `unity.compile.request`

```json
{
  "event": "unity.compile.request",
  "request_id": "req_compile_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:16Z",
  "payload": {
    "reason": "file_actions_applied",
    "refresh_assets": true
  }
}
```

#### 4.2.5 `unity.action.request`

```json
{
  "event": "unity.action.request",
  "request_id": "req_action_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:30Z",
  "payload": {
    "requires_confirmation": true,
    "action": {
      "type": "add_component",
      "target": "selection",
      "component_assembly_qualified_name": "Game.HelloWorld, Assembly-CSharp"
    }
  }
}
```

#### 4.2.6 `turn.completed`

`phase=planning` 示例：

```json
{
  "event": "turn.completed",
  "request_id": "req_turn_completed_plan_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:09Z",
  "phase": "planning",
  "payload": {
    "assistant_summary": "将先写入脚本并编译，再执行挂载。",
    "task_allocation": {
      "file_actions": [
        {
          "type": "create_file",
          "path": "Assets/Scripts/AIGenerated/HelloWorld.cs",
          "content": "...",
          "overwrite_if_exists": false
        }
      ],
      "visual_layer_actions": [
        {
          "type": "add_component",
          "target": "selection",
          "component_assembly_qualified_name": "Game.HelloWorld, Assembly-CSharp"
        }
      ],
      "policy": {
        "visual_requires_compile_success": true,
        "max_auto_fix_attempts": 1
      }
    }
  }
}
```

`phase=final` 示例：

```json
{
  "event": "turn.completed",
  "request_id": "req_turn_completed_final_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:40Z",
  "phase": "final",
  "payload": {
    "assistant_summary": "已完成脚本创建、编译通过并挂载组件。",
    "execution_report": {
      "files_changed": ["Assets/Scripts/AIGenerated/HelloWorld.cs"],
      "compile_success": true,
      "action_success": true,
      "auto_fix_attempts": 0
    },
    "next_steps": ["如需可继续自动设置公开字段默认值。"]
  }
}
```

#### 4.2.7 `turn.error`

```json
{
  "event": "turn.error",
  "request_id": "req_turn_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:40Z",
  "payload": {
    "error_code": "E_RETRY_LIMIT_REACHED",
    "error_message": "Compile failed after one auto-fix attempt",
    "auto_fix_attempts": 1,
    "recoverable": false,
    "suggestion": "请人工检查编译错误后重试。"
  }
}
```

#### 4.2.8 `turn.cancelled`

```json
{
  "event": "turn.cancelled",
  "request_id": "req_turn_001",
  "thread_id": "t_001",
  "turn_id": "u_001",
  "timestamp": "2026-02-19T08:01:06Z",
  "payload": {
    "cancelled_stage": "SCRIPT_EXECUTING",
    "message": "Turn cancelled by user"
  }
}
```

### 4.3 Sidecar HTTP 防并发语义

1. Sidecar 维护 `current_active_request_id`（全局单活跃）。
2. 当该值非空且收到新的 `turn.send`：返回 HTTP 429，错误码 `E_TOO_MANY_ACTIVE_TURNS`。
3. 当收到同 `request_id` 重放：返回缓存结果，不重复执行文件写入/视觉动作。

### 4.4 MCP Adapter 工具契约（Roadmap 对齐草案）

#### 4.4.1 `submit_unity_task`

请求:

```json
{
  "thread_id": "t_001",
  "idempotency_key": "idem_9f5f4c5e",
  "approval_mode": "auto",
  "user_intent": "把 Hello2026 挂到 Scene/Canvas/Image",
  "task_allocation": {
    "reasoning_and_plan": "..."
  }
}
```

响应（成功受理）:

```json
{
  "status": "accepted",
  "job_id": "job_20260222_001",
  "message": "Task accepted. Progress will be pushed through MCP stream."
}
```

响应（并发拒绝）:

```json
{
  "status": "rejected",
  "reason_code": "E_JOB_CONFLICT",
  "running_job_id": "job_20260222_0009",
  "message": "Another Unity compilation/action is in progress."
}
```

响应（幂等命中）:

```json
{
  "status": "accepted",
  "job_id": "job_20260222_001",
  "idempotent_replay": true
}
```

#### 4.4.2 `get_unity_task_status`（兜底查询）

```json
{
  "status": "pending",
  "stage": "compile_pending",
  "progress_message": "Waiting for Unity compile result",
  "running_job_id": "job_20260222_001"
}
```

#### 4.4.3 `cancel_unity_task`

```json
{
  "status": "cancelled",
  "job_id": "job_20260222_001"
}
```

#### 4.4.4 推送事件（`stdio`/`SSE`）

```json
{
  "event": "job.progress",
  "job_id": "job_20260222_001",
  "status": "pending",
  "stage": "script_executing",
  "message": "Writing files to Assets/Scripts/AIGenerated"
}
```

```json
{
  "event": "job.completed",
  "job_id": "job_20260222_001",
  "status": "succeeded",
  "execution_report": {
    "compile_success": true,
    "visual_actions_success": true
  }
}
```

## 5. Sidecar 执行规则

1. 仅 `phase=planning` 可携带 `task_allocation`。
2. `file_actions` 按数组顺序执行。
3. `file_actions[*]` 必须包含：`type`、`path`、`content`、`overwrite_if_exists`。
4. 文件已存在且 `overwrite_if_exists=false`：立即失败 `E_FILE_EXISTS_BLOCKED`。
5. 写入路径必须在 `Assets/Scripts/AIGenerated/` 下，否则 `E_FILE_PATH_FORBIDDEN`。
6. 文件大小超过 100KB：`E_FILE_SIZE_EXCEEDED`。
7. 编码强制 `utf-8`，换行符强制 `\n`。
8. 不自动回滚部分成功写入，失败时记录审计并终止当前轮。
9. `visual_layer_actions` 仅在编译成功后执行。
10. Sidecar 接收 `turn.cancel` 后必须立即中止 Codex 网络请求、停止后续执行并清空当前状态。
11. MCP `submit_unity_task` 请求必须包含 `idempotency_key`，缺失则 `E_SCHEMA_INVALID`。
12. 若存在 running job 且队列已满，必须立即拒绝并返回 `E_JOB_CONFLICT`。
13. MCP 模式默认 `approval_mode=auto`，不进入 `ACTION_CONFIRM_PENDING` 等待本地 UI 确认。

## 6. Unity 端边界防御

1. Pre-flight：用户点击发送时若无选中对象，直接本地报错“请先在 Hierarchy 中选中一个目标物体”。
2. 不满足 Pre-flight 时不得发送 `turn.send`，避免无效 Token 消耗。
3. 组件解析先走 `Type.GetType(component_assembly_qualified_name)`。
4. 若失败，后备遍历 `AppDomain.CurrentDomain.GetAssemblies()` 按类型名匹配。
5. 若后备匹配结果为 0：`E_ACTION_COMPONENT_RESOLVE_FAILED`。
6. 若后备匹配结果 >1：`E_ACTION_COMPONENT_AMBIGUOUS`。

## 7. 域重载恢复策略（强约束）

1. Sidecar 在编译成功后且视觉动作待执行时，状态置为 `WAITING_FOR_UNITY_REBOOT`，并缓存 `visual_layer_actions`。
2. Unity 编译完成后通过 `[InitializeOnLoad]` 自动发送 `unity.runtime.ping(status=just_recompiled)`。
3. Sidecar 收到 ping 后若检测到待执行动作，立即回发 `unity.action.request`。
4. Unity 执行并回传 `unity.action.result`，流程继续。

## 8. 修正后的时序（HelloWorld 闭环）

1. Unity Pre-flight 校验 selection 非空。
2. Unity 发送 `turn.send` 并锁定发送按钮。
3. Codex 流式输出 `chat.delta`，Sidecar 接收 `turn.completed phase=planning`。
4. Sidecar 执行 `file_actions` 并回传 `files.changed`。
5. Sidecar 发送 `unity.compile.request` 并等待 `unity.compile.result`（120s 超时）。
6. 编译失败：进入自动修复（最多一次）。
7. 编译成功：若发生域重载，等待 `unity.runtime.ping` 后继续。
8. Sidecar 下发 `unity.action.request`（默认确认）。
9. Unity 回传 `unity.action.result`（必须包含 `success/error_message`）。
10. 动作失败：进入自动修复（最多一次）。
11. 成功：Sidecar 下发 `turn.completed phase=final` 并解锁 UI。
12. 任一失败：Sidecar 下发 `turn.error` 并解锁 UI。
13. 用户点击取消：Unity 发 `turn.cancel`，Sidecar 回 `turn.cancelled` 并解锁 UI。

## 9. 回合状态机（Turn State Machine）

状态定义：

1. `IDLE`
2. `RECEIVED`
3. `PLANNING_STREAM`
4. `PLAN_READY`
5. `SCRIPT_EXECUTING`
6. `COMPILE_PENDING`
7. `WAITING_FOR_UNITY_REBOOT`
8. `ACTION_CONFIRM_PENDING`
9. `ACTION_EXECUTING`
10. `AUTO_FIX_PENDING`
11. `FINALIZING`
12. `COMPLETED`
13. `CANCELLED`
14. `FAILED`

关键转移：

1. `IDLE -> RECEIVED`：收到 `turn.send`。
2. `RECEIVED -> PLANNING_STREAM`：开始接收 `chat.delta`。
3. `PLANNING_STREAM -> PLAN_READY`：收到 `phase=planning`。
4. `PLAN_READY -> SCRIPT_EXECUTING`：执行 `file_actions`。
5. `SCRIPT_EXECUTING -> COMPILE_PENDING`：请求编译。
6. `COMPILE_PENDING -> WAITING_FOR_UNITY_REBOOT`：编译成功且 Unity 域重载中。
7. `WAITING_FOR_UNITY_REBOOT -> ACTION_CONFIRM_PENDING`：收到 `unity.runtime.ping`。
8. `COMPILE_PENDING -> ACTION_CONFIRM_PENDING`：编译成功且无需等待重载。
9. `ACTION_CONFIRM_PENDING -> ACTION_EXECUTING`：用户确认。
10. `ACTION_EXECUTING -> FINALIZING`：动作成功。
11. `COMPILE_PENDING/ACTION_EXECUTING -> AUTO_FIX_PENDING`：失败且可重试。
12. `AUTO_FIX_PENDING -> SCRIPT_EXECUTING`：收到修复方案。
13. 任意活动状态 -> `CANCELLED`：收到 `turn.cancel`。
14. 任意活动状态 -> `FAILED`：超时、协议错误、重试超限。
15. `FINALIZING -> COMPLETED`：发出 `phase=final`。

持久化字段：

1. `thread_id`、`turn_id`、`state`。
2. `current_active_request_id`。
3. `pending_compile_request_id`、`pending_action_request_id`。
4. `pending_visual_layer_actions`。
5. `auto_fix_attempts`。
6. `last_error_code`、`last_error_message`。

## 10. 自动修复逻辑

1. 触发源：`unity.compile.result.success=false` 或 `unity.action.result.success=false`。
2. 上限：`max_auto_fix_attempts=1`。
3. Codex 请求超时：软超时 60s（无进展），硬超时 200s（总时长上限），超时错误 `E_CODEX_TIMEOUT`。
4. 编译等待超时：120s，超时错误 `E_COMPILE_TIMEOUT`。
5. 达上限后返回 `turn.error(E_RETRY_LIMIT_REACHED)`。

## 11. 错误码定义（MVP）

| 错误码 | 场景 | 说明 | 可自动修复 |
|---|---|---|---|
| `E_SCHEMA_INVALID` | 协议 | 字段缺失/类型错误 | 否 |
| `E_PHASE_INVALID` | 流程 | `phase` 非法或时序错误 | 否 |
| `E_REQUEST_ID_MISMATCH` | 链路 | request/result `request_id` 不一致 | 否 |
| `E_TOO_MANY_ACTIVE_TURNS` | 并发 | 存在活跃请求，返回 HTTP 429 | 否 |
| `E_JOB_CONFLICT` | 并发 | MCP 提交任务时命中全局互斥/队列已满 | 否 |
| `E_TURN_CANCELLED` | 取消 | 用户主动中止回合 | 否 |
| `E_CANCEL_NOT_FOUND` | 取消 | 无可取消的活跃回合 | 否 |
| `E_CONTEXT_DEPTH_VIOLATION` | 上下文 | 未遵循 `max_depth=2` | 否 |
| `E_SELECTION_REQUIRED` | Pre-flight | 发送前无选中对象 | 否 |
| `E_FILE_PATH_FORBIDDEN` | 文件 | 路径不在白名单或命中黑名单 | 否 |
| `E_FILE_EXISTS_BLOCKED` | 文件 | 文件存在且不允许覆盖 | 否 |
| `E_FILE_SIZE_EXCEEDED` | 文件 | 超过 100KB 限制 | 否 |
| `E_FILE_WRITE_FAILED` | 文件 | IO 或权限错误 | 否 |
| `E_COMPILE_FAILED` | 编译 | Unity 编译失败 | 是 |
| `E_COMPILE_TIMEOUT` | 编译 | 等待编译超时 | 是 |
| `E_CODEX_TIMEOUT` | Sidecar->Codex | 调用 Codex 超时（soft=60s / hard=200s） | 是 |
| `E_ACTION_TARGET_NOT_FOUND` | 视觉 | 目标对象不存在 | 否 |
| `E_ACTION_COMPONENT_RESOLVE_FAILED` | 视觉 | 组件类型解析失败 | 是 |
| `E_ACTION_COMPONENT_AMBIGUOUS` | 视觉 | 后备匹配出现多个候选 | 否 |
| `E_ACTION_DEPENDENCY_MISSING` | 视觉 | 组件依赖缺失 | 是 |
| `E_ACTION_EXECUTION_FAILED` | 视觉 | Unity API 调用失败 | 是 |
| `E_ACTION_CONFIRM_REJECTED` | 交互 | 用户拒绝执行 | 否 |
| `E_RETRY_LIMIT_REACHED` | 自动修复 | 超过 1 次上限 | 否 |
| `E_INTERNAL` | 通用 | 未分类内部错误 | 否 |

## 12. 验收清单（接口级 + 流程级）

1. UI 锁定：发送后按钮置灰，直到 `turn.completed/turn.error/turn.cancelled` 解锁。
2. 并发保护：活跃请求未完成时，新请求返回 HTTP 429 + `E_TOO_MANY_ACTIVE_TURNS`。
3. 取消闭环：点击取消后收到 `turn.cancelled`，且 Sidecar 清空当前状态。
4. Pre-flight：未选择对象时不发送请求，直接本地红字提示。
5. 上下文熔断：`max_depth=2` 且超深节点使用截断计数。
6. 文件白名单：仅允许写入 `Assets/Scripts/AIGenerated/`。
7. 文件防覆盖：`overwrite_if_exists=false` 且文件存在时返回 `E_FILE_EXISTS_BLOCKED`。
8. 文件大小限制：超过 100KB 返回 `E_FILE_SIZE_EXCEEDED`。
9. 编码一致：生成文件为 `utf-8` + `\n`。
10. 编译门禁：编译成功前不得发送 `unity.action.request`。
11. 域重载恢复：`unity.runtime.ping` 后可恢复并继续执行待挂载动作。
12. 组件解析：先精确解析，再后备扫描；多候选返回 `E_ACTION_COMPONENT_AMBIGUOUS`。
13. 视觉失败回传：`unity.action.result` 失败时含 `success=false` 和非空 `error_message`。
14. 自动修复上限：失败最多自动修复 1 次，超限返回 `E_RETRY_LIMIT_REACHED`。
15. 成功闭环：文件写入 -> 编译成功 -> 挂载成功 -> `phase=final`。

## 13. 阶段开发流程方案（逐步执行）

### Phase 0 基线与脚手架

1. 开发项：Unity EditorWindow、发送锁定 UI、取消按钮、Sidecar 健康检查。
2. DoD：可启动 Sidecar，UI 可锁定/解锁，取消按钮可触发占位流程。

### Phase 1 协议层与防乱序

1. 开发项：Envelope 校验、`current_active_request_id`、HTTP 429、`request_id` 去重缓存。
2. DoD：并发请求被拒绝；同 `request_id` 重放不重复执行。

### Phase 2 会话状态机与取消

1. 开发项：状态机持久化、`turn.cancel/turn.cancelled`、超时熔断（soft=60s / hard=200s / compile=120s）。
2. DoD：任何活动阶段都可取消并清理状态，超时可稳定失败退出。

### Phase 3 脚本层执行器

1. 开发项：`file_actions`、白名单/黑名单、100KB 限制、`overwrite_if_exists`、编码统一。
2. DoD：非法路径/超限/覆盖冲突都能准确报错，合法写入可回传 `files.changed`。

### Phase 4 编译门禁与域重载恢复

1. 开发项：`unity.compile.request/result`、`WAITING_FOR_UNITY_REBOOT`、`unity.runtime.ping`。
2. DoD：编译后即使域重载，也能恢复并继续后续视觉层动作。

### Phase 5 视觉层执行器（v2: add/remove/replace/create）

1. 开发项：动作确认、目标定位、组件解析（精确 + 后备扫描）。
2. DoD：成功挂载；失败返回 `E_ACTION_*`，并带明确 `error_message`。

### Phase 6 自动修复闭环

1. 开发项：失败摘要回传 Codex、一次自动修复、超限终止。
2. DoD：编译或动作失败时最多自动修 1 次，第二次失败返回 `E_RETRY_LIMIT_REACHED`。

### Phase 7 联调与验收

1. 开发项：HelloWorld 成功路径、编译失败路径、动作失败路径、取消路径、重载路径回归测试。
2. DoD：第 12 节验收项全部通过。

### Phase 8 MCP Adapter + Job Ticket

1. 开发项：`submit_unity_task/get_unity_task_status/cancel_unity_task`、`approval_mode`、`idempotency_key`、全局互斥锁、有界队列。
2. DoD：MCP 调用链路不因编译长耗时阻塞；并发冲突可拒绝；重复提交不重复执行。

### Phase 9 推送通道与恢复治理

1. 开发项：`stdio`/`SSE` 推送事件、断线重连补偿查询、job 持久化恢复、背压监控。
2. DoD：重启后可恢复 `running/queued` 任务；主链路以推送为主，查询调用降为低频。


