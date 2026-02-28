# L3 Unity Editor 端死代码清扫报告 (L3 Dead Code Cleanup Report)

**生成时间**: 2024-12-19  
**审查范围**: `Assets/Editor/Codex/` 目录  
**审查目标**: 识别并清理网关化重构后的历史残留代码（Turn 状态机、轮询、自然语言输入）

---

## 1. 现状全景图 (Current Architecture Map)

### 目录结构树

```
Assets/Editor/Codex/
├── Application/
│   └── ConversationController.cs          🗑️ 3000+ 行，需大幅精简
├── Domain/
│   └── SidecarContracts.cs                ⚠️ 包含大量废弃 DTO
├── Infrastructure/
│   ├── EditorPrefsConversationStateStore.cs
│   ├── HttpSidecarGateway.cs              ⚠️ 包含废弃的 Turn/Session API
│   ├── SidecarProcessManager.cs           ✅ 必须保留（进程管理）
│   ├── UnityCompilationStateTracker.cs
│   ├── UnityConsoleErrorTracker.cs
│   ├── UnityRuntimeReloadPingBootstrap.cs ✅ 必须保留（域重载唤醒）
│   ├── UnitySceneRevisionTracker.cs
│   ├── UnitySelectionContextBuilder.cs
│   └── UnityVisualActionExecutor.cs       ✅ 必须保留（物理执行器）
├── Ports/
│   ├── IConversationStateStore.cs
│   ├── ISidecarGateway.cs                 ⚠️ 包含废弃接口方法
│   ├── ISidecarProcessManager.cs
│   ├── ISelectionContextBuilder.cs
│   └── IUnityVisualActionExecutor.cs
└── UI/
    └── CodexChatWindow.cs                 🗑️ 需大幅精简（移除聊天 UI）
```

---

## 2. 深度死代码与冗余扫描 (Dead Code & Redundancy Analysis)

### 2.1 废弃的上帝类：`ConversationController.cs` (3223 行)

**状态**: 严重冗余，需大幅精简  
**当前职责**: 混合了 Turn 状态机、轮询、UI 状态管理、物理执行协调

#### 🗑️ 完全废弃的方法（调用已删除的 L2 API）

1. **`SendTurnAsync`** (行 930-1061)
   - 调用 `/turn/send` (已返回 410 Gone)
   - 处理 `TurnSendRequest` 和 `TurnSendPayload`
   - 设置 `TurnRuntimeState.CodexPending`
   - 处理 `user_message` 自然语言输入
   - **结论**: 完全删除

2. **`CancelTurnAsync`** (行 1063-1113)
   - 调用 `/turn/cancel` (已返回 410 Gone)
   - 处理 `TurnCancelRequest`
   - **结论**: 完全删除

3. **`PollTurnStatusAsync`** (行 1130-1256)
   - 调用 `/turn/status` (已返回 410 Gone)
   - 轮询逻辑，处理事件流
   - **结论**: 完全删除

4. **`ShouldPoll`** (行 1115-1128)
   - 轮询判断逻辑
   - **结论**: 完全删除

5. **`EnsureSessionStartedAsync`** (行 1258-1285)
   - 调用 `/session/start` (已返回 410 Gone)
   - 处理 `SessionStartRequest`
   - **结论**: 完全删除

#### ⚠️ 废弃的状态管理字段

以下字段用于 Turn 状态机和轮询，应删除：

- `_sessionStarted` (行 42) - Session 管理
- `_pollInFlight` (行 43) - 轮询状态
- `_nextPollAt` (行 44) - 轮询调度
- `_codexDeadlineAt` (行 45) - Codex 超时（不再有 Codex 阶段）
- `_runtimeState` (行 47) - Turn 运行时状态（需精简，仅保留 CompilePending, ActionConfirmPending, ActionExecuting）
- `_lastSeenEventSeq` (行 61) - 事件序列号（轮询相关）
- `_lastStatusDiagnosticSignature` (行 62) - 状态诊断（轮询相关）
- `_lastAssistantMessageSignature` (行 63) - 助手消息（LLM 相关）
- `_inflightUnityComponentQueryIds` (行 64-65) - 组件查询（已废弃的查询功能）

#### ⚠️ 废弃的状态枚举值

`TurnRuntimeState` 枚举（`SidecarContracts.cs` 行 5-17）中的废弃值：
- `CodexPending` - 不再有 Codex 阶段
- `AutoFixPending` - AutoFix 已废弃
- `Running` - 通用状态，可删除

**保留的状态**:
- `Idle` - 空闲状态
- `CompilePending` - 等待编译（仍在使用）
- `ActionConfirmPending` - 等待动作确认（仍在使用）
- `ActionExecuting` - 动作执行中（仍在使用）
- `Completed` - 完成（用于历史兼容）
- `Cancelled` - 取消（用于历史兼容）
- `Failed` - 失败（用于历史兼容）

#### ⚠️ 废弃的辅助方法

以下方法用于处理 Turn 状态和轮询，应删除：

- `ProcessTurnEvents` (行 1959-1991) - 处理 Turn 事件流
- `ProcessTurnEventItem` (行 1993-2050+) - 处理单个事件项
- `LogStatusDiagnostics` (行 2052+) - 状态诊断日志
- `LogTurnSendPlan` (行 2100+) - Turn 发送计划日志
- `IsTerminalStatus` (行 2120+) - 判断终端状态
- `ToTurnStatus` (行 2140+) - 转换为 Turn 状态
- `ApplyStage` (行 1428-1530) - 应用阶段转换（需精简，仅保留 CompilePending, ActionConfirmPending）
- `TryTripTimeout` (行 1528-1545) - 超时检查（Codex 超时相关）
- `BuildBusyReasonForRuntimeState` (行 2517-2545) - 构建忙碌原因（需精简）

#### ✅ 必须保留的核心方法

以下方法处理物理执行和结果回传，**绝对不可删除**：

1. **`ReportCompileResultAsync`** (行 611-722)
   - 调用 `/unity/compile/result`
   - **状态**: ✅ 必须保留

2. **`ReportUnityActionResultAsync`** (通过 `ExecutePendingActionAndReportAsync`, 行 739-900+)
   - 调用 `/unity/action/result`
   - **状态**: ✅ 必须保留

3. **`ReportRuntimePingAsync`** / `SendRuntimePingInternalAsync` (行 724-1363)
   - 调用 `/unity/runtime/ping`
   - 域重载唤醒机制
   - **状态**: ✅ 必须保留

4. **`ReportSelectionSnapshotAsync`** (行 323-415)
   - 调用 `/unity/selection/snapshot`
   - **状态**: ✅ 必须保留

5. **`ReportConsoleSnapshotAsync`** (行 417-487)
   - 调用 `/unity/console/snapshot`
   - **状态**: ✅ 必须保留

6. **`ConfirmPendingActionAsync`** / `RejectPendingActionAsync` (行 729-737)
   - 动作确认/拒绝
   - **状态**: ✅ 必须保留（HITL 功能）

7. **`ExecutePendingActionAndReportAsync`** (行 739-900+)
   - 执行动作并回传结果
   - **状态**: ✅ 必须保留

8. **`ApplyPhase6SmokeWriteAsync`** (行 489-608)
   - 测试用的文件操作
   - **状态**: ⚠️ 可选保留（测试功能）

#### 📝 需要精简但保留的方法

以下方法需要精简，移除 Turn 状态机相关逻辑，但保留核心功能：

1. **`HandleCompileGateFromTurnSend`** (行 2492-2515)
   - 当前处理 Turn 发送后的编译门
   - **建议**: 精简为仅处理编译门逻辑，移除 Turn 相关代码

2. **`TryCapturePendingUnityActionRequest`** (行 1400+)
   - 捕获待确认的动作请求
   - **建议**: 保留，但移除 Turn 状态相关逻辑

3. **`HandleTerminalStatus`** (行 1575-1603)
   - 处理终端状态
   - **建议**: 精简，仅保留必要的状态清理

---

### 2.2 废弃的网络网关方法：`HttpSidecarGateway.cs`

#### 🗑️ 完全废弃的方法

1. **`StartSessionAsync`** (行 15-18)
   - 调用 `/session/start`
   - **结论**: 删除方法及其接口定义

2. **`SendTurnAsync`** (行 65-68)
   - 调用 `/turn/send`
   - **结论**: 删除方法及其接口定义

3. **`GetTurnStatusAsync`** (行 70-76)
   - 调用 `/turn/status`
   - **结论**: 删除方法及其接口定义

4. **`CancelTurnAsync`** (行 78-81)
   - 调用 `/turn/cancel`
   - **结论**: 删除方法及其接口定义

#### ✅ 必须保留的方法

- `GetHealthAsync` - ✅ 保留
- `GetStateSnapshotAsync` - ✅ 保留
- `ApplyFileActionsAsync` - ✅ 保留
- `ReportSelectionSnapshotAsync` - ✅ 保留
- `ReportConsoleSnapshotAsync` - ✅ 保留
- `ReportRuntimePingAsync` - ✅ 保留（域重载唤醒）
- `ReportCompileResultAsync` - ✅ 保留
- `ReportUnityActionResultAsync` - ✅ 保留
- `ReportUnityComponentsQueryResultAsync` - ⚠️ 检查是否仍在使用

---

### 2.3 废弃的接口定义：`ISidecarGateway.cs`

#### 🗑️ 需要删除的接口方法

- `StartSessionAsync` (行 8)
- `SendTurnAsync` (行 18)
- `GetTurnStatusAsync` (行 19)
- `CancelTurnAsync` (行 20)

---

### 2.4 废弃的 DTO：`SidecarContracts.cs`

#### 🗑️ 完全废弃的类

1. **`SessionStartRequest`** (行 227-235)
   - 用于 `/session/start`
   - **结论**: 删除

2. **`SessionStartPayload`** (行 238-242)
   - Session 启动负载
   - **结论**: 删除

3. **`SessionStartResponse`** (行 132-138)
   - Session 启动响应
   - **结论**: 删除

4. **`TurnSendRequest`** (行 245-253)
   - 用于 `/turn/send`
   - **结论**: 删除

5. **`TurnSendPayload`** (行 256-260)
   - 包含 `user_message` 和 `context`
   - **结论**: 删除

6. **`TurnCancelRequest`** (行 304-312)
   - 用于 `/turn/cancel`
   - **结论**: 删除

7. **`TurnCancelPayload`** (行 315-318)
   - 取消原因
   - **结论**: 删除

#### ⚠️ 需要精简的类

1. **`TurnStatusResponse`** (行 141-162)
   - 当前包含大量 Turn 状态机字段
   - **保留字段**: `request_id`, `state`, `@event`, `message`, `error_code`, `stage`, `phase`, `pending_visual_action`, `pending_visual_action_count`, `unity_action_request`
   - **删除字段**: `assistant_summary`, `task_allocation`, `files_changed`, `compile_request`, `events`, `latest_event_seq`, `auto_fix_attempts`, `max_auto_fix_attempts`, `replay`
   - **建议**: 精简为仅包含动作确认和编译状态相关的字段

2. **`TurnEventItem`** (行 191-207)
   - Turn 事件项（用于轮询事件流）
   - **结论**: 删除（不再有事件流）

3. **`TurnRuntimeState` 枚举** (行 5-17)
   - 删除: `CodexPending`, `AutoFixPending`, `Running`
   - 保留: `Idle`, `CompilePending`, `ActionConfirmPending`, `ActionExecuting`, `Completed`, `Cancelled`, `Failed`

#### ✅ 必须保留的 DTO

- `UnityCompileResultRequest` / `UnityCompileResultPayload` - ✅ 保留
- `UnityActionResultRequest` / `UnityActionResultPayload` - ✅ 保留
- `UnityRuntimePingRequest` / `UnityRuntimePingPayload` / `UnityRuntimePingResponse` - ✅ 保留
- `UnitySelectionSnapshotRequest` / `UnitySelectionSnapshotPayload` / `UnitySelectionSnapshotResponse` - ✅ 保留
- `UnityConsoleSnapshotRequest` / `UnityConsoleSnapshotPayload` / `UnityConsoleSnapshotResponse` - ✅ 保留
- `FileActionsApplyRequest` / `FileActionsApplyPayload` - ✅ 保留
- `VisualLayerActionItem` - ✅ 保留
- `UnityActionRequestEnvelope` / `UnityActionRequestPayload` - ✅ 保留

---

### 2.5 废弃的 UI 层：`CodexChatWindow.cs`

#### 🗑️ 需要删除的 UI 元素和方法

1. **用户输入相关**:
   - `_messageInput` 字段 (行 19)
   - `SendAsync` 方法 (行 230-245)
   - 消息输入框 UI (行 186-187)
   - Send 按钮 (行 193-196)
   - Cancel 按钮 (行 201-207)

2. **轮询相关**:
   - `OnEditorUpdate` 中的轮询逻辑 (行 68-75)
   - `ShouldPoll` 调用

3. **打字机效果**:
   - `BuildTypingDots` 方法 (行 258-274)
   - "Codex is replying" 显示 (行 212-216)
   - `IsWaitingForCodexReply` 属性使用

#### ✅ 需要保留的 UI 元素

1. **Sidecar 管理**:
   - Start Sidecar 按钮 (行 106-109)
   - Stop Sidecar 按钮 (行 111-114)
   - Health 按钮 (行 116-119)
   - Runtime Ping 按钮 (行 121-124)

2. **动作确认（HITL）**:
   - Approve Action 按钮 (行 167-170)
   - Reject Action 按钮 (行 172-175)
   - 动作确认相关的状态显示

3. **编译结果报告**:
   - Report Compile Success 按钮 (行 139-142)
   - Report Compile Failure 按钮 (行 147-150)
   - 编译状态显示

4. **日志显示**:
   - 日志滚动视图 (行 219-227)

#### 📝 建议的极简 UI 结构

保留后的 `CodexChatWindow` 应包含：
1. Sidecar URL 和 Thread ID 配置
2. Sidecar 生命周期管理按钮（Start/Stop/Health/Ping）
3. 动作确认按钮（Approve/Reject）- 仅在有待确认动作时显示
4. 编译结果报告按钮（Success/Failure）- 仅在编译等待时显示
5. 状态显示（当前 Job 状态、连接状态）
6. 日志显示

---

### 2.6 状态存储：`EditorPrefsConversationStateStore.cs` 和 `PersistedConversationState`

#### ⚠️ 需要精简的字段

`PersistedConversationState` (行 210-224) 中的废弃字段：
- `pending_compile_request_id` - 可保留（用于编译门）
- `pending_action_request_id` - 可保留（用于动作确认）

**需要检查**: `runtime_state` 字段的使用，确保不再存储 `CodexPending` 等废弃状态。

---

### 2.7 域重载 Ping 机制：`UnityRuntimeReloadPingBootstrap.cs`

#### ✅ 必须保留但需精简

**当前状态**: 基本正确，但包含废弃的状态映射

**需要修改**:
- `MapRuntimeState` 方法 (行 86-114) - 移除 `CodexPending`, `AutoFixPending` 的映射
- `MapBusyReason` 方法 (行 116-144) - 移除对应的原因映射

**保留逻辑**: 域重载后的 Ping 发送和状态恢复逻辑必须完整保留。

---

## 3. 必须保护的"生命线" (Guardrails - DO NOT TOUCH)

### ✅ 核心物理执行与协同逻辑（绝对不可删除）

1. **`UnityVisualActionExecutor.cs`** (完整文件)
   - `Execute` 方法及所有动作执行逻辑
   - `ExecuteAddComponent`, `ExecuteRemoveComponent`, `ExecuteReplaceComponent`, `ExecuteCreateGameObject`
   - 所有组件解析和 GameObject 操作逻辑
   - **状态**: ✅ 100% 保留

2. **`UnityRuntimeReloadPingBootstrap.cs`** (核心逻辑)
   - `TryPingAfterReloadAsync` - 域重载后的 Ping 发送
   - 状态恢复逻辑
   - **状态**: ✅ 核心逻辑保留，仅精简状态映射

3. **`SidecarProcessManager.cs`** (完整文件)
   - Sidecar 进程生命周期管理
   - **状态**: ✅ 100% 保留

4. **结果回传接口调用** (在 `ConversationController` 中)
   - `ReportCompileResultAsync` - `/unity/compile/result`
   - `ReportUnityActionResultAsync` - `/unity/action/result`
   - `ReportRuntimePingAsync` - `/unity/runtime/ping`
   - `ReportSelectionSnapshotAsync` - `/unity/selection/snapshot`
   - `ReportConsoleSnapshotAsync` - `/unity/console/snapshot`
   - **状态**: ✅ 100% 保留

5. **动作确认与执行流程**
   - `ConfirmPendingActionAsync` / `RejectPendingActionAsync`
   - `ExecutePendingActionAndReportAsync`
   - `TryCapturePendingUnityActionRequest`
   - **状态**: ✅ 100% 保留

---

## 4. 无情清扫清单 (Ruthless Cleanup Proposal)

### 4.1 完全删除的方法

#### 🗑️ `ConversationController.cs` - 删除废弃方法

**操作 1**: 删除 `SendTurnAsync` 方法
- **删除行**: 930-1061
- **影响**: 移除自然语言输入和 Turn 发送逻辑

**操作 2**: 删除 `CancelTurnAsync` 方法
- **删除行**: 1063-1113
- **影响**: 移除 Turn 取消逻辑

**操作 3**: 删除 `PollTurnStatusAsync` 方法
- **删除行**: 1130-1256
- **影响**: 移除轮询逻辑

**操作 4**: 删除 `ShouldPoll` 方法
- **删除行**: 1115-1128
- **影响**: 移除轮询判断

**操作 5**: 删除 `EnsureSessionStartedAsync` 方法
- **删除行**: 1258-1285
- **影响**: 移除 Session 启动逻辑

**操作 6**: 删除 `ProcessTurnEvents` 方法
- **删除行**: 1959-1991
- **影响**: 移除 Turn 事件流处理

**操作 7**: 删除 `ProcessTurnEventItem` 方法
- **删除行**: 1993-2050+ (需确认完整范围)
- **影响**: 移除单个事件项处理

**操作 8**: 删除 `LogStatusDiagnostics` 方法
- **删除行**: 2052+ (需确认完整范围)
- **影响**: 移除状态诊断日志

**操作 9**: 删除 `LogTurnSendPlan` 方法
- **删除行**: 2100+ (需确认完整范围)
- **影响**: 移除 Turn 发送计划日志

**操作 10**: 删除 `IsTerminalStatus` 方法
- **删除行**: 2120+ (需确认完整范围)
- **影响**: 移除终端状态判断（或精简为仅判断 Completed/Cancelled/Failed）

**操作 11**: 删除 `ToTurnStatus` 方法
- **删除行**: 2140+ (需确认完整范围)
- **影响**: 移除 Turn 状态转换（如果不再需要）

**操作 12**: 精简 `ApplyStage` 方法
- **保留行**: 仅保留 `compile_pending` 和 `action_confirm_pending` / `action_executing` 的处理
- **删除**: `codex_pending`, `auto_fix_pending` 的处理逻辑
- **删除行**: 约 1428-1530 中的相关分支

**操作 13**: 删除 `TryTripTimeout` 方法
- **删除行**: 1528-1545
- **影响**: 移除 Codex 超时检查

**操作 14**: 精简 `BuildBusyReasonForRuntimeState` 方法
- **删除**: `CodexPending`, `AutoFixPending` 的分支
- **保留**: `CompilePending`, `ActionConfirmPending`, `ActionExecuting`
- **修改行**: 2517-2545

---

#### 🗑️ `HttpSidecarGateway.cs` - 删除废弃方法

**操作 15**: 删除 `StartSessionAsync` 方法
- **删除行**: 15-18

**操作 16**: 删除 `SendTurnAsync` 方法
- **删除行**: 65-68

**操作 17**: 删除 `GetTurnStatusAsync` 方法
- **删除行**: 70-76

**操作 18**: 删除 `CancelTurnAsync` 方法
- **删除行**: 78-81

---

#### 🗑️ `ISidecarGateway.cs` - 删除废弃接口方法

**操作 19**: 删除接口方法定义
- **删除行**: 8, 18, 19, 20

---

#### 🗑️ `SidecarContracts.cs` - 删除废弃 DTO

**操作 20**: 删除 `SessionStartRequest`
- **删除行**: 227-235

**操作 21**: 删除 `SessionStartPayload`
- **删除行**: 238-242

**操作 22**: 删除 `SessionStartResponse`
- **删除行**: 132-138

**操作 23**: 删除 `TurnSendRequest`
- **删除行**: 245-253

**操作 24**: 删除 `TurnSendPayload`
- **删除行**: 256-260

**操作 25**: 删除 `TurnCancelRequest`
- **删除行**: 304-312

**操作 26**: 删除 `TurnCancelPayload`
- **删除行**: 315-318

**操作 27**: 删除 `TurnEventItem`
- **删除行**: 191-207

**操作 28**: 精简 `TurnStatusResponse`
- **删除字段**: `assistant_summary`, `task_allocation`, `files_changed`, `compile_request`, `events`, `latest_event_seq`, `auto_fix_attempts`, `max_auto_fix_attempts`, `replay`
- **保留字段**: `request_id`, `state`, `@event`, `message`, `error_code`, `stage`, `phase`, `pending_visual_action`, `pending_visual_action_count`, `unity_action_request`
- **修改行**: 141-162

**操作 29**: 精简 `TurnRuntimeState` 枚举
- **删除值**: `CodexPending`, `AutoFixPending`, `Running`
- **保留值**: `Idle`, `CompilePending`, `ActionConfirmPending`, `ActionExecuting`, `Completed`, `Cancelled`, `Failed`
- **修改行**: 5-17

---

#### 🗑️ `CodexChatWindow.cs` - 删除废弃 UI

**操作 30**: 删除用户输入相关
- **删除字段**: `_messageInput` (行 19)
- **删除方法**: `SendAsync` (行 230-245)
- **删除 UI**: 消息输入框 (行 186-187), Send 按钮 (行 193-196), Cancel 按钮 (行 201-207)

**操作 31**: 删除轮询相关
- **修改 `OnEditorUpdate`**: 移除轮询逻辑 (行 68-75)，可完全删除或仅保留必要的更新

**操作 32**: 删除打字机效果
- **删除方法**: `BuildTypingDots` (行 258-274)
- **删除 UI**: "Codex is replying" 显示 (行 212-216)

---

### 4.2 删除废弃字段

#### 🗑️ `ConversationController.cs` - 删除废弃字段

**操作 33**: 删除以下字段
- `_sessionStarted` (行 42)
- `_pollInFlight` (行 43)
- `_nextPollAt` (行 44)
- `_codexDeadlineAt` (行 45)
- `_lastSeenEventSeq` (行 61)
- `_lastStatusDiagnosticSignature` (行 62)
- `_lastAssistantMessageSignature` (行 63)
- `_inflightUnityComponentQueryIds` (行 64-65)
- `_unityComponentQueryLock` (行 66)

**操作 34**: 精简 `_runtimeState` 字段
- 保留类型，但移除所有 `CodexPending`, `AutoFixPending`, `Running` 的赋值和使用

---

### 4.3 精简但保留的方法

#### 📝 `ConversationController.cs` - 精简方法

**操作 35**: 精简 `HandleCompileGateFromTurnSend`
- 移除 Turn 发送相关逻辑
- 保留编译门开启逻辑
- **修改行**: 2492-2515

**操作 36**: 精简 `HandleTerminalStatus`
- 移除 Turn 状态机相关逻辑
- 保留必要的状态清理
- **修改行**: 1575-1603

**操作 37**: 精简 `TryCapturePendingUnityActionRequest`
- 移除 Turn 状态相关逻辑
- 保留动作请求捕获逻辑
- **修改行**: 1400+ (需确认完整范围)

---

#### 📝 `UnityRuntimeReloadPingBootstrap.cs` - 精简状态映射

**操作 38**: 精简 `MapRuntimeState`
- 删除 `CodexPending`, `AutoFixPending` 的映射
- **修改行**: 86-114

**操作 39**: 精简 `MapBusyReason`
- 删除对应的原因映射
- **修改行**: 116-144

---

### 4.4 保留后的极简骨架

#### 📝 `ConversationController.cs` - 极简骨架

保留后的类应包含：

**核心字段**:
- `_sidecarGateway`, `_processManager`, `_contextBuilder`, `_stateStore`, `_visualActionExecutor`
- `_activeRequestId`, `_turnId` (用于结果回传)
- `_runtimeState` (精简后的状态)
- `_pendingUnityActionRequest` (动作确认)
- `_compileGateOpenedAtUtcTicks` (编译门)
- 日志和状态相关字段

**核心方法**:
- `ReportCompileResultAsync` ✅
- `ReportUnityActionResultAsync` ✅
- `ReportRuntimePingAsync` / `SendRuntimePingInternalAsync` ✅
- `ReportSelectionSnapshotAsync` ✅
- `ReportConsoleSnapshotAsync` ✅
- `ConfirmPendingActionAsync` / `RejectPendingActionAsync` ✅
- `ExecutePendingActionAndReportAsync` ✅
- `TryCapturePendingUnityActionRequest` ✅ (精简后)
- `ApplyPhase6SmokeWriteAsync` ⚠️ (测试功能，可选)
- `StartSidecarAsync` / `StopSidecar` / `CheckHealthAsync` ✅
- 状态管理和日志方法（精简后）

**预计行数**: 从 3223 行减少到约 **800-1000 行**（减少 ~70%）

---

#### 📝 `CodexChatWindow.cs` - 极简 UI 骨架

保留后的 UI 应包含：

1. **配置区域**:
   - Sidecar URL 输入
   - Thread ID 输入

2. **Sidecar 管理区域**:
   - Start Sidecar 按钮
   - Stop Sidecar 按钮
   - Health 按钮
   - Runtime Ping 按钮

3. **动作确认区域** (条件显示):
   - Approve Action 按钮
   - Reject Action 按钮
   - 动作详情显示

4. **编译结果区域** (条件显示):
   - Report Compile Success 按钮
   - Report Compile Failure 按钮
   - 编译状态提示

5. **状态显示区域**:
   - 当前状态文本
   - 连接状态

6. **日志区域**:
   - 日志滚动视图

**预计行数**: 从 277 行减少到约 **150-180 行**（减少 ~40%）

---

## 5. 清扫优先级与风险评估

### 高优先级（低风险）

1. ✅ **删除 `HttpSidecarGateway` 中的废弃方法** - 已确认 L2 不再提供这些端点
2. ✅ **删除 `ISidecarGateway` 接口中的废弃方法** - 接口清理
3. ✅ **删除 `SidecarContracts` 中的废弃 DTO** - DTO 清理
4. ✅ **删除 `CodexChatWindow` 中的聊天 UI** - UI 清理

### 中优先级（需谨慎）

5. ⚠️ **删除 `ConversationController` 中的 Turn 发送/轮询方法** - 需确认没有其他依赖
6. ⚠️ **精简 `ConversationController` 的状态管理** - 需确保编译门和动作确认逻辑完整
7. ⚠️ **精简 `TurnRuntimeState` 枚举** - 需确保所有使用处都已更新

### 低优先级（可选）

8. 📝 **精简 `TurnStatusResponse`** - 如果确认不再需要某些字段
9. 📝 **优化日志和诊断方法** - 可保留但标记为调试用途

---

## 6. 预计清理效果

### 代码行数减少

- `ConversationController.cs`: **-2200 行** (从 3223 到 ~1000)
- `HttpSidecarGateway.cs`: **-15 行**
- `ISidecarGateway.cs`: **-4 行**
- `SidecarContracts.cs`: **-150 行** (DTO 删除 + 精简)
- `CodexChatWindow.cs`: **-100 行** (从 277 到 ~180)
- `UnityRuntimeReloadPingBootstrap.cs`: **-30 行** (状态映射精简)

**总计**: **~-2500 行代码**

### 方法删除

- `ConversationController`: **~15 个方法**
- `HttpSidecarGateway`: **4 个方法**
- `ISidecarGateway`: **4 个接口方法**
- `CodexChatWindow`: **2 个方法**

### DTO 删除

- **7 个完整的 DTO 类**
- **1 个 DTO 类精简** (`TurnStatusResponse`)
- **3 个枚举值删除** (`TurnRuntimeState`)

---

## 7. 验证检查清单

执行清理后，请验证：

- [ ] Unity Editor 可以正常编译
- [ ] Sidecar 进程管理功能正常
- [ ] 域重载 Ping 功能正常（重启 Unity Editor 后自动 Ping）
- [ ] 编译结果报告功能正常
- [ ] 动作执行和结果回传功能正常
- [ ] 动作确认（HITL）功能正常
- [ ] Selection/Console Snapshot 报告功能正常
- [ ] 文件操作功能正常（如 `ApplyPhase6SmokeWriteAsync`）
- [ ] UI 窗口可以正常打开和操作
- [ ] 无编译错误或警告
- [ ] 无运行时错误

---

## 8. 执行建议

### 阶段 1: 安全清理（立即执行）

1. 删除 `HttpSidecarGateway` 中的 4 个废弃方法
2. 删除 `ISidecarGateway` 接口中的 4 个方法
3. 删除 `SidecarContracts` 中的 7 个废弃 DTO
4. 删除 `CodexChatWindow` 中的聊天 UI 元素

### 阶段 2: 核心清理（需谨慎）

5. 删除 `ConversationController` 中的 Turn 发送/轮询方法
6. 删除废弃字段
7. 精简状态枚举和状态管理逻辑

### 阶段 3: 优化清理（可选）

8. 精简 `TurnStatusResponse`
9. 优化日志和诊断方法
10. 代码重构和注释优化

---

**报告结束**
