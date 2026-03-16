# Unity MCP 运行时调用链分析

**版本：** v1.0  
**分析日期：** 2026-03-06  
**分析范围：** 真实调用链和执行方式深挖  
**项目版本：** Server v9.5.3, Unity Package v9.5.4-beta.3

---

## 1. 执行摘要

本文档深入分析 Unity MCP 项目的**真实运行时调用链**，揭示其如何将用户请求转换为 Unity Editor 实际操作，以及为什么它显得"丝滑"。

**核心发现：**

1. **无显式 Planner**：项目没有独立的规划层，而是通过**厚工具设计**、**批量执行**、**上下文资源**和**智能容错**来替代 Planner 的部分作用。

2. **双进程解耦架构**：Python MCP Server（外部进程）与 Unity Editor Plugin（Unity 内）通过 WebSocket 通信，完全解耦。

3. **主线程调度器**：Unity 侧通过 `TransportCommandDispatcher` 确保所有 Unity API 调用在主线程执行，保证线程安全。

4. **批量执行优化**：`batch_execute` 工具实现 10-100x 性能提升，通过单次往返执行多个命令。

5. **智能容错机制**：
   - Domain reload 期间自动等待重连（最多 20s）
   - 编译状态检查（`preflight`）
   - 快速失败机制（关键命令 2s 超时）
   - 连接存活检查（ping/pong）

6. **资源层设计**：通过只读资源（如 `editor_state`）提供编辑器状态查询，减少工具调用次数。

---

## 2. 请求进入 MCP 后的完整链路

### 2.1 整体架构流程

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP Client (Cursor/Claude Code/VS Code)                          │
│  └─> JSON-RPC 2.0 请求 (HTTP POST /mcp 或 stdio)                │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ FastMCP Server (Python, main.py)                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 1. FastMCP 接收请求                                        │ │
│  │ 2. Tool Registry 查找工具 (装饰器自动注册)                  │ │
│  │ 3. Unity Instance Middleware 解析 unity_instance           │ │
│  │    - Name@hash / hash / port                               │ │
│  │    - 注入到 ctx.state["unity_instance"]                    │ │
│  └──────────────┬─────────────────────────────────────────────┘ │
│                 │                                                │
│  ┌──────────────▼─────────────────────────────────────────────┐ │
│  │ Tool Handler (services/tools/*.py)                        │ │
│  │  - preflight() 检查编译状态（可选）                        │ │
│  │  - 参数规范化（coerce_int, coerce_bool, normalize_vector3）│ │
│  │  - send_with_unity_instance() 路由到 Unity                 │ │
│  └──────────────┬─────────────────────────────────────────────┘ │
└─────────────────┼───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│ Unity Transport Layer (transport/unity_transport.py)           │
│  └─> PluginHub.send_command_for_instance()                      │
│      - _resolve_session_id() (可能等待重连，最多 20s)          │
│      - _ensure_live_connection() (连接存活检查)                 │
│      - send_command() (WebSocket 发送)                         │
└─────────────────┼───────────────────────────────────────────────┘
                  │ WebSocket (ws://localhost:8080/hub/plugin)
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│ Unity Bridge (WebSocketTransportClient.cs)                      │
│  └─> 接收 WebSocket 消息                                        │
│      - HandleExecuteCommand()                                   │
│      - TransportCommandDispatcher.ExecuteCommandJsonAsync()      │
└─────────────────┼───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│ Transport Command Dispatcher (TransportCommandDispatcher.cs)     │
│  └─> RequestMainThreadPump() (唤醒主线程)                       │
│      └─> ProcessQueue() (EditorApplication.update 回调)         │
│          └─> CommandRegistry.ExecuteCommand()                   │
└─────────────────┼───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│ Unity Tool Handler (Tools/*.cs)                                  │
│  └─> HandleCommand() 方法                                       │
│      └─> Unity Editor API 调用                                  │
└─────────────────┼───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│ 响应返回                                                         │
│  └─> WebSocket 回传 → Plugin Hub → FastMCP → MCP Client         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键代码路径

**Server 端入口：**
```python
# Server/src/main.py:362-367
def create_mcp_server(project_scoped_tools: bool) -> FastMCP:
    mcp = FastMCP(
        name="mcp-for-unity-server",
        lifespan=server_lifespan,
        instructions=_build_instructions(project_scoped_tools),
    )
```

**工具注册机制：**
```python
# Server/src/services/registry/tool_registry.py:31-60
@mcp_for_unity_tool(
    name="batch_execute",
    description="...",
    group="core",  # 工具分组
)
async def batch_execute(ctx: Context, ...):
    # 工具实现
```

**Unity 实例路由：**
```python
# Server/src/transport/unity_transport.py:42-99
async def send_with_unity_instance(
    send_fn: Callable[..., Awaitable[T]],
    unity_instance: str | None,
    *args,
    user_id: str | None = None,
    **kwargs,
) -> T:
    # HTTP 传输：通过 PluginHub 发送
    # Stdio 传输：通过连接池发送
```

---

## 3. 单工具调用链

### 3.1 完整调用链（以 `manage_gameobject` 为例）

```
1. MCP Client 调用 manage_gameobject
   └─> { "action": "create", "name": "Cube", "position": [0, 0, 0] }
       │
2. FastMCP Server (main.py)
   └─> FastMCP 路由到 @mcp_for_unity_tool("manage_gameobject")
       └─> services/tools/manage_gameobject.py:54
           │
3. Tool Handler 预处理
   ├─> get_unity_instance_from_context(ctx)  # 获取 Unity 实例
   ├─> preflight(ctx, wait_for_no_compile=True, refresh_if_dirty=True)
   │   └─> 检查 editor_state，等待编译完成（最多 30s）
   ├─> normalize_vector3(position, "position")  # 参数规范化
   └─> send_with_unity_instance(async_send_command_with_retry, ...)
       │
4. Unity Transport Layer (unity_transport.py:42)
   └─> PluginHub.send_command_for_instance(
           unity_instance,
           "manage_gameobject",
           params
       )
       │
5. Plugin Hub (plugin_hub.py:961)
   ├─> _resolve_session_id(unity_instance, ...)
   │   └─> 等待 Unity 连接（最多 20s，domain reload 期间）
   ├─> _ensure_live_connection(session_id)
   │   └─> 检查 WebSocket 连接状态
   └─> send_command(session_id, "manage_gameobject", params)
       └─> WebSocket 发送 ExecuteCommandMessage
           │
6. Unity Bridge (WebSocketTransportClient.cs:600)
   └─> HandleExecuteCommand(payload)
       └─> TransportCommandDispatcher.ExecuteCommandJsonAsync(
               commandEnvelope.ToString(Formatting.None),
               timeoutCts.Token
           )
           │
7. Transport Command Dispatcher (TransportCommandDispatcher.cs:90)
   ├─> RequestMainThreadPump()  # 唤醒主线程
   │   └─> EditorApplication.QueuePlayerLoopUpdate()
   └─> ProcessQueue()  # EditorApplication.update 回调
       └─> ProcessCommand(id, pending)
           └─> CommandRegistry.ExecuteCommand("manage_gameobject", params, tcs)
               │
8. Command Registry (CommandRegistry.cs:221)
   └─> 查找 HandlerInfo（反射发现）
       └─> ExecuteCommand() 或 ExecuteAsyncHandler()
           │
9. Unity Tool Handler (Tools/GameObjects/ManageGameObject.cs)
   └─> HandleCommand(JObject @params)
       └─> GameObject.CreatePrimitive(PrimitiveType.Cube)
           └─> Unity Editor API 调用
               │
10. 响应返回
    └─> SuccessResponse / ErrorResponse
        └─> WebSocket 回传 → Plugin Hub → FastMCP → MCP Client
```

### 3.2 关键实现细节

**主线程调度器（源码证据）：**
```csharp
// MCPForUnity/Editor/Services/Transport/TransportCommandDispatcher.cs:90-119
public static Task<string> ExecuteCommandJsonAsync(string commandJson, CancellationToken cancellationToken)
{
    // 创建 PendingCommand，加入队列
    var pending = new PendingCommand(commandJson, tcs, cancellationToken, registration);
    lock (PendingLock)
    {
        Pending[id] = pending;
    }
    
    // 主动唤醒主线程（关键！）
    RequestMainThreadPump();
    return tcs.Task;
}

private static void RequestMainThreadPump()
{
    // 提示 Unity 运行一次循环迭代
    EditorApplication.QueuePlayerLoopUpdate();
    ProcessQueue();
}
```

**编译状态检查（源码证据）：**
```python
# Server/src/services/tools/preflight.py:27-110
async def preflight(
    ctx,
    *,
    wait_for_no_compile: bool = False,
    refresh_if_dirty: bool = False,
    max_wait_s: float = 30.0,
) -> MCPResponse | None:
    # 加载编辑器状态
    state_resp = await get_editor_state(ctx)
    
    # 等待编译完成（最多 30s）
    if wait_for_no_compile:
        deadline = time.monotonic() + float(max_wait_s)
        while True:
            compilation = data.get("compilation")
            is_compiling = compilation.get("is_compiling") is True
            if not is_compiling:
                break
            if time.monotonic() >= deadline:
                return _busy("compiling", 500)
            await asyncio.sleep(0.25)
```

---

## 4. batch_execute 调用链

### 4.1 批处理执行链路

```
1. MCP Client 调用 batch_execute
   └─> {
         "commands": [
           {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube1"}},
           {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube2"}},
           {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube3"}}
         ],
         "failFast": false
       }
       │
2. Server: services/tools/batch_execute.py:77
   ├─> 验证命令数量（默认最大 25，硬上限 100）
   ├─> 规范化命令参数
   └─> send_with_unity_instance(async_send_command_with_retry, ...)
       │
3. Unity Transport Layer
   └─> PluginHub.send_command_for_instance("batch_execute", params)
       └─> WebSocket 发送单个 batch_execute 命令
           │
4. Unity Bridge
   └─> TransportCommandDispatcher.ExecuteCommandJsonAsync("batch_execute", ...)
       │
5. Command Registry
   └─> CommandRegistry.ExecuteCommand("batch_execute", params, tcs)
       │
6. Unity Tool Handler: Tools/BatchExecute.cs:34
   └─> HandleCommand(JObject @params)
       ├─> 解析 commands 数组
       ├─> 遍历每个命令（顺序执行）
       │   └─> CommandRegistry.InvokeCommandAsync(toolName, commandParams)
       │       └─> 调用实际工具（如 manage_gameobject）
       ├─> 收集结果
       └─> 返回批量结果数组
           │
7. 性能提升原因（源码证据）：
   - 单次 WebSocket 往返 vs N 次往返
   - Unity 侧批量执行减少上下文切换
   - 主线程顺序执行保证 Unity API 安全
```

### 4.2 批处理实现细节

**Server 侧验证（源码证据）：**
```python
# Server/src/services/tools/batch_execute.py:77-98
async def batch_execute(
    ctx: Context,
    commands: Annotated[list[dict[str, Any]], "List of commands..."],
    ...
) -> dict[str, Any]:
    if not isinstance(commands, list) or not commands:
        raise ValueError("'commands' must be a non-empty list...")
    
    max_commands = await _get_max_commands_from_editor_state(ctx)
    if len(commands) > max_commands:
        raise ValueError(
            f"batch_execute supports up to {max_commands} commands..."
        )
    
    # 发送单个 batch_execute 命令到 Unity
    response = await send_with_unity_instance(...)
```

**Unity 侧执行（源码证据）：**
```csharp
// MCPForUnity/Editor/Tools/BatchExecute.cs:34-182
public static async Task<object> HandleCommand(JObject @params)
{
    var commandsToken = @params["commands"] as JArray;
    int maxCommands = GetMaxCommandsPerBatch(); // 默认 25，硬上限 100
    
    var commandResults = new List<object>(commandsToken.Count);
    
    // 顺序执行每个命令（在主线程）
    foreach (var token in commandsToken)
    {
        string toolName = commandObj["tool"]?.ToString();
        var commandParams = NormalizeParameterKeys(rawParams);
        
        // 调用实际工具
        var result = await CommandRegistry.InvokeCommandAsync(
            toolName, 
            commandParams
        ).ConfigureAwait(true); // ConfigureAwait(true) 确保在主线程
        
        commandResults.Add(new {
            tool = toolName,
            callSucceeded = DetermineCallSucceeded(result),
            result
        });
        
        if (!callSucceeded && failFast)
        {
            break; // 快速失败模式
        }
    }
    
    return new SuccessResponse("Batch execution completed.", data);
}
```

**性能提升量化：**
- **网络往返**：1 次 vs N 次（N = 命令数量）
- **延迟**：~30ms（单次往返） vs ~30ms × N
- **吞吐量**：10-100x 提升（取决于命令数量）

---

## 5. 脚本 / 编译 / 挂载链路

### 5.1 脚本创建链路

```
1. MCP Client 调用 manage_script
   └─> { "action": "create", "name": "MyScript", "contents": "..." }
       │
2. Server: services/tools/manage_script.py
   └─> send_with_unity_instance("manage_script", params)
       │
3. Unity: Tools/ManageScript.cs:124
   └─> HandleCommand(JObject @params)
       ├─> 验证脚本名称（正则：^[a-zA-Z_][a-zA-Z0-9_]*$）
       ├─> TryResolveUnderAssets(path, ...)  # 路径安全检查
       ├─> 写入文件（原子操作：tmp → replace）
       └─> AssetDatabase.ImportAsset() 或 ScheduleScriptRefresh()
           │
4. Unity 触发编译
   └─> CompilationPipeline.RequestScriptCompilation()
       │
5. 编译等待机制（可选）
   └─> RefreshUnity.WaitForUnityReadyAsync()
       └─> EditorApplication.update 回调
           └─> 检查 EditorApplication.isCompiling
               └─> 超时（默认 60s）或完成
```

### 5.2 编译等待实现（源码证据）

**Unity 侧编译等待：**
```csharp
// MCPForUnity/Editor/Tools/RefreshUnity.cs:127-169
private static Task WaitForUnityReadyAsync(TimeSpan timeout)
{
    var tcs = new TaskCompletionSource<bool>();
    var start = DateTime.UtcNow;
    
    void Tick()
    {
        if ((DateTime.UtcNow - start) > timeout)
        {
            EditorApplication.update -= Tick;
            tcs.TrySetException(new TimeoutException());
            return;
        }
        
        // 检查编译状态
        if (!EditorApplication.isCompiling
            && !EditorApplication.isUpdating
            && !TestRunStatus.IsRunning
            && !EditorApplication.isPlayingOrWillChangePlaymode)
        {
            EditorApplication.update -= Tick;
            tcs.TrySetResult(true);
        }
    }
    
    EditorApplication.update += Tick;
    EditorApplication.QueuePlayerLoopUpdate(); // 唤醒主线程
    return tcs.Task;
}
```

**Server 侧编译检查（preflight）：**
```python
# Server/src/services/tools/preflight.py:80-106
if wait_for_no_compile:
    deadline = time.monotonic() + float(max_wait_s)
    while True:
        compilation = data.get("compilation")
        is_compiling = compilation.get("is_compiling") is True
        is_domain_reload_pending = compilation.get("is_domain_reload_pending") is True
        
        if not is_compiling and not is_domain_reload_pending:
            break
        
        if time.monotonic() >= deadline:
            return _busy("compiling", 500)
        
        await asyncio.sleep(0.25)
        
        # 刷新状态
        state_resp = await get_editor_state(ctx)
```

### 5.3 脚本编辑与挂载链路

**脚本编辑（apply_text_edits）：**
```csharp
// MCPForUnity/Editor/Tools/ManageScript.cs:650-813
public static object ApplyTextEdits(JObject @params)
{
    // 1. 读取文件
    string original = File.ReadAllText(fullPath);
    
    // 2. 应用文本编辑（行号/列号 → 索引）
    foreach (var edit in edits)
    {
        int startIndex = TryIndexFromLineCol(original, edit.startLine, edit.startCol);
        int endIndex = TryIndexFromLineCol(original, edit.endLine, edit.endCol);
        // 替换文本
    }
    
    // 3. 语法检查（Roslyn，可选）
    #if USE_ROSLYN
    var tree = CSharpSyntaxTree.ParseText(working);
    var diagnostics = tree.GetDiagnostics();
    #endif
    
    // 4. 原子写入
    File.WriteAllText(tmp, working);
    File.Replace(tmp, fullPath, backup);
    
    // 5. 触发编译
    AssetDatabase.ImportAsset(relativePath, ImportAssetOptions.ForceSynchronousImport);
    CompilationPipeline.RequestScriptCompilation();
}
```

**组件挂载（manage_components）：**
```
1. manage_components(action="add_component", target="GameObject", component="MyScript")
   └─> Tools/ManageComponents.cs
       ├─> 解析 GameObject
       ├─> 检查组件类型是否存在（Type.GetType(componentName)）
       ├─> 等待编译完成（如果类型不存在）
       └─> GameObject.AddComponent(componentType)
```

---

## 6. 读取 / 截图 / 层级链路

### 6.1 截图链路

**截图实现（源码证据）：**
```csharp
// MCPForUnity/Editor/Tools/ManageScene.cs:432-580
private static object CaptureScreenshot(SceneCommand cmd)
{
    // 1. 检查批量模式（surround/orbit）
    if (cmd.batch == "surround")
        return CaptureSurroundBatch(cmd);
    if (cmd.batch == "orbit")
        return CaptureOrbitBatch(cmd);
    
    // 2. 位置视图截图（view_position + look_at）
    if (cmd.viewPosition.HasValue)
        return CapturePositionedScreenshot(cmd);
    
    // 3. 相机截图（指定相机或默认相机）
    Camera targetCamera = ResolveCamera(cmd.camera);
    ScreenshotCaptureResult result = ScreenshotUtility.CaptureFromCameraToAssetsFolder(
        targetCamera,
        fileName,
        maxResolution
    );
    
    // 4. 返回 base64 编码图片（如果 include_image=true）
    return new SuccessResponse("Screenshot captured.", new {
        path = result.AssetsRelativePath,
        image = result.Base64Png, // base64 编码
        width = result.Width,
        height = result.Height
    });
}
```

**批量截图（6 角度环绕）：**
```csharp
// MCPForUnity/Editor/Tools/ManageScene.cs:581-718
private static object CaptureSurroundBatch(SceneCommand cmd)
{
    // 1. 计算场景边界
    Bounds bounds = CalculateSceneBounds();
    Vector3 center = bounds.center;
    float radius = bounds.extents.magnitude;
    
    // 2. 6 个角度（前后左右上下）
    Vector3[] directions = new[] {
        Vector3.forward, Vector3.back,
        Vector3.right, Vector3.left,
        Vector3.up, Vector3.down
    };
    
    // 3. 为每个角度创建临时相机并渲染
    List<Texture2D> tiles = new List<Texture2D>();
    foreach (var dir in directions)
    {
        var tempCam = CreateTempCamera(center + dir * radius, center);
        Texture2D tile = ScreenshotUtility.RenderCameraToTexture(tempCam, maxRes);
        tiles.Add(tile);
    }
    
    // 4. 合成联系表（contact sheet）
    var (compositeB64, compW, compH) = ScreenshotUtility.ComposeContactSheet(tiles, tileLabels);
    
    return new SuccessResponse("...", new {
        composite_image = compositeB64, // base64 编码的联系表
        width = compW,
        height = compH,
        screenshots = shotMeta
    });
}
```

### 6.2 层级查询链路

**分页层级查询（源码证据）：**
```csharp
// MCPForUnity/Editor/Tools/ManageScene.cs:1283-1383
private static object GetSceneHierarchyPaged(SceneCommand cmd)
{
    // 1. 获取活动场景
    Scene activeScene = EditorSceneManager.GetActiveScene();
    
    // 2. 解析分页参数（安全限制）
    int resolvedPageSize = Mathf.Clamp(cmd.pageSize ?? 50, 1, 500);
    int resolvedCursor = Mathf.Max(0, cmd.cursor ?? 0);
    int resolvedMaxNodes = Mathf.Clamp(cmd.maxNodes ?? 1000, 1, 5000);
    
    // 3. 获取节点列表（根对象或子对象）
    GameObject parentGo = ResolveGameObject(cmd.parent, activeScene);
    List<GameObject> nodes;
    if (parentGo == null)
    {
        nodes = activeScene.GetRootGameObjects().ToList();
        scope = "roots";
    }
    else
    {
        nodes = parentGo.transform.Cast<Transform>()
            .Select(t => t.gameObject)
            .ToList();
        scope = "children";
    }
    
    // 4. 分页切片
    int total = nodes.Count;
    int end = Mathf.Min(total, resolvedCursor + resolvedPageSize);
    var items = new List<object>();
    for (int i = resolvedCursor; i < end; i++)
    {
        items.Add(BuildGameObjectSummary(nodes[i], includeTransform, maxChildrenPerNode));
    }
    
    // 5. 返回分页结果
    return new SuccessResponse("...", new {
        scope = scope,
        cursor = resolvedCursor,
        pageSize = resolvedPageSize,
        next_cursor = end < total ? end.ToString() : null,
        truncated = end < total,
        total = total,
        items = items
    });
}
```

**GameObject 摘要构建：**
```csharp
// MCPForUnity/Editor/Tools/ManageScene.cs:1400-1500
private static object BuildGameObjectSummary(
    GameObject go, 
    bool includeTransform, 
    int maxChildrenPerNode
)
{
    return new {
        name = go.name,
        instanceID = go.GetInstanceID(),
        active = go.activeSelf,
        tag = go.tag,
        layer = go.layer,
        transform = includeTransform ? new {
            position = go.transform.position,
            rotation = go.transform.rotation.eulerAngles,
            scale = go.transform.localScale
        } : null,
        components = go.GetComponents<Component>()
            .Select(c => new {
                type = c.GetType().Name,
                instanceID = c.GetInstanceID()
            })
            .Take(maxChildrenPerNode)
            .ToList(),
        childCount = go.transform.childCount
    };
}
```

### 6.3 资源层查询链路

**editor_state 资源（源码证据）：**
```python
# Server/src/services/resources/editor_state.py:224-309
@mcp_for_unity_resource(
    uri="mcpforunity://editor/state",
    name="editor_state",
    description="Canonical editor readiness snapshot..."
)
async def get_editor_state(ctx: Context) -> MCPResponse:
    unity_instance = await get_unity_instance_from_context(ctx)
    
    # 1. 查询 Unity 侧状态
    response = await unity_transport.send_with_unity_instance(
        async_send_command_with_retry,
        unity_instance,
        "get_editor_state",
        {},
    )
    
    # 2. Server 侧增强（advice + staleness）
    state_v2 = response.get("data")
    state_v2 = _enrich_advice_and_staleness(state_v2)
    
    # 3. 返回结构化状态
    return MCPResponse(success=True, data=state_v2)
```

**状态增强逻辑：**
```python
# Server/src/services/resources/editor_state.py:178-216
def _enrich_advice_and_staleness(state_v2: dict[str, Any]) -> dict[str, Any]:
    # 1. 计算陈旧度
    age_ms = max(0, now_ms - observed_ms)
    is_stale = age_ms > 2000  # >2s 视为陈旧
    
    # 2. 检查阻塞原因
    blocking: list[str] = []
    if compilation.get("is_compiling") is True:
        blocking.append("compiling")
    if compilation.get("is_domain_reload_pending") is True:
        blocking.append("domain_reload")
    if tests.get("is_running") is True:
        blocking.append("running_tests")
    if refresh.get("is_refresh_in_progress") is True:
        blocking.append("asset_refresh")
    if is_stale:
        blocking.append("stale_status")
    
    # 3. 生成建议
    ready_for_tools = len(blocking) == 0
    state_v2["advice"] = {
        "ready_for_tools": ready_for_tools,
        "blocking_reasons": blocking,
        "recommended_retry_after_ms": 0 if ready_for_tools else 500,
        "recommended_next_action": "none" if ready_for_tools else "retry_later",
    }
    
    return state_v2
```

---

## 7. 平滑体验的关键实现点

### 7.1 高层工具封装（厚工具设计）

**源码证据：**
```python
# Server/src/services/tools/manage_gameobject.py:41-117
@mcp_for_unity_tool(
    description=(
        "Performs CRUD operations on GameObjects. "
        "Actions: create, modify, delete, duplicate, move_relative, look_at. "
        "NOT for searching — use the find_gameobjects tool..."
    ),
)
async def manage_gameobject(
    ctx: Context,
    action: Literal["create", "modify", "delete", "duplicate", "move_relative", "look_at"],
    # ... 20+ 参数
) -> dict[str, Any]:
    # 单个工具处理完整工作流
    # 减少工具数量（33 个 vs 可能的 100+ 个细粒度工具）
```

**优势：**
- 减少工具数量，降低 LLM 认知负担
- 单个工具处理完整工作流，减少工具调用次数
- 参数规范化（coerce_int, coerce_bool, normalize_vector3）减少参数错误

### 7.2 批量合并机制

**源码证据：**
```csharp
// MCPForUnity/Editor/Tools/BatchExecute.cs:34-182
public static async Task<object> HandleCommand(JObject @params)
{
    // Unity 侧顺序执行多个命令
    foreach (var token in commandsToken)
    {
        var result = await CommandRegistry.InvokeCommandAsync(
            toolName, 
            commandParams
        ).ConfigureAwait(true);
        // ...
    }
}
```

**优势：**
- 10-100x 性能提升（单次往返 vs N 次往返）
- 减少网络延迟
- 降低 token 成本（单次响应 vs N 次响应）

### 7.3 状态恢复 / 容错机制

**Domain Reload 自动重连（源码证据）：**
```python
# Server/src/transport/plugin_hub.py:824-958
async def _resolve_session_id(
    cls,
    unity_instance: str | None,
    user_id: str | None = None,
    retry_on_reload: bool = True,
) -> str:
    # 最多等待 20s（domain reload 期间）
    max_wait_s = float(os.environ.get("UNITY_MCP_SESSION_RESOLVE_MAX_WAIT_S", "20.0"))
    deadline = time.monotonic() + max_wait_s
    
    while session_id is None and time.monotonic() < deadline:
        await asyncio.sleep(0.25)
        session_id, session_count, explicit_required = await _try_once()
    
    if session_id is None:
        raise NoUnitySessionError("No Unity plugins are currently connected")
    
    return session_id
```

**Unity 侧 Domain Reload 处理（源码证据）：**
```csharp
// MCPForUnity/Editor/Services/HttpBridgeReloadHandler.cs:14-163
[InitializeOnLoad]
internal static class HttpBridgeReloadHandler
{
    static HttpBridgeReloadHandler()
    {
        AssemblyReloadEvents.beforeAssemblyReload += OnBeforeAssemblyReload;
        AssemblyReloadEvents.afterAssemblyReload += OnAfterAssemblyReload;
    }
    
    private static void OnBeforeAssemblyReload()
    {
        // 保存状态
        EditorPrefs.SetBool(EditorPrefKeys.ResumeHttpAfterReload, true);
        transport.ForceStop(TransportMode.Http);
    }
    
    private static void OnAfterAssemblyReload()
    {
        // 自动恢复连接（重试计划：[0s, 1s, 3s, 5s, 10s, 30s]）
        _ = ResumeHttpWithRetriesAsync();
    }
}
```

**快速失败机制（源码证据）：**
```python
# Server/src/transport/plugin_hub.py:107-108
_FAST_FAIL_COMMANDS: set[str] = {
    "read_console", "get_editor_state", "ping"
}

# Server/src/transport/plugin_hub.py:264-272
if command_type in cls._FAST_FAIL_COMMANDS:
    fast_timeout = float(cls.FAST_FAIL_TIMEOUT)  # 2.0s
    unity_timeout_s = fast_timeout
    server_wait_s = fast_timeout
```

**连接存活检查（源码证据）：**
```python
# Server/src/transport/plugin_hub.py:98-100
PING_INTERVAL = 10  # 每 10s 发送一次 ping
PING_TIMEOUT = 20   # 20s 未收到 pong 视为连接死亡
```

### 7.4 减少模型查询和参数负担

**参数规范化（源码证据）：**
```python
# Server/src/services/tools/utils.py
def coerce_int(value: Any, default: int | None = None) -> int | None:
    """灵活的类型转换：int, str, None"""
    
def normalize_vector3(value: Any, param_name: str) -> tuple[Vector3 | None, str | None]:
    """支持 [x,y,z], {x,y,z}, JSON 字符串"""
```

**默认值设计（源码证据）：**
```python
# Server/src/services/tools/manage_scene.py:26-59
async def manage_scene(
    ctx: Context,
    action: Literal["create", "load", "save", "get_hierarchy", ...],
    page_size: Annotated[int | str, "Page size for get_hierarchy paging."] | None = None,
    cursor: Annotated[int | str, "Opaque cursor for paging."] | None = None,
    # ...
) -> dict[str, Any]:
    # 默认值：page_size=50, cursor=0
    coerced_page_size = coerce_int(page_size, default=None)
```

**分页机制（源码证据）：**
```csharp
// MCPForUnity/Editor/Tools/ManageScene.cs:1310-1318
int resolvedPageSize = Mathf.Clamp(cmd.pageSize ?? 50, 1, 500);
int resolvedMaxNodes = Mathf.Clamp(cmd.maxNodes ?? 1000, 1, 5000);
// 防止 token 爆炸
```

**资源层减少工具调用（源码证据）：**
```python
# Server/src/services/resources/editor_state.py:224
@mcp_for_unity_resource(...)
async def get_editor_state(ctx: Context) -> MCPResponse:
    # 一次查询返回完整编辑器状态
    # 包括：编译状态、测试状态、资源状态、建议等
    # 避免多次工具调用
```

---

## 8. 对 Planner 缺席的替代机制分析

### 8.1 为什么没有显式 Planner？

**项目设计理念：**
- **产品优先**：强调用户体验，而非架构复杂性
- **厚工具设计**：单个工具处理完整工作流
- **批量执行**：通过 `batch_execute` 减少工具调用次数
- **上下文资源**：通过资源层提供状态查询

### 8.2 Planner 替代机制

#### 8.2.1 厚工具设计（替代部分规划逻辑）

**源码证据：**
```python
# Server/src/services/tools/manage_gameobject.py:41-117
@mcp_for_unity_tool(
    description=(
        "Performs CRUD operations on GameObjects. "
        "Actions: create, modify, delete, duplicate, move_relative, look_at."
    ),
)
async def manage_gameobject(
    ctx: Context,
    action: Literal["create", "modify", "delete", "duplicate", "move_relative", "look_at"],
    # ... 20+ 参数
) -> dict[str, Any]:
    # 单个工具处理多个操作，减少工具调用次数
```

**作用：**
- 减少工具数量（33 个 vs 可能的 100+ 个）
- 降低 LLM 选择工具的认知负担
- 单个工具处理完整工作流，减少规划需求

#### 8.2.2 批量执行（替代多步骤规划）

**源码证据：**
```csharp
// MCPForUnity/Editor/Tools/BatchExecute.cs:34-182
public static async Task<object> HandleCommand(JObject @params)
{
    // Unity 侧顺序执行多个命令
    foreach (var token in commandsToken)
    {
        var result = await CommandRegistry.InvokeCommandAsync(toolName, commandParams);
        // ...
    }
}
```

**作用：**
- 将多个工具调用合并为单个调用
- 减少网络往返和延迟
- 降低 LLM 规划多步骤的需求

#### 8.2.3 上下文资源（替代状态查询规划）

**源码证据：**
```python
# Server/src/services/resources/editor_state.py:224-309
@mcp_for_unity_resource(
    uri="mcpforunity://editor/state",
    name="editor_state",
    description="Canonical editor readiness snapshot..."
)
async def get_editor_state(ctx: Context) -> MCPResponse:
    # 一次查询返回完整编辑器状态
    # 包括：编译状态、测试状态、资源状态、建议等
```

**作用：**
- 一次查询获取完整状态，减少多次工具调用
- 提供 `advice` 字段，指导下一步操作
- 降低 LLM 规划状态查询的需求

#### 8.2.4 智能容错（替代错误恢复规划）

**源码证据：**
```python
# Server/src/services/tools/preflight.py:27-110
async def preflight(
    ctx,
    *,
    wait_for_no_compile: bool = False,
    refresh_if_dirty: bool = False,
    max_wait_s: float = 30.0,
) -> MCPResponse | None:
    # 自动检查编译状态，等待完成
    # 自动刷新脏资源
    # 返回 retry 提示
```

**作用：**
- 自动处理编译等待、资源刷新等常见场景
- 返回明确的 retry 提示，减少 LLM 规划错误恢复的需求

#### 8.2.5 Instructions 系统（替代规划指导）

**源码证据：**
```python
# Server/src/main.py:300-350
def _build_instructions(project_scoped_tools: bool) -> str:
    return f"""
Important Workflows:

Script Management:
- After creating or modifying scripts use `read_console` to check for compilation errors
- Only after successful compilation can new components/types be used
- You can poll the `editor_state` resource's `isCompiling` field

Scene Setup:
- Always include a Camera and main Light (Directional Light) in new scenes
- Create prefabs with `manage_asset` for reusable GameObjects

Payload sizing & paging (important):
- Many Unity queries can return very large JSON. Prefer **paged + summary-first** calls.
- `manage_scene(action="get_hierarchy")`: Use `page_size` + `cursor`
"""
```

**作用：**
- 通过 Instructions 提供工作流指导
- 减少 LLM 规划多步骤的需求
- 提供最佳实践建议

### 8.3 与显式 Planner 的对比

| 特性 | Unity MCP（无 Planner） | 显式 Planner 架构 |
|------|------------------------|------------------|
| **工具数量** | 33 个厚工具 | 100+ 个细粒度工具 |
| **工具调用次数** | 少（批量执行） | 多（逐步规划） |
| **状态查询** | 资源层（一次查询） | 多次工具调用 |
| **错误恢复** | 自动容错 + retry 提示 | 规划错误恢复步骤 |
| **工作流指导** | Instructions 系统 | Planner 规划逻辑 |
| **复杂度** | 低（产品优先） | 高（架构优先） |

### 8.4 总结：为什么它"丝滑"？

1. **厚工具设计**：减少工具数量，降低认知负担
2. **批量执行**：10-100x 性能提升，减少延迟
3. **上下文资源**：一次查询获取完整状态
4. **智能容错**：自动处理编译等待、domain reload 等场景
5. **参数规范化**：灵活的参数类型，减少参数错误
6. **分页机制**：防止 token 爆炸
7. **Instructions 系统**：提供工作流指导

**这些机制共同作用，使得项目在没有显式 Planner 的情况下，仍然能够提供流畅的用户体验。**

---

## 9. 结论

### 9.1 核心发现

1. **无显式 Planner**：项目通过厚工具设计、批量执行、上下文资源和智能容错来替代 Planner 的部分作用。

2. **双进程解耦架构**：Python MCP Server 与 Unity Editor Plugin 完全解耦，通过 WebSocket 通信。

3. **主线程调度器**：Unity 侧通过 `TransportCommandDispatcher` 确保所有 Unity API 调用在主线程执行。

4. **批量执行优化**：`batch_execute` 工具实现 10-100x 性能提升。

5. **智能容错机制**：
   - Domain reload 期间自动等待重连（最多 20s）
   - 编译状态检查（`preflight`）
   - 快速失败机制（关键命令 2s 超时）
   - 连接存活检查（ping/pong）

6. **资源层设计**：通过只读资源（如 `editor_state`）提供编辑器状态查询，减少工具调用次数。

### 9.2 "丝滑"体验的源码证据

1. **主线程调度器**：`TransportCommandDispatcher.RequestMainThreadPump()` 主动唤醒主线程
2. **批量执行**：`BatchExecute.cs` 顺序执行多个命令，单次往返
3. **编译等待**：`RefreshUnity.WaitForUnityReadyAsync()` 通过 `EditorApplication.update` 回调等待编译完成
4. **Domain Reload 重连**：`HttpBridgeReloadHandler` 自动恢复连接
5. **状态增强**：`editor_state` 资源提供 `advice` 字段，指导下一步操作
6. **参数规范化**：`coerce_int`, `coerce_bool`, `normalize_vector3` 减少参数错误
7. **分页机制**：`GetSceneHierarchyPaged` 防止 token 爆炸

### 9.3 对 UnityAI 项目的启示

1. **厚工具设计**：考虑将细粒度工具合并为厚工具，减少工具数量
2. **批量执行**：实现批量执行机制，提升性能
3. **资源层**：通过资源层提供状态查询，减少工具调用
4. **智能容错**：自动处理编译等待、domain reload 等场景
5. **参数规范化**：提供灵活的参数类型转换
6. **Instructions 系统**：通过 Instructions 提供工作流指导

---

**文档版本：** v1.0  
**分析日期：** 2026-03-06  
**分析范围：** 真实调用链和执行方式深挖
