# Unity AI（LLM + MCP）项目架构与功能说明文档

**版本：** v1.0  
**生成日期：** 2026-03-06  
**适用范围：** UnityAI 项目全栈（L1 MCP Client / L2 Sidecar / L3 Unity Editor）

---

## 目录

1. [整体架构与通信机制](#1-整体架构与通信机制)
2. [核心模块与链路](#2-核心模块与链路)
3. [已注册的 MCP Tools 与能力暴露](#3-已注册的-mcp-tools-与能力暴露)
4. [数据流转与异常处理](#4-数据流转与异常处理)
5. [当前已知问题与痛点](#5-当前已知问题与痛点)

---

## 1. 整体架构与通信机制

### 1.1 技术栈

本项目采用**三层混合架构**（L1/L2/L3），各层技术栈如下：

#### L1 层（MCP Client / LLM 接口层）
- **协议：** JSON-RPC 2.0（MCP Protocol 2024-11-05）
- **通信方式：** STDIO（标准输入输出）
- **职责：** 接收 LLM 指令，转换为 MCP 工具调用，不直接访问 Unity 进程

#### L2 层（Node.js Sidecar 网关层）
- **技术栈：** Node.js + Express（HTTP Server）
- **默认端口：** `http://127.0.0.1:46321`
- **核心模块：**
  - MCP Server：`sidecar/src/mcp/mcpServer.js`
  - HTTP Router：`sidecar/src/api/router.js`
  - 命令注册表：`sidecar/src/mcp/commandRegistry.js`
  - 任务编排：`sidecar/src/application/turnService.js`
  - 错误反馈：`sidecar/src/application/errorFeedback/mcpErrorFeedback.js`

#### L3 层（Unity Editor C# 执行层）
- **技术栈：** Unity Editor + C# .NET
- **核心模块：**
  - 对话控制器：`Assets/Editor/Codex/Application/ConversationController.cs`
  - 动作执行器：`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
  - 查询服务：`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
  - HTTP 网关：`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`

### 1.2 通信链路

#### L1 ↔ L2 通信（MCP Protocol）
- **协议：** JSON-RPC 2.0 over STDIO
- **入口：** `sidecar/src/mcp/mcpServer.js`
- **支持方法：**
  - `initialize`：初始化 MCP 连接
  - `tools/list`：获取工具列表
  - `tools/call`：调用工具
  - `ping`：心跳检测

#### L2 ↔ L3 通信（HTTP REST API）
- **协议：** HTTP/1.1
- **方向：** 双向通信（请求-响应 + 回调）

**L2 → L3（写操作）：**
```
POST /unity/action.request
Content-Type: application/json
Body: {
  "request_id": "...",
  "action_type": "...",
  "action_data": {...},
  "legacy_marshaled_action_data": "...",
  ...
}
```

**L3 → L2（回调）：**
```
POST /unity/action/result
POST /unity/query/report
POST /unity/query/pull
POST /unity/runtime/ping
POST /unity/capabilities/report
```

**L2 → L3（读操作）：**
```
POST /unity/query/pull
（Unity 通过轮询机制主动拉取）
```

#### Unity 端轮询机制
- **实现位置：** `Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs`
- **轮询间隔：** 0.6 秒（`PollIntervalSeconds`）
- **机制：** Unity Editor 在 `EditorApplication.update` 中定期调用 `PollRagQueriesAsync`

### 1.3 通信初始化流程

1. **Sidecar 启动：**
   ```bash
   npm start  # 或 node index.js --port 46321
   ```
   - 监听 `http://127.0.0.1:46321`
   - 启动 HTTP Server 和 MCP Server（STDIO）

2. **Unity Editor 连接：**
   - Unity 启动时通过 `[InitializeOnLoad]` 自动初始化
   - `UnityRagQueryPollingBootstrap` 创建 `ConversationController`
   - 默认连接 `http://127.0.0.1:46321`
   - 通过 HTTP 健康检查确认连接：`GET /health`

3. **MCP Client 连接：**
   - Cursor 或其他 MCP Client 通过 STDIO 启动 Sidecar
   - 发送 `initialize` 请求建立连接
   - 调用 `tools/list` 获取可用工具列表

---

## 2. 核心模块与链路

### 2.1 目录结构

```
UnityAI/
├── sidecar/                    # L2 层（Node.js Sidecar）
│   ├── src/
│   │   ├── mcp/                # MCP 协议层
│   │   │   ├── mcpServer.js    # MCP Server 入口
│   │   │   ├── commandRegistry.js  # 命令注册表
│   │   │   └── commands/       # 命令定义
│   │   ├── api/                # HTTP API 层
│   │   │   └── router.js       # HTTP 路由
│   │   ├── application/       # 应用层
│   │   │   ├── turnService.js  # 任务编排服务
│   │   │   ├── mcpGateway/     # MCP 网关服务
│   │   │   ├── queryRuntime/   # 查询运行时
│   │   │   └── errorFeedback/  # 错误反馈
│   │   └── domain/             # 领域层
│   │       └── validators/     # 验证器
│   └── index.js                # Sidecar 入口
├── Assets/Editor/Codex/        # L3 层（Unity C#）
│   ├── Application/
│   │   └── ConversationController.cs  # 对话控制器
│   ├── Infrastructure/
│   │   ├── UnityVisualActionExecutor.cs  # 动作执行器
│   │   ├── UnityRagReadService.cs        # 查询服务
│   │   ├── HttpSidecarGateway.cs        # HTTP 网关
│   │   ├── Actions/            # 动作处理器
│   │   ├── Queries/            # 查询处理器
│   │   └── Ssot/Executors/     # SSOT 执行器（48个）
│   └── Domain/                 # 领域模型
├── ssot/                       # SSOT（单一真相源）系统
│   ├── dictionary/
│   │   └── tools.json         # 工具定义字典
│   ├── artifacts/
│   │   ├── l2/                # L2 生成产物
│   │   │   ├── mcp-tools.generated.json
│   │   │   └── sidecar-command-manifest.generated.json
│   │   └── l3/                # L3 生成产物
│   │       └── SsotDtos.generated.cs
│   └── compiler/              # SSOT 编译器（Node.js）
└── docs/                       # 文档目录
```

### 2.2 指令路由与门禁

#### 2.2.1 MCP 工具调用流程

```
LLM (L1)
  ↓ JSON-RPC tools/call
MCP Server (mcpServer.js)
  ↓ dispatchMcpTool
Command Registry (commandRegistry.js)
  ↓ dispatchHttpCommand
HTTP Router (router.js)
  ↓ route to /mcp/*
Turn Service (turnService.js)
  ↓ submitUnityTask / executeUnityReadQuery
Mcp Gateway (mcpGateway.js)
  ↓ buildUnityActionRequest
HTTP POST /unity/action.request
  ↓
Unity ConversationController
  ↓ ExecutePendingActionAndReportAsync
Unity Visual Action Executor
  ↓ Execute -> Registry.TryGet
Action Handler (具体处理器)
  ↓ Run (Unity Editor API)
  ↓
HTTP POST /unity/action/result (回调)
  ↓
Turn Service (更新任务状态)
  ↓
返回结果给 LLM
```

#### 2.2.2 Schema 校验与门禁

**L2 层校验：**
- **位置：** `sidecar/src/domain/validators/`
- **校验点：**
  1. **OCC（乐观并发控制）门禁：**
     - 所有写操作必须携带 `based_on_read_token`
     - 校验 `scene_revision` 是否匹配
     - 不匹配时返回 `E_STALE_SNAPSHOT`
  
  2. **双锚点门禁：**
     - 写操作必须提供 `write_anchor_object_id` 和 `write_anchor_path`
     - 目标对象必须提供 `target_object_id` 和 `target_path`
     - 锚点冲突时返回 `E_TARGET_ANCHOR_CONFLICT`
  
  3. **Schema 校验：**
     - 使用 SSOT 生成的 JSON Schema 验证输入
     - 工具定义来源：`ssot/dictionary/tools.json`
     - 编译产物：`ssot/artifacts/l2/mcp-tools.generated.json`
  
  4. **协议冻结门禁：**
     - 外部 payload 禁止使用 `legacy_stringified_action_data`
     - 必须使用 `action_data` 对象
     - 违规返回 `E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`

**L3 层校验：**
- **位置：** `Assets/Editor/Codex/Infrastructure/Ssot/Executors/`
- **校验点：**
  - 目标对象存在性检查
  - 组件类型有效性检查
  - 属性路径有效性检查
  - Unity Editor 状态检查（编译中、播放中等）

### 2.3 Unity 执行层

#### 2.3.1 动作执行流程

**执行入口：** `UnityVisualActionExecutor.Execute`

```csharp
// 1. 从 Registry 获取 Handler
if (!_registry.TryGet(actionType, out var handler))
{
    return ErrorResult("E_ACTION_HANDLER_NOT_FOUND");
}

// 2. 构建执行上下文
var context = new McpVisualActionContext
{
    ActionType = actionType,
    ActionData = actionData,
    TargetAnchor = targetAnchor,
    ...
};

// 3. 执行 Handler
var result = await handler.RunAsync(context);

// 4. 返回结果
return result;
```

#### 2.3.2 Unity Editor API 调用

**主要使用的 Unity Editor API：**

1. **GameObject 操作：**
   - `GameObject.CreatePrimitive()`
   - `Object.Instantiate()`
   - `Object.DestroyImmediate()`
   - `EditorUtility.SetDirty()`

2. **Transform 操作：**
   - `Transform.localPosition`
   - `Transform.localRotation`
   - `Transform.localScale`
   - `Transform.SetParent()`
   - `Transform.SetSiblingIndex()`

3. **Component 操作：**
   - `GameObject.AddComponent<T>()`
   - `Object.DestroyImmediate(component)`
   - `SerializedObject.FindProperty()`
   - `SerializedProperty.SetValue()`

4. **UI 操作：**
   - `RectTransform.anchoredPosition`
   - `RectTransform.sizeDelta`
   - `RectTransform.anchors`
   - `RectTransform.pivot`

5. **资产操作：**
   - `AssetDatabase.CreateAsset()`
   - `AssetDatabase.SaveAssets()`
   - `PrefabUtility.SaveAsPrefabAsset()`
   - `EditorSceneManager.SaveScene()`

6. **Undo 系统：**
   - `Undo.RegisterCompleteObjectUndo()`
   - `Undo.SetTransformParent()`
   - `Undo.AddComponent()`
   - `Undo.DestroyObjectImmediate()`

#### 2.3.3 主线程调度

**关键约束：**
- Unity Editor API **必须在主线程调用**
- 所有异步操作通过 `SynchronizationContext` 调度回主线程
- 实现位置：`ConversationController` 使用 `_unitySynchronizationContext`

**轮询机制：**
- Unity 通过 `EditorApplication.update` 定期轮询 Sidecar
- 轮询间隔：0.6 秒
- 实现位置：`UnityRagQueryPollingBootstrap.OnEditorUpdate`

---

## 3. 已注册的 MCP Tools 与能力暴露

### 3.1 工具分类

根据 `ssot/dictionary/tools.json` 和 `ssot/artifacts/l2/mcp-tools.generated.json`，当前已注册的工具分为以下几类：

#### 3.1.1 写操作工具（Write Tools）

**对象管理：**
- `create_object`：创建空对象或预定义 UI 对象（empty, ui_button, ui_panel, camera, light）
- `delete_object`：删除对象
- `duplicate_object`：复制对象
- `rename_object`：重命名对象
- `set_active`：设置对象激活状态

**层级操作：**
- `set_parent`：设置父对象
- `set_sibling_index`：设置兄弟索引（排序）

**Transform 操作：**
- `set_local_position`：设置本地位置
- `set_local_rotation`：设置本地旋转
- `set_local_scale`：设置本地缩放
- `set_world_position`：设置世界位置
- `set_world_rotation`：设置世界旋转
- `reset_transform`：重置 Transform

**Component 操作：**
- `add_component`：添加组件
- `remove_component`：移除组件
- `replace_component`：替换组件类型
- `set_component_properties`：设置组件属性（标量值）

**UI 布局操作：**
- `modify_ui_layout`：修改 RectTransform 几何（位置、尺寸）
- `set_rect_anchored_position`：设置锚点位置
- `set_rect_size_delta`：设置尺寸增量
- `set_rect_pivot`：设置轴心点
- `set_rect_anchors`：设置锚点范围

**UI 属性操作：**
- `set_ui_image_color`：设置 Image 颜色
- `set_ui_image_raycast_target`：设置 Image 射线检测目标
- `set_ui_text_content`：设置文本内容
- `set_ui_text_color`：设置文本颜色
- `set_ui_text_font_size`：设置字体大小
- `set_canvas_group_alpha`：设置 CanvasGroup 透明度
- `set_layout_element`：设置 LayoutElement 约束

**泛化写操作：**
- `set_serialized_property`：设置序列化属性（支持复杂类型、数组、对象引用）

**事务操作：**
- `execute_unity_transaction`：执行原子事务（支持多步骤、别名引用、依赖关系、回滚）

**资产操作：**
- `save_scene`：保存场景
- `save_prefab`：保存 Prefab

#### 3.1.2 读操作工具（Read Tools）

**场景查询：**
- `get_scene_roots`：获取场景根对象列表
- `get_scene_snapshot_for_write`：获取写操作快照（包含 `read_token`）
- `get_current_selection`：获取当前选中对象

**层级查询：**
- `get_hierarchy_subtree`：获取层级子树
- `get_gameobject_components`：获取 GameObject 组件列表

**资产查询：**
- `list_assets_in_folder`：列出文件夹中的资产
- `query_prefab_info`：查询 Prefab 信息
- `find_objects_by_component`：按组件类型查找对象

**UI 查询：**
- `get_ui_tree`：获取 UI 树结构
- `get_ui_overlay_report`：获取 UI 覆盖层报告
- `hit_test_ui_at_viewport_point`：视口坐标命中测试
- `hit_test_ui_at_screen_point`：屏幕坐标命中测试
- `validate_ui_layout`：验证 UI 布局（支持修复建议）

**属性查询：**
- `get_serialized_property_tree`：获取序列化属性树（支持分页、预算控制）

**截图：**
- `capture_scene_screenshot`：捕获场景截图

**元数据查询：**
- `get_action_catalog`：获取动作目录（已废弃，返回静态响应）
- `get_action_schema`：获取动作 Schema（已废弃，返回静态响应）
- `get_tool_schema`：获取工具 Schema
- `get_write_contract_bundle`：获取写操作契约包
- `preflight_validate_write_payload`：预检验证写操作 payload

**配置工具：**
- `setup_cursor_mcp`：设置 Cursor MCP 配置
- `verify_mcp_setup`：验证 MCP 配置

#### 3.1.3 状态查询工具（Status Tools）

- `get_unity_task_status`：获取 Unity 任务状态
- `cancel_unity_task`：取消 Unity 任务

### 3.2 工具生命周期

根据 `ssot/artifacts/l2/mcp-tools.generated.json`，工具生命周期分为：

- **stable**：稳定版本，生产可用
- **experimental**：实验性版本，可能变更
- **deprecated**：已废弃，不建议使用
- **removed**：已移除，不可用

### 3.3 资源（Resources）

**注意：** 根据代码，MCP Resources 机制已被移除（`mcpServer.js:241-245`），所有上下文信息通过读操作工具获取。

**替代方案：**
- 使用 `get_scene_roots` 获取场景根对象
- 使用 `get_current_selection` 获取当前选中对象
- 使用 `get_hierarchy_subtree` 获取层级结构
- 使用 `get_ui_tree` 获取 UI 结构

### 3.4 工具可见性控制

**实现位置：** `sidecar/src/ports/contracts.js` 和 `ssot/artifacts/l2/visibility-policy.generated.json`

**控制机制：**
- `active_tool_names`：激活的工具列表（对 LLM 可见）
- `deprecated_tool_names`：废弃的工具列表
- `removed_tool_names`：已移除的工具列表
- `disabled_tools`：禁用的工具列表

**当前已移除的工具：**
- `instantiate_prefab`（已移除，使用 `create_object` 替代）

---

## 4. 数据流转与异常处理

### 4.1 典型指令生命周期（写操作示例）

以"修改 UI Layout"为例，完整生命周期如下：

```
1. LLM 规划任务
   "需要修改按钮的位置和尺寸"

2. LLM 调用 get_scene_snapshot_for_write
   → MCP Server (L1 → L2)
   → HTTP GET /mcp/get_scene_snapshot_for_write
   → Turn Service
   → Query Coordinator
   → Unity Polling (/unity/query/pull)
   → Unity Query Handler
   → Unity Response (/unity/query/report)
   → 返回 read_token 和场景快照

3. LLM 调用 modify_ui_layout
   → MCP Server (L1 → L2)
   → HTTP POST /mcp/modify_ui_layout
   → Turn Service (校验 OCC token、双锚点、Schema)
   → Mcp Gateway (构建 Unity Action Request)
   → HTTP POST /unity/action.request
   → Unity ConversationController
   → Unity Visual Action Executor
   → ModifyUiLayoutSsotExecutor
   → Unity Editor API (RectTransform.anchoredPosition, sizeDelta)
   → Undo.RegisterCompleteObjectUndo
   → HTTP POST /unity/action/result (回调)
   → Turn Service (更新任务状态)
   → 返回结果给 LLM

4. LLM 调用 save_scene（可选）
   → 类似流程，最终调用 EditorSceneManager.SaveScene()
```

### 4.2 典型指令生命周期（读操作示例）

以"获取 UI 树"为例：

```
1. LLM 调用 get_ui_tree
   → MCP Server (L1 → L2)
   → HTTP POST /mcp/get_ui_tree
   → Turn Service
   → McpEyesReadService
   → Query Coordinator (入队查询)
   → Unity Polling (/unity/query/pull)
   → Unity Query Handler (GetUiTreeQueryHandler)
   → Unity UI Tree Read Service
   → 构建 UI 树结构（节点、布局、交互、文本指标）
   → HTTP POST /unity/query/report
   → Query Coordinator (出队，生成 read_token)
   → 返回 UI 树数据给 LLM
```

### 4.3 异常处理机制

#### 4.3.1 错误码体系

**错误码分类：**

1. **Schema 校验错误：**
   - `E_SCHEMA_INVALID`：Schema 验证失败
   - `E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`：禁止使用字符串化的 action_data

2. **OCC 并发控制错误：**
   - `E_STALE_SNAPSHOT`：场景快照过期（`scene_revision` 不匹配）
   - `E_READ_REQUIRED`：缺少 `based_on_read_token`

3. **锚点验证错误：**
   - `E_TARGET_NOT_FOUND`：目标对象不存在
   - `E_TARGET_ANCHOR_CONFLICT`：锚点冲突（object_id 与 path 不匹配）
   - `E_TARGET_CONFLICT`：目标冲突

4. **Unity 状态错误：**
   - `E_SELECTION_UNAVAILABLE`：选择不可用（Unity 编译中或播放中）
   - `E_UNITY_NOT_CONNECTED`：Unity 未连接
   - `E_WAITING_FOR_UNITY_REBOOT`：等待 Unity 重启

5. **组件/属性错误：**
   - `E_ACTION_COMPONENT_NOT_FOUND`：组件未找到
   - `E_PROPERTY_NOT_FOUND`：属性未找到
   - `E_PROPERTY_TYPE_MISMATCH`：属性类型不匹配

6. **事务错误：**
   - `E_COMPOSITE_PAYLOAD_INVALID`：事务 payload 无效
   - `E_COMPOSITE_ALIAS_INVALID`：事务别名无效
   - `E_COMPOSITE_ALIAS_NOT_FOUND`：事务别名未找到
   - `E_COMPOSITE_STEP_FAILED`：事务步骤失败
   - `E_COMPOSITE_ROLLBACK_INCOMPLETE`：事务回滚不完整

7. **任务管理错误：**
   - `E_JOB_NOT_FOUND`：任务未找到
   - `E_JOB_CONFLICT`：任务冲突
   - `E_JOB_HEARTBEAT_TIMEOUT`：任务心跳超时
   - `E_JOB_MAX_RUNTIME_EXCEEDED`：任务最大运行时间超限

8. **查询错误：**
   - `E_UI_TREE_QUERY_FAILED`：UI 树查询失败
   - `E_UI_HIT_TEST_QUERY_FAILED`：UI 命中测试失败
   - `E_SCREENSHOT_CAPTURE_FAILED`：截图捕获失败

9. **通用错误：**
   - `E_INTERNAL`：内部错误
   - `E_NOT_FOUND`：未找到
   - `E_PRECONDITION_FAILED`：前置条件失败

#### 4.3.2 错误反馈通道

**L3 → L2 错误反馈：**

```csharp
// Unity 执行器返回错误结果
return new UnityActionResult
{
    Success = false,
    ErrorCode = "E_TARGET_NOT_FOUND",
    ErrorMessage = "Target object not found: Scene/Canvas/Button",
    ...
};

// 通过 HTTP 回调返回
POST /unity/action/result
{
    "request_id": "...",
    "success": false,
    "error_code": "E_TARGET_NOT_FOUND",
    "error_message": "Target object not found: Scene/Canvas/Button",
    ...
}
```

**L2 错误归一化：**

**实现位置：** `sidecar/src/application/errorFeedback/mcpErrorFeedback.js`

```javascript
// 错误反馈归一化
function withMcpErrorFeedback(body) {
  const errorCode = normalizeErrorCode(body.error_code, "E_INTERNAL");
  const feedback = mapMcpErrorFeedback(errorCode, body.error_message);
  
  return {
    error_code: errorCode,
    error_message: feedback.message,
    suggestion: feedback.suggestion,      // 可操作建议
    retry_policy: feedback.retry_policy,   // 重试策略
    recoverable: feedback.recoverable,     // 是否可恢复
    ...
  };
}
```

**错误模板：**

**实现位置：** `sidecar/src/application/turnPolicies.js`

```javascript
const MCP_ERROR_FEEDBACK_TEMPLATES = {
  "E_STALE_SNAPSHOT": {
    recoverable: true,
    suggestion: "场景已变更，请重新获取 read_token 后重试",
  },
  "E_TARGET_NOT_FOUND": {
    recoverable: true,
    suggestion: "目标对象不存在，请检查 object_id 和 path 是否正确",
  },
  // ... 更多错误模板
};
```

**L2 → L1 错误反馈：**

```json
{
  "jsonrpc": "2.0",
  "id": "...",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "错误：E_TARGET_NOT_FOUND\n消息：Target object not found\n建议：请检查 object_id 和 path 是否正确\n可恢复：true"
      }
    ],
    "isError": true
  }
}
```

#### 4.3.3 异常处理流程

1. **L3 层异常捕获：**
   - Unity 执行器使用 `try-catch` 捕获异常
   - 转换为标准错误码和错误消息
   - 通过 HTTP 回调返回给 L2

2. **L2 层错误归一化：**
   - 接收 Unity 错误响应
   - 查找错误模板，生成友好建议
   - 确定重试策略和可恢复性
   - 返回给 L1

3. **L1 层错误展示：**
   - MCP Client 接收错误响应
   - 展示错误码、消息和建议
   - LLM 根据建议决定是否重试

#### 4.3.4 编译错误处理

**Unity 编译状态检测：**

```csharp
// ConversationController.cs
public bool IsEditorCompiling => EditorApplication.isCompiling;

// 编译中时拒绝写操作
if (IsEditorCompiling)
{
    return ErrorResult("E_SELECTION_UNAVAILABLE", "Unity is compiling");
}
```

**编译结果回调：**

```csharp
// Unity 编译完成后回调 Sidecar
POST /unity/compile/result
{
    "request_id": "...",
    "success": true/false,
    "errors": [...],
    ...
}
```

**注意：** 根据代码，`/unity/compile/result` 路由已被标记为废弃（`router.js:180`），但 Unity 端可能仍在使用。

---

## 5. 当前已知问题与痛点

### 5.1 Token 失效问题

**问题描述：**
- 写操作会改变 `scene_revision`，导致旧的 `read_token` 立即失效
- 多步操作时，第一步写操作后必须重新获取 token 才能继续
- 增加了不必要的往返通信

**影响：**
- 操作效率低
- 容易出错（忘记重新获取 token）
- 增加了 LLM 的认知负担

**相关代码：**
- `docs/MCP工具开发痛点记录.md`（痛点1）

### 5.2 新增工具开发流程繁琐

**问题描述：**
新增一个 MCP 工具需要多个手写步骤：

1. 在 `ssot/dictionary/tools.json` 添加工具定义
2. 运行 `npm run ssot:build` 生成 L2/L3 产物
3. 手写 `sidecar/src/mcp/commands/definitions/<tool>.js` 桥接文件
4. 手写 `sidecar/src/mcp/commands/<tool>/validator.js`（虽然可自动生成，但仍需手写文件）
5. 手写 `sidecar/src/mcp/commands/<tool>/handler.js`
6. 在 `sidecar/src/mcp/commands/commandDefinitionManifest.js` 手动添加导入
7. 重启服务

**问题分析：**
- 定义文件、Validator、Handler 都是高度模板化的代码（重复度 90%+）
- 只有工具名、HTTP 路径等字段不同
- 完全可以自动生成

**相关代码：**
- `docs/MCP工具开发痛点记录.md`（痛点2）
- `docs/MCP新增工具自动化开发方案-2026-03-06.md`

### 5.3 中心化注册耦合

**问题描述：**
- MCP Command 注册集中在单文件数组（`commands/index.js`）
- 工具可见性由白名单控制（`contracts.js`）
- 快照测试固定工具清单，新增命令必须同步

**影响：**
- 多人并行开发时冲突高
- 命令模块不能独立接入
- 容易漏改

**相关代码：**
- `docs/ARCHITECTURE_AUDIT.md`（F1 问题）

### 5.4 Legacy 兼容桥接未清理

**问题描述：**
- L2 → L3 内部桥接保留双栈兼容：
  - `legacy_marshaled_action_data`（优先）
  - `legacy_stringified_action_data`（回退）
- DTO 仍保留 legacy 字段
- 影响长期可维护性

**相关代码：**
- `docs/ARCHITECTURE_AUDIT.md`（F2 问题）
- `docs/PROJECT_ARCHITECTURE_GUIDE.md`（3.2 节）

### 5.5 错误码泛化兜底

**问题描述：**
- 多层 fallback 到通用错误码（如 `E_INTERNAL`）
- 排障粒度下降
- 错误信息不够友好

**相关代码：**
- `docs/ARCHITECTURE_AUDIT.md`（F3 问题）

### 5.6 Unity 主线程调用限制

**问题描述：**
- Unity Editor API 必须在主线程调用
- 所有异步操作需要通过 `SynchronizationContext` 调度
- 可能造成阻塞

**缓解措施：**
- 使用轮询机制而非阻塞等待
- 实现位置：`UnityRagQueryPollingBootstrap`

### 5.7 状态同步不一致风险

**问题描述：**
- L2 和 L3 之间的状态可能不同步
- OCC 机制通过 `scene_revision` 检测，但仍有时间窗口
- 写操作后 token 失效，但 LLM 可能继续使用旧 token

**相关代码：**
- `.cursorrules`（四、Token 与调用次数控制）

### 5.8 查询次数过多

**问题描述：**
- 需要多次查询才能获取完整信息
- 无法一次性获取所需的所有信息
- 增加了往返通信次数和延迟

**相关代码：**
- `docs/MCP工具开发痛点记录.md`（痛点3）

### 5.9 操作步骤繁琐

**问题描述：**
- 创建对象并设置属性需要：获取 token → 创建 → 获取新 token → 设置属性
- 步骤多，容易出错
- 虽然可以用事务工具，但需要先创建对象获取 object_id，无法完全在一个事务中完成

**相关代码：**
- `docs/MCP工具开发痛点记录.md`（痛点3）

### 5.10 响应延迟感知明显

**问题描述：**
- 每次调用都需要等待往返（MCP Client → Sidecar → Unity → 返回）
- 多个步骤串联时，总延迟累积明显
- 与写脚本的差异：脚本是"规划-执行"分离，MCP 是"规划-执行-等待-规划-执行"循环

**相关代码：**
- `docs/MCP工具开发痛点记录.md`（痛点3）

---

## 附录

### A. 关键文件索引

**L2 层关键文件：**
- MCP Server：`sidecar/src/mcp/mcpServer.js`
- HTTP Router：`sidecar/src/api/router.js`
- 命令注册表：`sidecar/src/mcp/commandRegistry.js`
- 任务编排：`sidecar/src/application/turnService.js`
- 错误反馈：`sidecar/src/application/errorFeedback/mcpErrorFeedback.js`

**L3 层关键文件：**
- 对话控制器：`Assets/Editor/Codex/Application/ConversationController.cs`
- 动作执行器：`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- 查询服务：`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
- HTTP 网关：`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`

**SSOT 关键文件：**
- 工具定义：`ssot/dictionary/tools.json`
- L2 生成产物：`ssot/artifacts/l2/mcp-tools.generated.json`
- L3 生成产物：`ssot/artifacts/l3/SsotDtos.generated.cs`

### B. 相关文档

- `docs/PROJECT_ARCHITECTURE_GUIDE.md`：项目架构指南
- `docs/ARCHITECTURE_AUDIT.md`：架构审计报告
- `docs/MCP工具开发痛点记录.md`：MCP 工具开发痛点
- `docs/MCP新增工具自动化开发方案-2026-03-06.md`：工具自动化开发方案
- `.cursorrules`：Cursor 执行规则

### C. 快速启动

**启动 Sidecar：**
```bash
cd sidecar
npm start
# 或
node index.js --port 46321
```

**Unity Editor：**
- 自动初始化（通过 `[InitializeOnLoad]`）
- 默认连接 `http://127.0.0.1:46321`

**MCP Client（Cursor）：**
- 通过 STDIO 启动 Sidecar
- 自动建立连接并获取工具列表

---

**文档结束**
