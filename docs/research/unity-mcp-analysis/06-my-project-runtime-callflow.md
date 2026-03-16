# Unity MCP 运行时调用链分析

本文档基于 UnityAI 本地工程源码，深入分析从用户请求到 Unity Editor 实际操作的完整调用链，以及为什么这个项目会显得"丝滑"。

## 1. 执行摘要

UnityAI 项目采用**三层架构 + SSOT 统一契约**的设计，通过以下机制实现平滑体验：

1. **MCP Server 作为统一入口**：所有工具调用都通过 MCP Protocol (JSON-RPC over STDIO) 进入
2. **Sidecar 作为编排层**：Node.js sidecar 负责路由、校验、编排、错误反馈和状态管理
3. **Unity Editor 作为执行层**：C# 执行器通过轮询机制被动接收任务，保持"薄执行层"
4. **SSOT 统一契约**：工具定义、Schema、DTO 都从单一字典生成，保证 L2/L3 一致性
5. **Workflow 模板机制**：通过 intent_key 匹配预定义工作流，减少模型查询负担
6. **Token 自动化管理**：自动生成、验证、刷新 read token，自动处理 scene revision drift
7. **批量事务合并**：多个写操作自动合并为单个事务，减少往返次数

**关键发现**：这个项目**没有显式的 Planner**，而是通过以下机制替代 Planner 的作用：
- **厚工具封装**：高层工具（如 `planner_execute_mcp`）封装了多步骤逻辑
- **Workflow 模板**：通过 intent_key 匹配预定义的多步骤工作流模板
- **批量合并**：通过 `execute_unity_transaction` 将多个写操作合并为单个事务
- **默认工作流**：脚本创建/编译/挂载等常见场景有预定义的三步工作流
- **上下文资源**：通过 read token 和 scene snapshot 提供上下文，减少模型查询

## 2. 请求进入 MCP 后的完整链路

### 2.1 MCP Server 入口 (`sidecar/src/mcp/mcpServer.js`)

**入口点**：`UnityMcpServer.handleMessage()` -> `processRequest()` -> `callTool()`

```javascript
// 关键代码路径：
// 1. STDIO 接收 JSON-RPC 消息
rl.on("line", (line) => {
  const message = JSON.parse(line);
  this.handleMessage(message);
});

// 2. 工具调用入口
async callTool(params) {
  const { name, arguments: args } = params || {};
  // 入口治理检查（entry governance）
  let entryGovernanceDecision = this.evaluateEntryGovernanceDecision(normalizedName);
  // 分发到 commandRegistry
  dispatchResult = await this.getCommandRegistry().dispatchMcpTool({
    name: normalizedName,
    args: args,
    server: this,
  });
}
```

**关键机制**：
- **Entry Governance**：检查工具是否允许直接调用（Phase6 后只允许 `planner_execute_mcp` 和 control/support-plane 工具）
- **Visibility Policy**：根据工具生命周期（active/deprecated/removed）决定是否暴露
- **Direct Compatibility**：检查工具是否应该通过 planner entry 调用

### 2.2 Transport 层 (`sidecar/src/mcp/commandRegistry.js`)

**关键方法**：`dispatchMcpTool()`

```javascript
async dispatchMcpTool(params) {
  const command = this.getCommandByName(p.name);
  const httpConfig = command.http;
  const url = new URL(`${server.sidecarBaseUrl}${path}`);
  
  // 将 MCP 工具调用转换为 HTTP 请求
  if (method === "GET") {
    response = await server.httpRequest("GET", url);
  } else {
    response = await server.httpRequest(method, url, args);
  }
  
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**关键发现**：
- MCP Server **不直接执行业务逻辑**，而是将工具调用转换为 HTTP 请求到 sidecar
- 这种设计使得 MCP Server 保持"薄"，所有业务逻辑都在 sidecar 的 HTTP API 层

### 2.3 Tool 注册方式 (`sidecar/src/mcp/commands/`)

**注册机制**：
1. **命令定义**：在 `commandDefinitionManifest.js` 中定义工具元数据
2. **分发模式**：支持两种模式
   - `ssot_query`：通过 SSOT runtime 分发到 Unity
   - `local_static`：在 sidecar 本地执行（如 `get_tool_schema`、`get_write_contract_bundle`）

```javascript
// 示例：命令定义结构
{
  name: "planner_execute_mcp",
  dispatch_mode: "ssot_query",  // 或 "local_static"
  http: {
    method: "POST",
    path: "/mcp/planner/execute",
    source: "body"
  },
  mcp: {
    expose: true,
    description: "...",
    inputSchema: { ... }
  },
  validate: (payload) => { ... }
}
```

**关键发现**：
- 工具注册**完全基于配置**，不需要手写 HTTP 路由
- Schema 校验通过 SSOT 生成的 JSON Schema 自动完成
- 工具定义、Schema、DTO 都从 `ssot/dictionary/tools.json` 生成，保证一致性

### 2.4 Sidecar HTTP 路由 (`sidecar/src/api/router.js`)

**关键方法**：`createRouter()`

```javascript
async function route(req, res) {
  // 1. 先尝试通过 commandRegistry 分发
  const commandOutcome = await commandRegistry.dispatchHttpCommand({
    method,
    path: url.pathname,
    turnService,
    ...
  });
  
  // 2. Unity 回调端点（Unity -> Sidecar）
  if (method === "POST" && url.pathname === "/unity/query/pull") {
    const outcome = turnService.pullUnityQuery(body);
    sendJson(res, outcome.statusCode, outcome.body);
  }
  
  if (method === "POST" && url.pathname === "/unity/query/report") {
    const outcome = turnService.reportUnityQuery(body);
    sendJson(res, outcome.statusCode, outcome.body);
  }
}
```

**关键发现**：
- HTTP 路由**统一通过 commandRegistry 分发**，保持一致性
- Unity 回调端点（`/unity/query/pull`、`/unity/query/report`）直接调用 `turnService` 方法

## 3. 单工具调用链

### 3.1 完整调用路径

```
Cursor/LLM (L1)
  ↓ JSON-RPC tools/call
MCP Server (mcpServer.js)
  ↓ dispatchMcpTool
Command Registry (commandRegistry.js)
  ↓ HTTP POST /mcp/{tool_name}
Sidecar Router (router.js)
  ↓ dispatchHttpCommand
Turn Service (turnService.js)
  ↓ dispatchSsotToolForMcp (如果是 ssot_query)
SSOT Runtime (dispatchSsotRequest.js)
  ↓ buildSsotQueryPayload + enqueueAndWaitForUnityQuery
Query Coordinator (queryCoordinator.js)
  ↓ 将查询加入队列，等待 Unity 轮询
Unity Editor (UnityRagQueryPollingBootstrap.cs)
  ↓ PollRagQueriesAsync (每 0.6 秒)
Unity Query Registry (UnityQueryRegistry.cs)
  ↓ DispatchAsync
SSOT Executor (具体 Executor，如 CaptureSceneScreenshotSsotExecutor.cs)
  ↓ Execute
Unity Editor API (实际执行)
  ↓ 返回结果
HTTP POST /unity/query/report
  ↓
Turn Service (更新任务状态)
  ↓
返回结果给 MCP Server
  ↓
返回给 Cursor/LLM
```

### 3.2 关键代码位置

**Sidecar 侧**：
- `sidecar/src/application/turnService.js:dispatchSsotToolForMcp()`：分发 SSOT 工具调用
- `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js:dispatchSsotRequest()`：执行 SSOT 请求，包含 token 验证和自动恢复
- `sidecar/src/application/queryCoordinator.js`：管理查询队列，等待 Unity 轮询

**Unity 侧**：
- `Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs:PollRagQueriesCoreAsync()`：每 0.6 秒轮询一次
- `Assets/Editor/Codex/Application/Conversation/ConversationController.QueryRuntimeCoordinator.cs:TryHandlePulledReadQueryAsync()`：处理拉取的查询
- `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs:DispatchAsync()`：分发查询到对应的 handler

### 3.3 为什么单工具调用"丝滑"

1. **轮询机制减少连接开销**：Unity 主动轮询，不需要保持长连接
2. **查询队列缓冲**：sidecar 将查询加入队列，Unity 按自己的节奏处理
3. **Token 自动管理**：read token 自动生成和验证，用户无需关心
4. **错误自动恢复**：检测到 scene revision drift 时自动刷新 token 并重试

## 4. batch_execute 调用链（事务合并）

### 4.1 事务合并机制

**关键工具**：`execute_unity_transaction`

**实现位置**：
- `sidecar/src/application/turnService.js:synthesizeTransactionDispatchBlock()`
- `sidecar/src/application/ssotRuntime/transactionPolicyGuard.js:guardExecuteUnityTransactionSteps()`

**合并逻辑**：

```javascript
// 1. 检测到多个写操作时，自动合并为事务
function synthesizeTransactionDispatchBlock({ blockSpec, executionContext }) {
  const context = isPlainObject(executionContext) ? executionContext : {};
  const blockPlan = context.block_plan;
  
  // 2. 提取所有写操作块
  const writeBlockOutcome = extractTransactionWriteBlocks(blockPlan);
  const writeBlocks = writeBlockOutcome.write_blocks;
  
  // 3. 构建统一的事务 write_envelope
  const writeEnvelopeOutcome = buildTransactionWriteEnvelope(writeBlocks, transactionId);
  
  // 4. 将多个写操作块转换为事务步骤
  const transactionSteps = [];
  for (const writeBlock of writeBlocks) {
    const stepOutcome = mapWriteBlockToTransactionStep(writeBlock);
    transactionSteps.push(stepOutcome.step);
  }
  
  // 5. 调用 execute_unity_transaction
  return {
    block_spec: {
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.transaction.execute",
      input: {
        steps: transactionSteps,
        ...
      }
    }
  };
}
```

### 4.2 事务执行流程

```
Planner Block (多个写操作)
  ↓ Shape Decider 检测到 "transaction" shape
Turn Service (synthesizeTransactionDispatchBlock)
  ↓ 合并为单个 execute_unity_transaction 调用
SSOT Runtime (dispatchSsotRequest)
  ↓ 发送到 Unity
Unity Executor (ExecuteUnityTransactionSsotExecutor.cs)
  ↓ 按顺序执行所有步骤
Unity Editor API (批量执行)
  ↓ 返回统一结果
```

### 4.3 为什么批量执行"丝滑"

1. **自动合并**：多个写操作自动合并为单个事务，减少往返次数
2. **原子性保证**：事务要么全部成功，要么全部失败，避免中间状态
3. **统一错误处理**：事务失败时返回统一的错误信息，便于模型理解

## 5. 脚本创建/编译/挂载链路

### 5.1 Workflow 模板机制

**关键 Intent Key**：`workflow.script.create_compile_attach`

**实现位置**：
- `sidecar/src/application/turnService.js:synthesizeWorkflowDispatch()`
- `sidecar/src/application/turnService.js:executeWorkflowTemplateDispatch()`

**工作流模板定义**（在 contracts 中）：

```javascript
{
  workflow_templates: {
    "script_create_compile_attach": {
      enabled: true,
      selection: {
        intent_keys: ["workflow.script.create_compile_attach"]
      },
      steps: [
        {
          step_id: "ensure_target",
          step_type: "ensure_target",
          tool_name: "create_object",
          ensure_target_contract: { ... }
        },
        {
          step_id: "submit_file",
          step_type: "submit_task",
          tool_name: "submit_unity_task",
          task_payload_slot: "file_actions"
        },
        {
          step_id: "wait_compile",
          step_type: "wait_task_status",
          tool_name: "get_unity_task_status",
          poll_interval_ms: 1200,
          timeout_ms: 180000,
          success_statuses: ["compile_success"],
          failure_statuses: ["compile_failed", "cancelled"]
        },
        {
          step_id: "submit_attach",
          step_type: "submit_task",
          tool_name: "submit_unity_task",
          task_payload_slot: "visual_layer_actions"
        },
        {
          step_id: "wait_attach",
          step_type: "wait_task_status",
          tool_name: "get_unity_task_status",
          ...
        }
      ]
    }
  }
}
```

### 5.2 完整执行流程

```
用户请求（intent_key: "workflow.script.create_compile_attach"）
  ↓
Turn Service (synthesizeWorkflowDispatch)
  ↓ 匹配到 workflow 模板
Turn Service (executeWorkflowTemplateDispatch)
  ↓
Step 1: ensure_target
  ↓ executeEnsureTargetStep
  ↓ 创建 GameObject（如果不存在）
  ↓ 返回 resolved_target_id
Step 2: submit_file
  ↓ 构建 file_actions（创建脚本文件）
  ↓ submit_unity_task (file_actions)
  ↓ 返回 job_id
Step 3: wait_compile
  ↓ 轮询 get_unity_task_status (job_id)
  ↓ 等待编译完成（最多 180 秒）
  ↓ 检查编译结果
Step 4: submit_attach
  ↓ 构建 visual_layer_actions（添加组件）
  ↓ 使用 resolved_target_id 绑定目标
  ↓ submit_unity_task (visual_layer_actions)
Step 5: wait_attach
  ↓ 轮询 get_unity_task_status
  ↓ 等待挂载完成
  ↓
返回完整结果（包含所有步骤的状态）
```

### 5.3 关键代码位置

**Ensure Target Step**：
- `sidecar/src/application/workflow/ensureTargetStepAdapter.js:executeEnsureTargetStep()`
- 创建 GameObject，处理名称冲突（fail/reuse/suffix 策略）

**Workflow Execution**：
- `sidecar/src/application/turnService.js:executeWorkflowTemplateDispatch()`
- 按顺序执行所有步骤，处理错误和超时

**Unity Task Runtime**：
- `Assets/Editor/Codex/Infrastructure/Ssot/Executors/UnityTaskSsotExecutors.cs:UnityTaskRuntime`
- 管理任务状态，跟踪编译进度

### 5.4 为什么脚本创建"丝滑"

1. **预定义工作流**：常见场景（创建脚本+编译+挂载）有预定义的三步工作流，模型只需调用一次
2. **自动等待编译**：工作流自动等待 Unity 编译完成，无需模型多次查询
3. **目标自动解析**：`ensure_target` 步骤自动创建或复用 GameObject，减少模型查询
4. **错误自动分类**：编译失败、类名不匹配、组件不可挂载等错误自动分类，便于模型理解

## 6. 读取/截图/层级链路

### 6.1 读取类工具调用链

**示例工具**：`capture_scene_screenshot`、`get_hierarchy_subtree`、`get_ui_tree`

**调用路径**：

```
MCP tools/call (capture_scene_screenshot)
  ↓
Sidecar (dispatchSsotToolForMcp)
  ↓
SSOT Runtime (dispatchSsotRequest)
  ↓ 构建查询 payload
Query Coordinator (enqueueAndWaitForUnityQuery)
  ↓ 加入查询队列
Unity Polling (PollRagQueriesAsync)
  ↓ 拉取查询
Unity Query Registry (DispatchAsync)
  ↓ 根据 query_type 分发
SSOT Executor (CaptureSceneScreenshotSsotExecutor.cs)
  ↓ Execute
Unity Editor API (ScreenCapture.CaptureScreenshot)
  ↓ 返回结果
HTTP POST /unity/query/report
  ↓
返回给 MCP Server
```

### 6.2 截图实现细节

**Unity 侧实现**：
- `Assets/Editor/Codex/Infrastructure/Ssot/Executors/CaptureSceneScreenshotSsotExecutor.cs`
- `Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`

**关键代码**：

```csharp
public SsotDispatchResponse Execute(CaptureSceneScreenshotRequestDto request) {
    // 1. 验证请求参数
    // 2. 调用 Unity Editor API
    var screenshot = ScreenshotReadService.CaptureSceneScreenshot(
        request.width,
        request.height,
        request.camera_path
    );
    // 3. 返回 base64 编码的图片
    return SsotRequestDispatcher.Success(
        CaptureSceneScreenshotRequestDto.ToolName,
        new { image_base64 = screenshot }
    );
}
```

### 6.3 层级查询实现

**工具**：`get_hierarchy_subtree`、`get_scene_roots`

**Unity 侧实现**：
- `Assets/Editor/Codex/Infrastructure/Read/UnityRagReadService.cs`
- 通过 Unity Editor API (`GameObject.Find`、`Transform.GetChild`) 遍历层级

**关键机制**：
- **深度限制**：避免返回过大的层级树
- **索引优化**：只返回必要的对象信息（name、path、components）
- **缓存机制**：相同查询可以复用缓存结果

### 6.4 为什么读取类工具"丝滑"

1. **轮询机制**：Unity 主动轮询，不需要保持连接
2. **查询队列缓冲**：sidecar 将查询加入队列，Unity 按自己的节奏处理
3. **结果缓存**：相同查询可以复用缓存，减少重复计算
4. **统一错误处理**：所有读取错误都通过统一的错误码返回

## 7. 平滑体验的关键实现点

### 7.1 Token 自动化管理

**实现位置**：
- `sidecar/src/application/ssotRuntime/tokenLifecycleOrchestrator.js`
- `sidecar/src/application/ssotRuntime/tokenDriftRecoveryCoordinator.js`

**关键机制**：

1. **自动生成 Read Token**：
   ```javascript
   // 读取操作自动生成 read_token_candidate
   maybeIssueReadTokenFromResponse({
     toolName: "get_scene_snapshot_for_write",
     result: unityResult,
     ...
   });
   ```

2. **自动验证 Write Token**：
   ```javascript
   // 写操作前自动验证 based_on_read_token
   const preDispatchValidation = tokenLifecycleOrchestrator.validateBeforeDispatch({
     toolName: "execute_unity_transaction",
     payload: { based_on_read_token: "..." }
   });
   ```

3. **自动恢复 Scene Revision Drift**：
   ```javascript
   // 检测到 E_SCENE_REVISION_DRIFT 时自动刷新 token 并重试
   if (initialErrorCode === "E_SCENE_REVISION_DRIFT") {
     return tryAutoRecoverFromDrift({
       // 1. 刷新 scene snapshot
       // 2. 获取新的 read_token
       // 3. 重试原请求
     });
   }
   ```

**为什么"丝滑"**：
- 用户无需手动管理 token，系统自动处理
- 检测到 scene revision drift 时自动恢复，减少失败率
- Token 自动过期和刷新，保证数据一致性

### 7.2 Workflow 模板匹配

**实现位置**：
- `sidecar/src/application/turnService.js:synthesizeWorkflowDispatch()`

**关键机制**：

```javascript
function synthesizeWorkflowDispatch({ blockSpec, executionContext, orchestrationContract }) {
  const intentKey = blockSpec.intent_key;
  const workflowTemplates = orchestrationContract.workflow_templates;
  
  // 根据 intent_key 匹配 workflow 模板
  for (const [templateId, templateDef] of Object.entries(workflowTemplates)) {
    const intentKeys = templateDef.selection.intent_keys;
    if (intentKeys.includes(intentKey)) {
      // 返回匹配的模板
      return {
        applied: true,
        workflow_template_id: templateId,
        template: templateDef
      };
    }
  }
}
```

**为什么"丝滑"**：
- 模型只需提供 `intent_key`，系统自动匹配预定义工作流
- 减少模型需要理解的步骤数量
- 常见场景（脚本创建、组件挂载）有预定义工作流，减少查询负担

### 7.3 批量事务合并

**实现位置**：
- `sidecar/src/application/turnService.js:synthesizeTransactionDispatchBlock()`
- `sidecar/src/application/ssotRuntime/transactionPolicyGuard.js`

**关键机制**：

```javascript
// 检测到多个写操作时，自动合并为事务
if (context.shape === "transaction") {
  const writeBlocks = extractTransactionWriteBlocks(blockPlan);
  const transactionSteps = writeBlocks.map(block => 
    mapWriteBlockToTransactionStep(block)
  );
  
  return {
    block_spec: {
      intent_key: "write.transaction.execute",
      input: { steps: transactionSteps }
    }
  };
}
```

**为什么"丝滑"**：
- 多个写操作自动合并为单个事务，减少往返次数
- 事务原子性保证，避免中间状态
- 统一错误处理，便于模型理解

### 7.4 错误反馈和恢复建议

**实现位置**：
- `sidecar/src/application/errorFeedback/mcpErrorFeedback.js`
- `sidecar/src/application/errorFeedback/recoveryPlanner.js`

**关键机制**：

```javascript
// 错误反馈模板
const errorFeedbackTemplates = {
  "E_SCENE_REVISION_DRIFT": {
    error_code: "E_SCENE_REVISION_DRIFT",
    suggestion: "Call get_scene_snapshot_for_write to refresh the scene snapshot",
    recovery_steps: [
      { tool_name: "get_scene_snapshot_for_write", ... }
    ]
  }
};

// 自动生成恢复建议
function buildRecoveryGuidance(errorCode, context) {
  const template = errorFeedbackTemplates[errorCode];
  return {
    error_code: errorCode,
    suggestion: template.suggestion,
    recovery_steps: template.recovery_steps
  };
}
```

**为什么"丝滑"**：
- 错误自动分类，提供明确的恢复建议
- 模型可以根据建议自动重试，减少人工干预
- 统一的错误格式，便于模型理解

### 7.5 Unity 侧"薄执行层"

**关键设计**：
- Unity 侧**不维护复杂状态**，只负责执行和报告结果
- 所有状态管理都在 sidecar 侧
- Unity 通过轮询机制被动接收任务，保持简单

**为什么"丝滑"**：
- Unity 侧代码简单，易于维护
- 状态集中在 sidecar，便于调试和恢复
- 轮询机制减少连接开销，提高稳定性

## 8. 对 Planner 缺席的替代机制分析

### 8.1 为什么没有显式 Planner

通过源码分析，这个项目**没有显式的 Planner 组件**，而是通过以下机制替代 Planner 的作用：

### 8.2 替代机制 1：厚工具封装

**实现**：高层工具（如 `planner_execute_mcp`）封装了多步骤逻辑

**示例**：
- `planner_execute_mcp` 工具接收 `block_spec`，内部处理：
  - Block 路由（Router）
  - Shape 决策（Shape Decider）
  - 执行适配（Execution Adapter）
  - 错误恢复（Recovery Hook）

**为什么有效**：
- 模型只需调用一个工具，内部自动处理多步骤逻辑
- 减少模型的查询负担
- 保持工具接口简单

### 8.3 替代机制 2：Workflow 模板

**实现**：通过 `intent_key` 匹配预定义的多步骤工作流模板

**示例**：
- `workflow.script.create_compile_attach` intent_key 匹配到预定义的三步工作流
- 工作流自动执行：创建对象 -> 提交脚本 -> 等待编译 -> 提交挂载 -> 等待完成

**为什么有效**：
- 常见场景有预定义工作流，模型只需提供 `intent_key`
- 减少模型需要理解的步骤数量
- 工作流可以复用，减少重复代码

### 8.4 替代机制 3：批量合并

**实现**：通过 `execute_unity_transaction` 将多个写操作合并为单个事务

**示例**：
- 模型提供多个写操作块（block_plan）
- Shape Decider 检测到 "transaction" shape
- 自动合并为单个 `execute_unity_transaction` 调用

**为什么有效**：
- 减少往返次数，提高效率
- 事务原子性保证，避免中间状态
- 统一错误处理，便于模型理解

### 8.5 替代机制 4：默认工作流

**实现**：脚本创建/编译/挂载等常见场景有预定义的三步工作流

**示例**：
- `workflow.script.create_compile_attach` 工作流自动处理：
  1. 创建 GameObject（如果不存在）
  2. 创建脚本文件并等待编译
  3. 添加组件并等待完成

**为什么有效**：
- 常见场景无需模型多次查询
- 工作流自动处理等待和错误恢复
- 减少模型的查询负担

### 8.6 替代机制 5：上下文资源

**实现**：通过 read token 和 scene snapshot 提供上下文

**示例**：
- `get_scene_snapshot_for_write` 工具返回完整的 scene snapshot 和 read_token
- 后续写操作使用 `based_on_read_token` 引用这个 snapshot
- 系统自动验证 token 有效性，检测到 drift 时自动恢复

**为什么有效**：
- 模型只需调用一次 snapshot 工具，后续操作自动引用
- Token 自动管理，减少模型负担
- 自动检测和恢复 scene revision drift

### 8.7 替代机制 6：错误反馈和恢复建议

**实现**：错误自动分类，提供明确的恢复建议

**示例**：
- `E_SCENE_REVISION_DRIFT` 错误自动提供恢复建议：调用 `get_scene_snapshot_for_write`
- 模型可以根据建议自动重试

**为什么有效**：
- 减少模型需要理解的错误类型
- 提供明确的恢复路径
- 便于模型自动重试

### 8.8 总结：为什么这些机制有效

1. **减少模型查询负担**：通过厚工具、工作流模板、批量合并，减少模型需要调用的工具数量
2. **自动化常见场景**：脚本创建、组件挂载等常见场景有预定义工作流，无需模型多次查询
3. **统一错误处理**：错误自动分类和恢复建议，便于模型理解和重试
4. **状态自动管理**：Token 自动生成和验证，scene revision drift 自动恢复
5. **保持接口简单**：虽然内部复杂，但对外接口简单，模型易于理解

## 9. 结论

### 9.1 核心设计理念

UnityAI 项目的核心设计理念是**"厚中间层，薄执行层"**：

1. **Sidecar 作为厚中间层**：
   - 负责路由、校验、编排、错误反馈
   - 维护状态（token、task、query queue）
   - 提供高层工具和工作流模板

2. **Unity Editor 作为薄执行层**：
   - 只负责执行和报告结果
   - 不维护复杂状态
   - 通过轮询机制被动接收任务

3. **SSOT 统一契约**：
   - 工具定义、Schema、DTO 都从单一字典生成
   - 保证 L2/L3 一致性
   - 减少手动同步的负担

### 9.2 为什么"丝滑"

1. **自动化机制**：
   - Token 自动生成和验证
   - Scene revision drift 自动恢复
   - 工作流模板自动匹配和执行

2. **减少查询负担**：
   - 厚工具封装多步骤逻辑
   - 批量合并减少往返次数
   - 预定义工作流减少模型查询

3. **统一错误处理**：
   - 错误自动分类
   - 提供明确的恢复建议
   - 便于模型自动重试

4. **状态集中管理**：
   - 所有状态在 sidecar 侧
   - Unity 侧保持简单
   - 便于调试和恢复

### 9.3 对 Planner 的替代

虽然没有显式的 Planner，但通过以下机制有效替代了 Planner 的作用：

1. **厚工具**：高层工具封装多步骤逻辑
2. **工作流模板**：通过 intent_key 匹配预定义工作流
3. **批量合并**：多个写操作自动合并为事务
4. **默认工作流**：常见场景有预定义工作流
5. **上下文资源**：read token 和 scene snapshot 提供上下文
6. **错误反馈**：错误自动分类和恢复建议

这些机制的组合使得系统在**没有显式 Planner 的情况下**，仍然能够提供平滑的用户体验。

### 9.4 源码证据总结

本文档中的所有分析都基于实际源码，关键文件位置：

- **MCP Server**：`sidecar/src/mcp/mcpServer.js`
- **Transport**：`sidecar/src/mcp/commandRegistry.js:dispatchMcpTool()`
- **Tool 注册**：`sidecar/src/mcp/commands/commandDefinitionManifest.js`
- **Sidecar 路由**：`sidecar/src/api/router.js`
- **Turn Service**：`sidecar/src/application/turnService.js`
- **SSOT Runtime**：`sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`
- **Workflow**：`sidecar/src/application/turnService.js:synthesizeWorkflowDispatch()`
- **Unity 轮询**：`Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs`
- **Unity 查询分发**：`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs`
- **Unity 执行器**：`Assets/Editor/Codex/Infrastructure/Ssot/Executors/`

所有关键机制都有明确的源码实现，本文档的分析完全基于这些实际代码。
