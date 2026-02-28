# 架构隐患深度分析报告

**生成时间**: 2024-12-19  
**分析范围**: L2 Sidecar 与 L3 Unity 的并发控制、死锁风险、状态同步、错误处理

---

## 1. 读写操作的并发冲突 (LockManager 粒度问题)

### 🔍 现状分析

**LockManager 实现** (`sidecar/src/application/jobRuntime/lockManager.js`):

```javascript
class LockManager {
  constructor() {
    this.runningJobId = "";  // 全局互斥锁，只维护一个 runningJobId
  }
  
  acquire(jobId) {
    if (!this.runningJobId) {
      this.runningJobId = normalizedJobId;
      return true;
    }
    return this.runningJobId === normalizedJobId;  // 只允许同一个 Job 重复获取
  }
}
```

**关键发现**:
- ✅ **LockManager 是全局互斥锁（Mutex）**，不是读写锁（RWLock）
- ✅ **读操作（MCP Eyes）完全不检查锁**，直接访问 `unitySnapshotService.getLatestSelectionSnapshot()`
- ⚠️ **写操作会获取锁**，在 `compile_pending` 期间锁不会被释放

### 🚨 隐患确认

**问题场景**:
1. L1 提交写任务 → L2 获取锁 → L3 开始编译（`compile_pending`，可能需要 10-30 秒）
2. 在编译期间，L1 调用 `get_current_selection` 或 `get_gameobject_components`
3. **读操作不会被阻塞**，但返回的快照可能是：
   - Unity 正在编译中，场景状态不稳定
   - 文件已修改但尚未编译完成，组件信息可能过时
   - 场景修订号（`scene_revision`）可能不准确

**代码证据** (`mcpEyesReadService.js:24-57`):
```javascript
getCurrentSelection() {
  // 直接访问快照，不检查 LockManager
  const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
  // 返回快照，没有状态验证
  return { ...snapshot, read_token: token };
}
```

### 💡 建议方案

#### 方案 A: 快照版本标记（推荐）
在快照中添加编译状态标记，让 L1 知道数据可能不准确：

```javascript
getCurrentSelection() {
  const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
  const runningJob = this.mcpGateway.getRunningJob();
  const isCompiling = runningJob && runningJob.stage === "compile_pending";
  
  return {
    ...snapshot,
    read_token: token,
    data_freshness: isCompiling ? "stale_during_compile" : "fresh",
    warning: isCompiling 
      ? "Selection snapshot captured during compilation. Component information may be outdated."
      : null
  };
}
```

#### 方案 B: 读操作等待编译完成（不推荐）
在编译期间阻塞读操作，但这会导致 L1 在编译时完全"致盲"，影响用户体验。

#### 方案 C: 快照缓存策略
维护两个快照：
- `latest_snapshot` - 最新快照（可能不准确）
- `last_stable_snapshot` - 最后一次编译完成后的稳定快照

让 L1 选择使用哪个快照。

---

## 2. 域重载 (Domain Reload) 的死锁风险

### 🔍 现状分析

**域重载恢复机制** (`unityCallbacks.js:87-144`):
```javascript
function handleUnityRuntimePing(gateway, body) {
  const runningJob = gateway.getRunningJob();
  if (!runningJob) {
    return { recovered: false, message: "No active job to recover" };
  }
  
  const transition = gateway.unityDispatcher.handleRuntimePing(runningJob, body);
  if (transition.kind !== "waiting_action") {
    return { recovered: false };
  }
  
  // 恢复挂起的动作
  updateJob(gateway, runningJob.job_id, {
    status: "pending",
    stage: "action_pending",
    // ...
  });
}
```

**关键发现**:
- ✅ 有自动唤醒机制（`UnityRuntimeReloadPingBootstrap`）
- ❌ **没有超时检测机制** - 如果 Unity 进入 Safe Mode，`[InitializeOnLoad]` 不会执行
- ❌ **没有轮询降级方案** - L2 会一直等待 `unity.runtime.ping`

### 🚨 隐患确认

**死锁场景**:
1. L2 下发脚本修改，包含 C# 语法错误
2. Unity 编译失败，进入 Safe Mode（安全模式）
3. `[InitializeOnLoad]` 脚本在 Safe Mode 中**不会执行**
4. `UnityRuntimeReloadPingBootstrap` 永远不会发送 `unity.runtime.ping`
5. L2 Job 永远卡在 `WAITING_FOR_UNITY_REBOOT` 状态
6. **后续所有新任务被阻塞在队列中**

**代码证据** (`jobRecovery.js:52-81`):
```javascript
cleanupExpired(nowMs) {
  // 只清理终端状态的 Job
  if (!isTerminalMcpStatus(job.status)) {
    continue;  // WAITING_FOR_UNITY_REBOOT 不是终端状态，不会被清理
  }
  // ...
}
```

### 💡 建议方案

#### 方案 A: 超时检测机制（强烈推荐）

在 `mcpGateway.js` 中添加超时检测：

```javascript
class McpGateway {
  constructor(deps) {
    // ...
    this.unityRebootTimeoutMs = opts.unityRebootTimeoutMs || 300000; // 5 分钟
    this.rebootTimeoutTimers = new Map(); // job_id -> timer
  }
  
  suspendForReboot(jobId) {
    // 设置超时定时器
    const timer = setTimeout(() => {
      this.handleRebootTimeout(jobId);
    }, this.unityRebootTimeoutMs);
    this.rebootTimeoutTimers.set(jobId, timer);
  }
  
  handleRebootTimeout(jobId) {
    const job = this.jobStore.getJob(jobId);
    if (job && job.stage === "WAITING_FOR_UNITY_REBOOT") {
      // 超时后，假设 Unity 可能进入了 Safe Mode
      finalizeJob(this, jobId, {
        status: "failed",
        stage: "failed",
        error_code: "E_UNITY_REBOOT_TIMEOUT",
        error_message: "Unity domain reload timeout. Unity may be in Safe Mode due to compilation errors.",
        suggestion: "Check Unity console for compilation errors. Fix errors and manually trigger unity.runtime.ping if needed."
      });
      this.lockManager.release(jobId);
      this.promoteNextQueuedJob(this);
    }
    this.rebootTimeoutTimers.delete(jobId);
  }
  
  resumeFromReboot(jobId) {
    // 恢复时清除超时定时器
    const timer = this.rebootTimeoutTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.rebootTimeoutTimers.delete(jobId);
    }
  }
}
```

#### 方案 B: 轮询降级方案

在 L3 添加健康检查端点，L2 定期轮询：

```javascript
// L2 定期检查 Unity 是否还活着
setInterval(async () => {
  const runningJob = this.getRunningJob();
  if (runningJob && runningJob.stage === "WAITING_FOR_UNITY_REBOOT") {
    const health = await this.checkUnityHealth();
    if (!health.alive) {
      // Unity 可能崩溃或进入 Safe Mode
      this.handleRebootTimeout(runningJob.job_id);
    }
  }
}, 30000); // 每 30 秒检查一次
```

#### 方案 C: 手动恢复接口

提供管理接口，允许手动取消挂起的 Job：

```javascript
// POST /admin/jobs/:job_id/cancel-suspended
cancelSuspendedJob(jobId) {
  const job = this.jobStore.getJob(jobId);
  if (job && job.stage === "WAITING_FOR_UNITY_REBOOT") {
    // 允许手动取消挂起的 Job
    return this.cancelUnityTask({ job_id: jobId });
  }
}
```

---

## 3. L1 状态脱节与垃圾回收 (Zombie Jobs)

### 🔍 现状分析

**SSE 连接管理** (`api/router.js:310-320`):
```javascript
req.on("close", cleanup);
res.on("close", cleanup);

function cleanup() {
  // 清理订阅者
  streamHub.unregisterSubscriber(subscriberId);
}
```

**Job 生命周期** (`jobRecovery.js:52-81`):
```javascript
cleanupExpired(nowMs) {
  // 只清理终端状态的 Job，TTL = 24 小时
  if (!isTerminalMcpStatus(job.status)) {
    continue;  // 运行中的 Job 不会被清理
  }
  if (now - terminalAt <= this.jobTtlMs) {
    continue;  // 终端状态也要等 24 小时才清理
  }
}
```

**关键发现**:
- ✅ SSE 连接断开时会清理订阅者
- ❌ **没有检测运行中 Job 的客户端连接状态**
- ❌ **运行中的 Job 永远不会被自动清理**（除非进入终端状态）
- ⚠️ **Job TTL 只针对终端状态**，运行中的 Job 可能永远存在

### 🚨 隐患确认

**僵尸 Job 场景**:
1. L1 提交任务 → L2 创建 Job (status="pending") → L3 开始执行长时间动作
2. L1 突然崩溃或用户关闭窗口
3. SSE 连接断开，订阅者被清理
4. **但 Job 仍在运行中**，锁仍然被持有
5. 后续新任务被阻塞在队列中
6. **直到 L3 完成动作并返回结果**（可能永远不会发生）

**代码证据** (`mcpGateway.js:200-213`):
```javascript
submitUnityTask(body) {
  // ...
  this.lockManager.acquire(job.job_id);  // 获取锁
  startRunningJob(this, job.job_id);     // 启动 Job
  // 没有客户端连接跟踪
}
```

### 💡 建议方案

#### 方案 A: 客户端连接跟踪（推荐）

在 `McpGateway` 中跟踪每个 Job 的客户端连接：

```javascript
class McpGateway {
  constructor(deps) {
    // ...
    this.jobClients = new Map(); // job_id -> Set<clientId>
  }
  
  submitUnityTask(body, clientId) {
    const job = this.jobStore.upsertJob({ ... });
    this.jobClients.set(job.job_id, new Set([clientId]));
    // ...
  }
  
  registerClientForJob(jobId, clientId) {
    // 当客户端查询 Job 状态时，记录连接
    const clients = this.jobClients.get(jobId) || new Set();
    clients.add(clientId);
    this.jobClients.set(jobId, clients);
  }
  
  unregisterClient(clientId) {
    // 客户端断开时，清理所有相关 Job 的客户端记录
    for (const [jobId, clients] of this.jobClients.entries()) {
      clients.delete(clientId);
      if (clients.size === 0) {
        // 没有客户端关注此 Job，检查是否可以取消
        this.maybeCancelOrphanedJob(jobId);
      }
    }
  }
  
  maybeCancelOrphanedJob(jobId) {
    const job = this.jobStore.getJob(jobId);
    if (!job || isTerminalMcpStatus(job.status)) {
      return;
    }
    
    // 如果 Job 运行超过一定时间（如 5 分钟）且没有客户端关注
    const age = Date.now() - job.created_at;
    if (age > 300000) { // 5 分钟
      // 取消僵尸 Job
      finalizeJob(this, jobId, {
        status: "cancelled",
        stage: "cancelled",
        error_code: "E_JOB_ORPHANED",
        error_message: "Job cancelled due to client disconnection",
        suggestion: "Client disconnected. Resubmit task if needed."
      });
      this.lockManager.release(jobId);
      this.promoteNextQueuedJob(this);
    }
  }
}
```

#### 方案 B: 心跳机制

要求客户端定期发送心跳，超时则取消 Job：

```javascript
// 客户端每 30 秒发送一次心跳
// L2 检测到超过 60 秒没有心跳，则取消 Job
```

#### 方案 C: 运行中 Job 的 TTL

为运行中的 Job 也设置 TTL（如 1 小时）：

```javascript
cleanupExpired(nowMs) {
  for (const job of this.jobStore.listJobs()) {
    if (isTerminalMcpStatus(job.status)) {
      // 终端状态：24 小时 TTL
      if (now - job.terminal_at > this.jobTtlMs) {
        this.removeJob(job.job_id);
      }
    } else {
      // 运行中状态：1 小时 TTL
      const runningTtlMs = 60 * 60 * 1000; // 1 小时
      if (now - job.updated_at > runningTtlMs) {
        // 运行超过 1 小时，可能是僵尸 Job
        this.maybeCancelOrphanedJob(job.job_id);
      }
    }
  }
}
```

---

## 4. 错误反馈的"LLM 友好度"

### 🔍 现状分析

**错误反馈格式化** (`mcpErrorFeedback.js:8-35`):
```javascript
function withMcpErrorFeedback(body) {
  const errorCode = normalizeErrorCode(source.error_code, "E_INTERNAL");
  const errorMessage = source.error_message || source.message || "Unknown error";
  const feedback = mapMcpErrorFeedback(errorCode, errorMessage);
  return {
    ...source,
    error_code: errorCode,
    error_message: errorMessage,
    suggestion: feedback.suggestion,  // 从 mapMcpErrorFeedback 获取建议
    recoverable: feedback.recoverable,
  };
}
```

**错误码映射** (`turnUtils.js:1150-1243`):
```javascript
function mapMcpErrorFeedback(errorCode, message) {
  switch (errorCode) {
    case "E_COMPILE_FAILED":
      return {
        recoverable: true,
        suggestion: "Fix compilation errors and retry. Check Unity console for details.",
      };
    case "WAITING_FOR_UNITY_REBOOT":
      return {
        recoverable: true,
        suggestion: "Wait for unity.runtime.ping recovery, then retry the pending visual action.",
      };
    // ... 其他错误码
    default:
      return {
        recoverable: false,
        suggestion: message && message.toLowerCase().includes("timeout")
          ? "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs."
          : "Inspect error_code/error_message, adjust task payload, then retry if safe.",
      };
  }
}
```

**关键发现**:
- ✅ 有基本的错误码到建议的映射
- ⚠️ **Unity 原生错误堆栈没有被清洗**
- ⚠️ **错误消息可能包含大量技术细节**，对 LLM 不友好
- ⚠️ **缺少上下文信息**（如哪个文件出错、哪个组件有问题）

### 🚨 隐患确认

**问题场景**:
1. Unity 返回错误：`NullReferenceException: Object reference not set to an instance of an object at UnityEngine.GameObject.GetComponent[T]() ... (50行堆栈)`
2. L2 直接转发给 L1，LLM 看到：
   - 50 行技术堆栈
   - 缺少上下文（哪个 GameObject、哪个组件）
   - 没有可执行的修复建议

**代码证据** (`unityCallbacks.js:51-85`):
```javascript
function handleUnityActionResult(gateway, body) {
  const payload = body && body.payload;
  // 直接使用 Unity 返回的 error_message，没有清洗
  const errorCode = normalizeErrorCode(payload.error_code, "E_ACTION_EXECUTION_FAILED");
  const summary = buildActionFailureSummary(payload);  // 可能包含堆栈
  // ...
}
```

### 💡 建议方案

#### 方案 A: 错误消息清洗与上下文增强（强烈推荐）

在 `mcpErrorFeedback.js` 中添加错误清洗逻辑：

```javascript
function sanitizeUnityErrorMessage(rawMessage, errorCode, context) {
  // 1. 提取关键信息
  const keyInfo = extractKeyInfo(rawMessage);
  
  // 2. 移除堆栈跟踪
  const cleaned = removeStackTrace(rawMessage);
  
  // 3. 添加上下文
  const contextualized = addContext(cleaned, context);
  
  // 4. 生成 LLM 友好的摘要
  return generateLLMFriendlySummary(keyInfo, contextualized, errorCode);
}

function extractKeyInfo(message) {
  // 提取关键信息：组件名、GameObject 路径、操作类型
  const componentMatch = message.match(/component[:\s]+([A-Za-z0-9_]+)/i);
  const pathMatch = message.match(/path[:\s]+([^\s]+)/i);
  const actionMatch = message.match(/(add|remove|replace|create)/i);
  
  return {
    component: componentMatch ? componentMatch[1] : null,
    path: pathMatch ? pathMatch[1] : null,
    action: actionMatch ? actionMatch[1] : null,
  };
}

function removeStackTrace(message) {
  // 移除堆栈跟踪（通常以 "at " 开头）
  return message.split('\n')
    .filter(line => !line.trim().startsWith('at ') && !line.includes('StackTrace'))
    .join('\n')
    .trim();
}

function addContext(cleaned, context) {
  // 添加上下文信息
  const parts = [cleaned];
  
  if (context.target_object_path) {
    parts.push(`Target: ${context.target_object_path}`);
  }
  if (context.component_name) {
    parts.push(`Component: ${context.component_name}`);
  }
  if (context.action_type) {
    parts.push(`Action: ${context.action_type}`);
  }
  
  return parts.join('. ');
}

function generateLLMFriendlySummary(keyInfo, contextualized, errorCode) {
  // 根据错误码生成友好的摘要
  switch (errorCode) {
    case "E_ACTION_COMPONENT_RESOLVE_FAILED":
      return `Failed to resolve component "${keyInfo.component}" on "${keyInfo.path}". ` +
             `The component may not exist, or the assembly may not be loaded. ` +
             `Suggestion: Verify the component name and ensure the script is compiled.`;
    
    case "E_ACTION_TARGET_NOT_FOUND":
      return `Target GameObject not found at path "${keyInfo.path}". ` +
             `The object may have been deleted or the path is incorrect. ` +
             `Suggestion: Query the scene hierarchy to find the correct path.`;
    
    default:
      return contextualized;
  }
}
```

#### 方案 B: 错误分类与建议模板

为常见 Unity 错误创建分类和建议模板：

```javascript
const ERROR_TEMPLATES = {
  NullReferenceException: {
    summary: "Object reference is null",
    commonCauses: [
      "GameObject was deleted",
      "Component was removed",
      "Scene was unloaded"
    ],
    suggestions: [
      "Query the scene hierarchy to verify the object exists",
      "Check if the component is still attached",
      "Ensure the scene is loaded"
    ]
  },
  MissingComponentException: {
    summary: "Required component is missing",
    commonCauses: [
      "Component was not added",
      "Component script has compilation errors",
      "Component is in a different assembly"
    ],
    suggestions: [
      "Verify the component name and assembly",
      "Check Unity console for compilation errors",
      "Ensure the component script is compiled"
    ]
  },
  // ...
};
```

#### 方案 C: 错误上下文收集

在 L3 收集更多上下文信息：

```csharp
// UnityVisualActionExecutor.cs
public UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected)
{
    try
    {
        // 执行动作
    }
    catch (Exception ex)
    {
        return new UnityActionExecutionResult
        {
            success = false,
            errorCode = MapExceptionToErrorCode(ex),
            errorMessage = ex.Message,
            // 添加上下文
            context = new
            {
                target_path = action.target_object_path,
                component_name = action.component_name,
                action_type = action.type,
                scene_name = SceneManager.GetActiveScene().name,
                object_exists = selected != null,
                component_exists = selected?.GetComponent(action.component_name) != null
            }
        };
    }
}
```

---

## 📋 总结与优先级建议

### 高优先级（必须修复）

1. **域重载死锁风险** - 可能导致系统完全阻塞
   - 实现超时检测机制（方案 A）
   - 添加手动恢复接口（方案 C）

2. **僵尸 Job 问题** - 可能导致队列永久阻塞
   - 实现客户端连接跟踪（方案 A）
   - 为运行中 Job 添加 TTL（方案 C）

### 中优先级（建议修复）

3. **读写并发冲突** - 可能导致脏数据
   - 在快照中添加编译状态标记（方案 A）
   - 维护稳定快照缓存（方案 C）

4. **错误反馈 LLM 友好度** - 影响自我纠错能力
   - 实现错误消息清洗（方案 A）
   - 添加错误分类模板（方案 B）

### 实施建议

1. **立即实施**: 域重载超时检测 + 僵尸 Job 清理
2. **短期实施**: 错误消息清洗 + 快照状态标记
3. **长期优化**: 完整的客户端连接跟踪 + 错误分类系统

---

**报告结束**
