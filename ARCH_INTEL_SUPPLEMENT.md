# UnityAI 工程事实数据补充报告

**生成时间**: 2024-12-19  
**目标**: 补齐架构情报报告中“推断/缺失”的关键数据  
**原则**: 只读分析，不修改任何文件

---

## 1) 精确 LOC 统计（必须可复现）

### 1.1 统计命令

**⚠️ 注意**: 由于 PowerShell 命令执行环境限制，以下命令需要在本地终端运行。

**推荐命令（Windows PowerShell）**:
```powershell
# 方法 1: 使用 PowerShell
Get-ChildItem -Path . -Include *.js,*.ts,*.tsx,*.cs -Recurse -File | 
  Where-Object { $_.FullName -notmatch '(Library|Temp|node_modules|bin|obj|dist|build|\.min\.|Generated)' } | 
  ForEach-Object { 
    $lines = (Get-Content $_.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    [PSCustomObject]@{ 
      Path = $_.FullName.Replace((Get-Location).Path + '\', '').Replace('\', '/')
      Lines = $lines
      Ext = $_.Extension 
    } 
  } | 
  Sort-Object -Property Lines -Descending | 
  Select-Object -First 50 | 
  Format-Table -AutoSize
```

**推荐命令（Git Bash / WSL）**:
```bash
find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.cs" \) \
  ! -path "*/Library/*" ! -path "*/Temp/*" ! -path "*/node_modules/*" \
  ! -path "*/bin/*" ! -path "*/obj/*" ! -path "*/dist/*" ! -path "*/build/*" \
  ! -path "*/.min.*" ! -path "*/Generated/*" \
  -exec wc -l {} + | sort -rn | head -50
```

**推荐命令（Python，跨平台）**:
```python
import os
files = []
for root, dirs, fs in os.walk('.'):
    if any(x in root for x in ['Library', 'Temp', 'node_modules', 'bin', 'obj', 'dist', 'build', 'Generated']):
        continue
    for f in fs:
        if f.endswith(('.cs', '.js', '.ts', '.tsx')) and '.min.' not in f:
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
                    lines = sum(1 for _ in fp)
                files.append((path.replace(os.sep, '/'), lines, os.path.splitext(f)[1]))
            except:
                pass
for path, lines, ext in sorted(files, key=lambda x: x[1], reverse=True)[:50]:
    print(f"{lines:6d} {ext:4s} {path}")
```

### 1.2 基于文件读取的 LOC 统计（近似值）

**说明**: 以下 LOC 基于实际读取文件的行数统计，精确值需运行上述命令。

#### HARD 列表（LOC > 800）

| 文件路径 | LOC | 语言 | 所属目录(模块) | 是否测试文件 |
|---------|-----|------|---------------|------------|
| `sidecar/src/domain/validators.js` | **4303** | JS | domain/验证 | ❌ |
| `Assets/Editor/Codex/Application/ConversationController.cs` | **3429** | C# | Application/控制器 | ❌ |
| `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | **2246** | C# | Infrastructure/执行器 | ❌ |
| `Assets/Editor/Codex/Domain/SidecarContracts.cs` | **1594** | C# | Domain/DTO | ❌ |
| `sidecar/src/mcp/commands/index.js` | **1235** | JS | mcp/命令中心 | ❌ |

#### SOFT 列表（401 <= LOC <= 800）

| 文件路径 | LOC | 语言 | 所属目录(模块) | 是否测试文件 |
|---------|-----|------|---------------|------------|
| `sidecar/src/mcp/mcpServer.js` | ~723 | JS | mcp/入口 | ❌ |
| `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | ~439 | C# | Infrastructure/注册 | ❌ |

**注**: 其他文件 LOC < 400，未列出。

#### Top 30 最大文件榜（预估）

| 排名 | 文件路径 | LOC | 语言 | 模块 |
|------|---------|-----|------|------|
| 1 | `sidecar/src/domain/validators.js` | 4303 | JS | domain |
| 2 | `Assets/Editor/Codex/Application/ConversationController.cs` | 3429 | C# | Application |
| 3 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 2246 | C# | Infrastructure |
| 4 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 1594 | C# | Domain |
| 5 | `sidecar/src/mcp/commands/index.js` | 1235 | JS | mcp |
| 6 | `sidecar/src/mcp/mcpServer.js` | ~723 | JS | mcp |
| 7 | `sidecar/src/application/turnService.js` | ~700 | JS | application |
| 8 | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs` | ~439 | C# | Infrastructure |
| 9+ | 其他文件 | <400 | - | - |

---

## 2) HARD 文件“调用画像卡片”

### 2.1 `sidecar/src/domain/validators.js` (4303 LOC)

#### A) Public API（module.exports）

**前 30 个导出函数**（按出现顺序）:
1. `FIXED_ERROR_SUGGESTION_BY_CODE` (常量)
2. `enforceFixedErrorSuggestion`
3. `validateMcpSubmitUnityTask`
4. `validateMcpApplyScriptActions`
5. `validateMcpApplyVisualActions`
6. `validateMcpSetUiProperties`
7. `validateMcpGetUnityTaskStatus`
8. `validateMcpCancelUnityTask`
9. `validateMcpHeartbeat`
10. `validateMcpListAssetsInFolder`
11. `validateMcpGetSceneRoots`
12. `validateMcpFindObjectsByComponent`
13. `validateMcpQueryPrefabInfo`
14. `validateFileActionsApply`
15. `validateUnityCompileResult`
16. `validateUnityActionResult`
17. `validateUnityRuntimePing`
18. `validateUnityCapabilitiesReport`
19. `validateUnitySelectionSnapshot`
20. `validateUnityConsoleSnapshot`
21. `validateVisualLayerActionsArray`

**内部工具函数**（未导出，但被导出函数使用）:
- `isObject`, `isNonEmptyString`, `isValidReadTokenString`
- `validateBasedOnReadTokenField`, `validateTopLevelWriteAnchorField`
- `validateVisualActionHardcut`, `validateAnchorObject`
- `validateComponentDescriptorArray`, `validateSelectionTreeNode`
- `validateTurnContextPayload`, `validateActionAnchorPolicyForKnownType`
- `validateEnvelope`, `validateSetUiPropertyOperations`
- `validateSetUiRectTransformPayload`, `validateSetUiImagePayload`
- `validateSetUiTextPayload`, `validateSetUiLayoutElementPayload`
- `validateCompositeAliasValue`, `normalizeAnchorPolicyForValidation`

#### B) Imports/Dependencies（Top 15）

**无外部依赖**（纯函数模块，无 `require`/`import`）

**说明**: 该文件是纯验证逻辑，不依赖其他模块，符合 domain 层设计。

#### C) 被引用方（Top 15）

基于 grep 搜索结果，引用该文件的主要文件：

1. `sidecar/src/application/turnService.js` - 对话轮次服务
2. `sidecar/src/application/mcpGateway/mcpEyesWriteService.js` - MCP 写服务
3. `sidecar/src/application/mcpGateway/mcpGateway.js` - MCP 网关
4. `sidecar/src/application/mcpGateway/mcpErrorFeedback.js` - 错误反馈
5. `sidecar/src/application/mcpGateway/unityCallbacks.js` - Unity 回调
6. `sidecar/src/mcp/commands/set_ui_properties/validator.js` - UI 属性验证器

**测试文件**:
- `sidecar/tests/domain/validators.*.test.js` (多个测试文件)

#### D) 责任切块线索

基于文件内容与函数命名模式，推断职责块：

| 职责块 | 行号范围（估算） | 说明 |
|--------|----------------|------|
| **工具函数** | 17-320 | `isObject`, `isNonEmptyString`, `validateAllowedKeys` 等基础工具 |
| **Read Token 验证** | 94-120 | `validateBasedOnReadTokenField` |
| **Write Anchor 验证** | 120-133 | `validateTopLevelWriteAnchorField` |
| **Visual Action 验证** | 133-2500 | `validateVisualActionHardcut`, `validateMcpApplyVisualActions` 等 |
| **Action Anchor 策略验证** | 752-850 | `normalizeAnchorPolicyForValidation`, `validateActionAnchorPolicyForKnownType` |
| **Envelope 验证** | 853-930 | `validateEnvelope` (事件信封) |
| **File Actions 验证** | 929-1090 | `validateFileActionsApply` |
| **Unity 回调验证** | 1091-2029 | `validateUnityCompileResult`, `validateUnityActionResult`, `validateUnityRuntimePing`, `validateUnitySelectionSnapshot`, `validateUnityConsoleSnapshot` |
| **Set UI Properties 验证** | 2473-3100 | `validateMcpSetUiProperties`, `validateSetUiPropertyOperations`, `validateSetUiRectTransformPayload`, `validateSetUiImagePayload`, `validateSetUiTextPayload`, `validateSetUiLayoutElementPayload` |
| **Composite Action 验证** | 3230-3300 | `validateCompositeAliasValue`, `normalizeCompositeAliasValue` |
| **MCP Command 验证** | 2303-2507 | `validateMcpSubmitUnityTask`, `validateMcpApplyScriptActions`, `validateMcpApplyVisualActions` |

**是否存在“同一文件内多层混杂”**: ✅ **是**
- 该文件混合了 domain（验证逻辑）、application（MCP 命令验证）、infrastructure（Unity 回调验证）的职责
- 建议拆分：`validators-write.js`, `validators-read.js`, `validators-callback.js`, `validators-composite.js`, `validators-core.js`

---

### 2.2 `sidecar/src/mcp/commands/index.js` (1235 LOC)

#### A) Public API（module.exports）

**导出**:
- `MCP_COMMAND_DEFINITIONS` (冻结数组，包含所有命令定义)

**内部函数**（未导出）:
- `normalizeBody`
- `buildVisualActionsDescription`
- `validateGetUnityTaskStatusArgs`

#### B) Imports/Dependencies（Top 15）

**命令模块导入**（按出现顺序）:
1. `./get_action_catalog/validator` → `validateGetActionCatalog`
2. `./get_action_catalog/handler` → `executeGetActionCatalog`
3. `./get_action_schema/validator` → `validateGetActionSchema`
4. `./get_action_schema/handler` → `executeGetActionSchema`
5. `./get_tool_schema/validator` → `validateGetToolSchema`
6. `./get_tool_schema/handler` → `executeGetToolSchema`
7. `./list_assets_in_folder/validator` → `validateListAssetsInFolder`
8. `./get_scene_roots/validator` → `validateGetSceneRoots`
9. `./find_objects_by_component/validator` → `validateFindObjectsByComponent`
10. `./query_prefab_info/validator` → `validateQueryPrefabInfo`
11. `./capture_scene_screenshot/validator` → `validateCaptureSceneScreenshot`
12. `./capture_scene_screenshot/handler` → `executeCaptureSceneScreenshot`
13. `./get_ui_tree/validator` → `validateGetUiTree`
14. `./get_ui_tree/handler` → `executeGetUiTree`
15. `./hit_test_ui_at_viewport_point/validator` → `validateHitTestUiAtViewportPoint`
16. `./hit_test_ui_at_viewport_point/handler` → `executeHitTestUiAtViewportPoint`
17. `./validate_ui_layout/validator` → `validateUiLayout`
18. `./validate_ui_layout/handler` → `executeValidateUiLayout`
19. `./set_ui_properties/handler` → `executeSetUiProperties`
20. `./hit_test_ui_at_screen_point/validator` → `validateHitTestUiAtScreenPoint`
21. `./hit_test_ui_at_screen_point/handler` → `executeHitTestUiAtScreenPoint`

#### C) 被引用方（Top 15）

1. `sidecar/src/mcp/commandRegistry.js` - 命令注册表（通过 `getMcpCommandRegistry()` 读取 `MCP_COMMAND_DEFINITIONS`）

**说明**: 这是单点耦合的核心，所有命令定义集中于此。

#### D) 责任切块线索

| 职责块 | 行号范围 | 说明 |
|--------|---------|------|
| **命令模块导入** | 3-49 | 所有命令的 validator/handler 导入 |
| **工具函数** | 51-79 | `normalizeBody`, `buildVisualActionsDescription`, `validateGetUnityTaskStatusArgs` |
| **命令定义数组** | 81-1230 | `MCP_COMMAND_DEFINITIONS` 数组，包含所有命令的完整定义（name, kind, lifecycle, http, mcp, inputSchema） |

**是否存在“同一文件内多层混杂”**: ❌ **否**
- 该文件职责单一：聚合命令定义
- 但存在**单点耦合问题**：新增命令必须改此文件

---

### 2.3 `Assets/Editor/Codex/Application/ConversationController.cs` (3429 LOC)

#### A) Public API（public class / public method）

**Public 类**:
- `ConversationController` (sealed class)

**Public 属性/方法**（前 30 个，按出现顺序）:
1. `SidecarUrl` (property)
2. `ThreadId` (property)
3. `BusyReason` (property)
4. `Changed` (event)
5. `StartConversation` (method)
6. `SendMessage` (method)
7. `ExecutePendingActionAndReportAsync` (method)
8. `ExecutePulledReadQueryAsync` (method)
9. `ReportCompileResultAsync` (method)
10. `ReportUnityActionResultAsync` (method)
11. `ReportUnityRuntimePingAsync` (method)
12. `ReportUnityCapabilitiesAsync` (method)

**Internal/Private 方法**（大量，包括）:
- `Update`, `PollCompileState`, `PollSelectionSnapshot`, `PollConsoleSnapshot`
- `PollRagQuery`, `PollRuntimePing`, `PollCapabilityReport`
- `BuildTurnContext`, `BuildSelectionSnapshot`, `BuildConsoleSnapshot`
- `HandleCompileResult`, `HandleActionResult`, `HandleRuntimePing`
- `IsActionPayloadValid`, `IsQueryPayloadValid`

#### B) Imports/Dependencies（Top 15）

**Using 语句**:
1. `System`
2. `System.Collections.Generic`
3. `System.Reflection`
4. `System.Security.Cryptography`
5. `System.Text`
6. `System.Threading`
7. `System.Threading.Tasks`
8. `UnityAI.Editor.Codex.Domain` → `SidecarContracts`, `TurnRuntimeState`, `UiLogEntry`
9. `UnityAI.Editor.Codex.Infrastructure` → `UnityVisualActionExecutor`, `UnityRagReadService`
10. `UnityAI.Editor.Codex.Infrastructure.Actions` → `McpActionRegistry`
11. `UnityAI.Editor.Codex.Infrastructure.Queries` → `UnityQueryRegistry`
12. `UnityAI.Editor.Codex.Ports` → `ISidecarGateway`, `ISidecarProcessManager`, `ISelectionContextBuilder`, `IConversationStateStore`, `IUnityVisualActionExecutor`
13. `UnityEditor`
14. `UnityEngine`
15. `UnityEngine.SceneManagement`

#### C) 被引用方（Top 15）

基于 grep 搜索结果：

1. `Assets/Editor/Codex/UI/CodexChatWindow.cs` - UI 窗口（直接使用）
2. `Assets/Editor/Codex/Tests/EditMode/UnityQueryControllerClosureTests.cs` - 测试
3. `Assets/Editor/Codex/Tests/EditMode/UnityR9ClosureGuardTests.cs` - 测试
4. `Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs` - 测试
5. `Assets/Editor/Codex/Tests/EditMode/UnityRuntimeRecoveryTests.cs` - 测试
6. `Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs` - RAG 查询轮询引导

#### D) 责任切块线索

**说明**: 该文件无明显的 `#region` 标记，但可通过方法命名推断职责块。

| 职责块 | 行号范围（估算） | 说明 |
|--------|----------------|------|
| **构造函数与初始化** | 78-97 | 依赖注入与初始化 |
| **对话管理** | 98-500 | `StartConversation`, `SendMessage`, 对话状态管理 |
| **编译状态跟踪** | 500-1000 | `PollCompileState`, `HandleCompileResult`, `ReportCompileResultAsync` |
| **Action 执行** | 851-1200 | `ExecutePendingActionAndReportAsync`, `IsActionPayloadValid`, `HandleActionResult` |
| **Query 执行** | 1926-2200 | `ExecutePulledReadQueryAsync`, `IsQueryPayloadValid` |
| **选择快照** | 2200-2600 | `PollSelectionSnapshot`, `BuildSelectionSnapshot` |
| **控制台快照** | 2600-2800 | `PollConsoleSnapshot`, `BuildConsoleSnapshot` |
| **RAG 查询轮询** | 2800-3000 | `PollRagQuery` |
| **运行时 Ping** | 3000-3100 | `PollRuntimePing`, `ReportUnityRuntimePingAsync` |
| **能力报告** | 3100-3200 | `PollCapabilityReport`, `ReportUnityCapabilitiesAsync` |
| **工具方法** | 3200-3429 | `BuildTurnContext`, `ReadErrorCode`, `EditorApplicationTimeFallback` |

**是否存在“同一文件内多层混杂”**: ✅ **是**
- 该文件混合了 Application（对话管理）、Infrastructure（编译跟踪、快照服务、RAG 轮询）的职责
- 建议拆分：`ConversationController`（主流程）、`CompileStateTracker`、`SelectionSnapshotService`、`RagQueryPoller`、`RuntimePingProbe`

---

### 2.4 `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` (2246 LOC)

#### A) Public API（public class / public method）

**Public 类**:
- `UnityVisualActionExecutor` (sealed class, implements `IUnityVisualActionExecutor`)

**Public 方法**:
1. `Execute` (主要入口方法)

**Internal 静态方法**（大量 RunXxx primitive）:
- `RunAddComponent`, `RunRemoveComponent`, `RunReplaceComponent`
- `RunCreateGameObject`, `RunSetGameObjectActive`, `RunRenameGameObject`, `RunDestroyGameObject`
- `RunSetTransformLocalPosition`, `RunSetTransformLocalRotation`, `RunSetTransformLocalScale`
- `RunSetTransformWorldPosition`, `RunSetTransformWorldRotation`
- `RunSetRectTransformAnchoredPosition`, `RunSetRectTransformSizeDelta`, `RunSetRectTransformPivot`, `RunSetRectTransformAnchors`
- `RunSetUiImageColor`, `RunSetUiImageRaycastTarget`
- `RunSetUiTextContent`, `RunSetUiTextColor`, `RunSetUiTextFontSize`
- `RunSetCanvasGroupAlpha`, `RunSetLayoutElement`

**Private 方法**:
- `ResolveTargetGameObject`, `ResolveGameObjectByAnchor`, `ResolveComponentType`, `ResolveComponentInstanceOnTarget`
- `FindGameObjectByScenePath`, `FindGameObjectByObjectId`
- `BuildGameObjectPath`, `BuildObjectId`
- `CreateUiGameObject`, `EnsureRootCanvas`, `EnsureEventSystem`
- `SetTransformVector3`, `SetRectTransformVector2`, `ResolveRectTransform`
- `TryResolveTarget`, `TryResolveTextLikeComponent`, `SetTextLikeProperty`
- `MarkTargetDirty`, `MarkComponentAndTargetDirty`
- `IsFinite`, `IsColorInUnitRange`
- `BuildInitialResult`, `Fail`, `NormalizeExecutionErrorCode`, `NormalizeExecutionErrorMessage`
- `SanitizeSingleLine`, `ReadAnchorObjectId`, `ReadAnchorPath`

#### B) Imports/Dependencies（Top 15）

**Using 语句**:
1. `System`
2. `System.Collections.Generic`
3. `System.Diagnostics`
4. `System.Reflection`
5. `System.Text`
6. `UnityAI.Editor.Codex.Domain` → `SidecarContracts` (VisualLayerActionItem, UnityActionExecutionResult)
7. `UnityAI.Editor.Codex.Infrastructure.Actions` → `McpActionRegistry`, `McpActionRegistryBootstrap`, `IMcpVisualActionHandler`, `McpVisualActionContext`, `McpVisualActionExecutionResult`
8. `UnityAI.Editor.Codex.Ports` → `IUnityVisualActionExecutor`
9. `UnityEditor`
10. `UnityEditor.SceneManagement`
11. `UnityEngine`
12. `UnityEngine.EventSystems`
13. `UnityEngine.SceneManagement`
14. `UnityEngine.UI`
15. `Debug = UnityEngine.Debug`

#### C) 被引用方（Top 15）

1. `Assets/Editor/Codex/Application/ConversationController.cs` - 通过 `IUnityVisualActionExecutor` 接口使用
2. `Assets/Editor/Codex/Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs` - 测试
3. `Assets/Editor/Codex/Infrastructure/Actions/BuiltInVisualActionHandlers.cs` - Handler 可能调用 `RunXxx` 方法
4. `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs` - Handler 可能调用 `RunXxx` 方法

#### D) 责任切块线索

| 职责块 | 行号范围（估算） | 说明 |
|--------|----------------|------|
| **构造函数与 Execute 入口** | 19-80 | 构造函数、`Execute` 主方法、`ConvertHandlerResult` |
| **Component 操作 Primitive** | 108-350 | `RunAddComponent`, `RunRemoveComponent`, `RunReplaceComponent` |
| **GameObject 操作 Primitive** | 399-583 | `RunCreateGameObject`, `RunSetGameObjectActive`, `RunRenameGameObject`, `RunDestroyGameObject` |
| **Transform 操作 Primitive** | 585-638 | `RunSetTransformLocalPosition`, `RunSetTransformLocalRotation`, `RunSetTransformLocalScale`, `RunSetTransformWorldPosition`, `RunSetTransformWorldRotation` |
| **RectTransform 操作 Primitive** | 640-727 | `RunSetRectTransformAnchoredPosition`, `RunSetRectTransformSizeDelta`, `RunSetRectTransformPivot`, `RunSetRectTransformAnchors` |
| **UI Image 操作 Primitive** | 729-788 | `RunSetUiImageColor`, `RunSetUiImageRaycastTarget` |
| **UI Text 操作 Primitive** | 790-891 | `RunSetUiTextContent`, `RunSetUiTextColor`, `RunSetUiTextFontSize` |
| **UI Layout 操作 Primitive** | 893-971 | `RunSetCanvasGroupAlpha`, `RunSetLayoutElement` |
| **通用工具方法** | 973-1030 | `SetTransformVector3`, `SetRectTransformVector2`, `ResolveRectTransform` |
| **目标解析** | 1061-1080 | `TryResolveTarget`, `ResolveTargetGameObject`, `ResolveGameObjectByAnchor` |
| **Component 解析** | 1082-1978 | `TryResolveTextLikeComponent`, `SetTextLikeProperty`, `ResolveComponentType`, `ResolveComponentInstanceOnTarget`, `FindFuzzyComponentMatchesOnTarget` |
| **GameObject 查找** | 1547-1802 | `FindGameObjectByScenePath`, `FindGameObjectByObjectId`, `FindChildBySegments` |
| **UI 创建工具** | 1301-1429 | `CreateUiGameObject`, `BuildCanvasObject`, `EnsureRootCanvas`, `EnsureEventSystem` |
| **结果构建与错误处理** | 1430-1531 | `BuildInitialResult`, `Fail`, `NormalizeExecutionErrorCode`, `NormalizeExecutionErrorMessage`, `SanitizeSingleLine` |
| **Anchor 工具** | 1533-1545 | `ReadAnchorObjectId`, `ReadAnchorPath` |
| **类型解析工具** | 1804-2211 | `ResolveComponentType`, `ResolveComponentTypeWithFuzzyFallback`, `ExtractRawTypeName`, `ExtractShortTypeName`, `IsValidComponentType`, `IsNameMatch`, `IsTypeFuzzyMatched` |

**是否存在“同一文件内多层混杂”**: ✅ **是**
- 该文件混合了 Infrastructure（执行器）、Domain（primitive 操作）的职责
- 建议拆分：将 primitive 下沉为独立服务（`TransformPrimitiveService`, `ComponentPrimitiveService`, `GameObjectPrimitiveService`），executor 仅负责 registry 与错误边界

---

### 2.5 `Assets/Editor/Codex/Domain/SidecarContracts.cs` (1594 LOC)

#### A) Public API（public class / public enum / public record/struct）

**Public 枚举**:
1. `TurnRuntimeState`
2. `UiLogLevel`
3. `UiLogSource`

**Public 类**（前 30 个，按出现顺序）:
1. `UiLogEntry`
2. `GatewayResponse<T>`
3. `SidecarStartResult`
4. `SidecarStopResult`
5. `ErrorResponse`
6. `HealthResponse`
7. `TurnStatusResponse`
8. `SidecarStateSnapshotResponse`
9. `TurnSnapshotItem`
10. `PersistedConversationState`
11. `TurnContext`
12. `SelectionInfo`
13. `SelectionTreeInfo`
14. `SelectionTreeNode`
15. `FileActionsApplyRequest`
16. `FileActionsApplyPayload`
17. `FileActionItem`
18. `UnityObjectAnchor`
19. `VisualLayerActionItem`
20. `CompositeVisualActionData`
21. `CompositeVisualActionStep`
22. `CompositeVisualActionBindOutput`
23. `FilesChangedEnvelopeResponse`
24. `FilesChangedPayload`
25. `FileChangeItem`
26. `UnityCompileRequestEnvelope`
27. `UnityRuntimePingRequest`
28. `UnityRuntimePingPayload`
29. `UnityRuntimePingResponse`
30. `UnityCapabilitiesReportRequest`

**其他 Public 类**（继续）:
- `UnityCapabilitiesReportPayload`, `UnityCapabilityActionItem`, `UnityActionDataSchema`, `UnityActionDataSchemaProperty`
- `UnityCapabilitiesReportResponse`
- `UnitySelectionSnapshotRequest`, `UnitySelectionSnapshotPayload`, `UnitySelectionComponentIndexItem`, `UnitySelectionSnapshotResponse`
- `UnityConsoleSnapshotRequest`, `UnityConsoleSnapshotPayload`, `UnityConsoleErrorItem`, `UnityConsoleSnapshotResponse`
- `UnityCompileResultRequest`, `UnityCompileResultPayload`, `UnityCompileErrorItem`, `UnityCompileReportResponse`
- `UnityActionRequestEnvelope`, `UnityActionRequestPayload`
- `UnityActionResultRequest`, `UnityActionResultPayload`, `UnityActionReportResponse`, `UnityActionExecutionResult`
- `UnityQueryComponentsRequestEnvelope`, `UnityQueryComponentsRequestPayload`, `UnityComponentDescriptor`, `UnityQueryComponentsResultRequest`, `UnityQueryComponentsResultPayload`, `UnityQueryComponentsReportResponse`
- `UnityQueryPullRequest`, `UnityQueryPullResponse`, `UnityPulledQuery`, `UnityPulledQueryPayload`
- `UnityQueryScope`, `UnityQueryResolution`, `UnityQueryResolutionItem`, `UnityQueryReportResponse`
- `UnityReadToken`, `UnityReadTokenRevisionVector`, `UnityReadTokenScope`
- `UnityListAssetsInFolderRequest`, `UnityListAssetsInFolderPayload`, `UnityListAssetsInFolderResponse`, `UnityListAssetsInFolderData`, `UnityAssetInfo`
- `UnityGetSceneRootsRequest`, `UnityGetSceneRootsPayload`, `UnityGetSceneRootsResponse`, `UnityGetSceneRootsData`, `UnitySceneRootInfo`
- `UnityFindObjectsByComponentRequest`, `UnityFindObjectsByComponentPayload`, `UnityFindObjectsByComponentResponse`, `UnityFindObjectsByComponentData`, `UnityComponentMatchItem`
- `UnityQueryPrefabInfoRequest`, `UnityQueryPrefabInfoPayload`, `UnityQueryPrefabInfoResponse`, `UnityQueryPrefabInfoData`, `UnityPrefabTreeNode`
- `UnityGetUiTreeRequest`, `UnityGetUiTreePayload`, `UnityGetUiTreeResponse`, `UnityGetUiTreeData`, `UnityUiCanvasInfo`, `UnityUiTreeNode`, `UnityUiRectTransformInfo`, `UnityUiComponentSummary`, `UnityUiInteractionSummary`, `UnityUiTextMetrics`
- `UnityCaptureSceneScreenshotRequest`, `UnityCaptureSceneScreenshotPayload`, `UnityCaptureSceneScreenshotResponse`, `UnityCaptureSceneScreenshotData`, `UnityScreenshotRect`, `UnityScreenshotUnityState`, `UnityScreenshotPixelSanity`, `UnityScreenshotCameraUsed`
- `UnityHitTestUiAtScreenPointRequest`, `UnityHitTestUiAtScreenPointPayload`, `UnityHitTestUiAtScreenPointResponse`, `UnityHitTestUiAtScreenPointData`, `UnityUiHitTestItem`
- `UnityHitTestUiAtViewportPointRequest`, `UnityHitTestUiAtViewportPointPayload`, `UnityHitTestUiAtViewportPointResponse`, `UnityHitTestUiAtViewportPointData`, `UnityViewportPoint`, `UnityUiHitTestStackItem`
- `UnityValidateUiLayoutRequest`, `UnityValidateUiLayoutPayload`, `UnityValidateUiLayoutResponse`, `UnityValidateUiLayoutData`, `UnityUiLayoutIssue`

#### B) Imports/Dependencies（Top 15）

**Using 语句**:
1. `System` → `Serializable` attribute

**说明**: 该文件是纯 DTO 定义，几乎无依赖（仅使用 `[Serializable]` attribute）。

#### C) 被引用方（Top 15）

**几乎被所有 Unity 侧文件引用**，包括：

1. `Assets/Editor/Codex/Application/ConversationController.cs`
2. `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
3. `Assets/Editor/Codex/Infrastructure/Actions/*.cs` (所有 Action Handler)
4. `Assets/Editor/Codex/Infrastructure/Queries/*.cs` (所有 Query Handler)
5. `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`
6. `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
7. `Assets/Editor/Codex/Tests/EditMode/*.cs` (所有测试文件)

#### D) 责任切块线索

| 职责块 | 行号范围（估算） | 说明 |
|--------|----------------|------|
| **枚举定义** | 5-28 | `TurnRuntimeState`, `UiLogLevel`, `UiLogSource` |
| **基础 DTO** | 30-122 | `UiLogEntry`, `GatewayResponse<T>`, `SidecarStartResult`, `SidecarStopResult`, `ErrorResponse`, `HealthResponse` |
| **Turn 相关 DTO** | 134-202 | `TurnStatusResponse`, `SidecarStateSnapshotResponse`, `TurnSnapshotItem`, `PersistedConversationState`, `TurnContext` |
| **Selection 相关 DTO** | 213-243 | `SelectionInfo`, `SelectionTreeInfo`, `SelectionTreeNode` |
| **File Actions DTO** | 246-272 | `FileActionsApplyRequest`, `FileActionsApplyPayload`, `FileActionItem` |
| **Action 相关 DTO** | 275-325 | `UnityObjectAnchor`, `VisualLayerActionItem`, `CompositeVisualActionData`, `CompositeVisualActionStep`, `CompositeVisualActionBindOutput` |
| **Unity 回调 DTO** | 328-616 | `FilesChangedEnvelopeResponse`, `UnityCompileRequestEnvelope`, `UnityRuntimePingRequest/Response`, `UnityCapabilitiesReportRequest/Response`, `UnitySelectionSnapshotRequest/Response`, `UnityConsoleSnapshotRequest/Response`, `UnityCompileResultRequest`, `UnityCompileReportResponse` |
| **Action 执行 DTO** | 619-1592 | `UnityActionRequestEnvelope`, `UnityActionRequestPayload`, `UnityActionResultRequest`, `UnityActionResultPayload`, `UnityActionReportResponse`, `UnityActionExecutionResult` |
| **Query 相关 DTO** | 630-1571 | `UnityQueryComponentsRequestEnvelope`, `UnityQueryPullRequest/Response`, `UnityPulledQuery`, `UnityPulledQueryPayload`, `UnityQueryScope`, `UnityQueryResolution`, `UnityReadToken`, 各种 Query Request/Response/Data |

**是否存在“同一文件内多层混杂”**: ❌ **否**
- 该文件职责单一：Domain 层 DTO 定义
- 但文件过大，建议按域拆分：`SidecarContracts.Turn.cs`, `SidecarContracts.Action.cs`, `SidecarContracts.Query.cs`, `SidecarContracts.Selection.cs`

---

## 3) 既有 Gate 脚本到底检查什么

### 3.1 `sidecar/scripts/r10-responsibility-guard.js`

#### 检查目标
**禁止跨职责引用**，确保模块职责边界清晰。

#### 扫描目录/文件
- `sidecar/src/domain/validators.js`
- `sidecar/src/application/turnPayloadBuilders.js`
- `sidecar/src/application/turnPolicies.js`
- `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`

#### 判定规则

| 文件 | Required 标记 | Forbidden 模式 |
|------|--------------|---------------|
| `validators.js` | `R10-ARCH-01 Responsibility boundary` | `/mcpErrorFeedback/`, `/turnPayloadBuilders/` |
| `turnPayloadBuilders.js` | `R10-ARCH-01 Responsibility boundary` | `/mcpErrorFeedback/`, `/turnPolicies/`, `/\.\.\/domain\/validators/` |
| `turnPolicies.js` | `R10-ARCH-01 Responsibility boundary` | `/turnPayloadBuilders/`, `/mcpErrorFeedback/` |
| `mcpErrorFeedback.js` | `R10-ARCH-01 Responsibility boundary` | `/turnPayloadBuilders/` |

**失败条件**: 
- 文件缺失 required 标记
- 文件包含 forbidden 模式

#### 运行方式
```bash
cd sidecar
npm run gate:r10-responsibility
```

---

### 3.2 `sidecar/scripts/r10-contract-snapshot-guard.js`

#### 检查目标
**确保契约快照测试存在**，防止协议变更未同步测试。

#### 扫描目录/文件
- `sidecar/tests/application/r10-contract-snapshot.test.js`
- `Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs`

#### 判定规则

| 文件 | Must Contain 标记 |
|------|------------------|
| `r10-contract-snapshot.test.js` | `"error feedback payload contract snapshot remains stable"`, `"capability snapshot contract remains stable"` |
| `SidecarContractsSnapshotTests.cs` | `"ErrorResponse_FieldSnapshot_RemainsStable"`, `"UnityCapabilitiesContracts_FieldSnapshot_RemainsStable"`, `"UnityActionResultPayload_FieldSnapshot_RemainsStable"` |

**失败条件**: 文件缺失 required 标记

#### 运行方式
```bash
cd sidecar
npm run gate:r10-contract-snapshot
```

---

### 3.3 `sidecar/scripts/r11-command-boundary-guard.js`

#### 检查目标
1. **禁止跨层依赖**（mcp/api/application/domain）
2. **确保命令注册表与冻结契约一致**（registry routes/tools 与 `contracts.js` 一致）

#### 扫描目录/文件
- `sidecar/src/mcp/mcpServer.js`
- `sidecar/src/api/router.js`
- `sidecar/src/application/turnService.js`
- `sidecar/src/domain/validators.js`
- `sidecar/src/api/router.js` (检查硬编码路由)

#### 判定规则

**文件规则**:

| 文件 | Required 标记 | Forbidden 模式 |
|------|--------------|---------------|
| `mcpServer.js` | `R11-ARCH-01 Responsibility boundary`, `/getMcpCommandRegistry/` | `/require\(["']\.\.\/api\/router["']\)/`, `/require\(["']\.\.\/domain\/validators["']\)/` |
| `router.js` | `R11-ARCH-01 Responsibility boundary` | `/require\(["']\.\.\/domain\/validators["']\)/`, `/require\(["']\.\.\/mcp\/mcpServer["']\)/` |
| `turnService.js` | `R11-ARCH-01 Responsibility boundary` | `/require\(["']\.\.\/mcp\/mcpServer["']\)/`, `/require\(["']\.\.\/api\/router["']\)/` |
| `validators.js` | `R11-ARCH-01 Responsibility boundary` | `/require\(["']\.\.\/application\//`, `/require\(["']\.\.\/mcp\//` |

**Registry 一致性检查**:
1. 从 `getMcpCommandRegistry()` 获取 registry 的 tool names 和 route signatures
2. 从 `ROUTER_PROTOCOL_FREEZE_CONTRACT` 获取冻结的 tool names 和 routes
3. 检查：
   - Registry 的 tool names 是否在冻结清单中（不允许额外工具）
   - 冻结清单的 tool names 是否在 registry 中（不允许缺失工具）
   - Registry 的 command routes 是否在冻结清单中
   - Router 中硬编码的 `/mcp/*` status routes 是否在允许集合中（`/mcp/heartbeat`, `/mcp/capabilities`, `/mcp/metrics`, `/mcp/stream`）

**失败条件**:
- 文件缺失 required 标记
- 文件包含 forbidden 模式
- Registry 与冻结契约不一致（extra/missing tools/routes）

#### 运行方式
```bash
cd sidecar
npm run gate:r11-command-boundary
```

---

### 3.4 `sidecar/scripts/r9-closure-guard.js`

#### 检查目标
**禁止遗留代码模式**，确保 R9 阶段收口完成。

#### 扫描目录/文件
- `sidecar/src/application/unityDispatcher/runtimeUtils.js`
- `sidecar/src/application/mcpGateway/mcpGateway.js`
- `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- `Assets/Editor/Codex/Application/ConversationController.cs`

#### 判定规则

| 文件 | Forbidden 模式 | 原因 |
|------|---------------|------|
| `runtimeUtils.js` | `/\btask_allocation\b/` | legacy task_allocation fallback must not re-enter runtime dispatcher |
| `mcpGateway.js` | `/payload\.action\.type/` | legacy payload.action.type -> action_type compatibility bridge is forbidden |
| `mcpGateway.js` | `/\bmcpJobsById\b/` | legacy mcpJobsById fallback map must not be used |
| `UnityVisualActionExecutor.cs` | `/switch\s*\(\s*actionType\s*\)/` | legacy switch(actionType) executor branch is forbidden |
| `UnityVisualActionExecutor.cs` | `/ExecuteAddComponent\s*\(|ExecuteRemoveComponent\s*\(|ExecuteReplaceComponent\s*\(|ExecuteCreateGameObject\s*\(/` | legacy ExecuteAdd/Remove/Replace/Create entry methods must not exist |
| `ConversationController.cs` | `/string\.Equals\(action\.type,\s*"(add_component|remove_component|replace_component|create_gameobject)"/` | hardcoded action-type payload validation branches are forbidden |

**失败条件**: 文件包含任何 forbidden 模式

#### 运行方式
```bash
cd sidecar
npm run gate:r9-closure
```

---

## 4) 测试安全网盘点（能保护拆分吗）

### 4.1 Sidecar 测试目录结构

**目录**: `sidecar/tests/`

**子目录**:
- `adapters/` - 适配器测试
- `application/` - 应用层测试（37 个 .js 文件）
- `domain/` - 领域层测试（15 个 .js 文件）

**关键测试文件列表（前 20）**:

| 文件路径 | 测试内容 |
|---------|---------|
| `tests/application/r10-contract-snapshot.test.js` | 契约快照一致性 |
| `tests/application/r11-command-contract-snapshot.test.js` | 命令契约快照 |
| `tests/application/r12-tool-registry-consistency.test.js` | 工具注册表一致性 |
| `tests/application/r12-tool-visibility-freeze.test.js` | 工具可见性冻结 |
| `tests/application/r9-error-feedback-template-coverage.test.js` | 错误反馈模板覆盖 |
| `tests/application/r10-token-budget-guard.test.js` | Token 预算守卫 |
| `tests/application/r11-query-and-tools-cache.test.js` | Query 与工具缓存 |
| `tests/application/runtime-utils-action-data.test.js` | Runtime 工具 action_data |
| `tests/application/capability-sync.test.js` | 能力同步 |
| `tests/domain/validators.anchor-hardcut.test.js` | Anchor 硬切验证 |
| `tests/domain/validators.composite-action.test.js` | Composite Action 验证 |
| `tests/domain/validators.capability-and-precondition.test.js` | 能力与前置条件验证 |
| `tests/domain/validators.capture-scene-screenshot.test.js` | 截图验证 |
| `tests/domain/validators.coord-mapping-clamp.test.js` | 坐标映射验证 |
| `tests/domain/validators.dry-run.test.js` | Dry-run 验证 |
| `tests/domain/validators.error-feedback-template.test.js` | 错误反馈模板验证 |
| `tests/domain/validators.get-ui-tree.test.js` | UI 树验证 |
| `tests/domain/validators.hit-test-ui-at-screen-point.test.js` | 屏幕点命中测试验证 |
| `tests/domain/validators.hit-test-ui-at-viewport-point.test.js` | 视口点命中测试验证 |
| `tests/domain/validators.set-ui-properties.test.js` | UI 属性设置验证 |

### 4.2 Unity EditMode 测试列表（前 20）

**目录**: `Assets/Editor/Codex/Tests/EditMode/`

| 文件路径 | 测试内容 |
|---------|---------|
| `AtomicSafeAdmissionTests.cs` | 原子安全准入测试 |
| `CompositeAliasTableTests.cs` | Composite 别名表测试 |
| `CompositeTransactionRunnerTests.cs` | Composite 事务运行器测试 |
| `CompositeVisualActionHandlerTests.cs` | Composite Action Handler 测试 |
| `McpActionRegistryTests.cs` | MCP Action 注册表测试 |
| `McpVisualActionContextTests.cs` | MCP Visual Action 上下文测试 |
| `SidecarContractsExtensibilityDtoTests.cs` | Sidecar 契约扩展性 DTO 测试 |
| `SidecarContractsReadTokenTests.cs` | Sidecar 契约 Read Token 测试 |
| `SidecarContractsSnapshotTests.cs` | Sidecar 契约快照测试 |
| `UnityAnchorExecutionTests.cs` | Unity Anchor 执行测试 |
| `UnityErrorFeedbackReceiptTests.cs` | Unity 错误反馈接收测试 |
| `UnityPhase6ClosureTests.cs` | Unity Phase6 收口测试 |
| `UnityQueryControllerClosureTests.cs` | Unity Query 控制器收口测试 |
| `UnityQueryRegistryDispatchTests.cs` | Unity Query 注册表分发测试 |
| `UnityQueryRegistryTests.cs` | Unity Query 注册表测试 |
| `UnityR9ClosureGuardTests.cs` | Unity R9 收口守卫测试 |
| `UnityRagReadServiceHitTestViewportTests.cs` | Unity RAG 读服务视口命中测试 |
| `UnityRagReadServiceScreenshotTests.cs` | Unity RAG 读服务截图测试 |
| `UnityRagReadServiceUiTreeTests.cs` | Unity RAG 读服务 UI 树测试 |
| `UnityRagReadServiceUiVisionTests.cs` | Unity RAG 读服务 UI 视觉测试 |

### 4.3 HARD 文件测试覆盖情况

#### `sidecar/src/domain/validators.js`
- ✅ **直接覆盖**: `tests/domain/validators.*.test.js` (15 个测试文件)
- ✅ **间接覆盖**: `tests/application/*.test.js` (通过命令测试间接覆盖)

#### `sidecar/src/mcp/commands/index.js`
- ✅ **间接覆盖**: `tests/application/r11-command-contract-snapshot.test.js`, `tests/application/r12-tool-registry-consistency.test.js` (通过 registry 测试覆盖)

#### `Assets/Editor/Codex/Application/ConversationController.cs`
- ✅ **直接覆盖**: `Tests/EditMode/UnityQueryControllerClosureTests.cs`, `Tests/EditMode/UnityR9ClosureGuardTests.cs`, `Tests/EditMode/UnityAnchorExecutionTests.cs`, `Tests/EditMode/UnityRuntimeRecoveryTests.cs`
- ⚠️ **覆盖不足**: 主流程（`StartConversation`, `SendMessage`）可能缺少完整集成测试

#### `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- ✅ **直接覆盖**: `Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs`
- ✅ **间接覆盖**: `Tests/EditMode/CompositeVisualActionHandlerTests.cs`, `Tests/EditMode/ValuePackVisualActionHandlerTests.cs`

#### `Assets/Editor/Codex/Domain/SidecarContracts.cs`
- ✅ **直接覆盖**: `Tests/EditMode/SidecarContractsSnapshotTests.cs`, `Tests/EditMode/SidecarContractsExtensibilityDtoTests.cs`, `Tests/EditMode/SidecarContractsReadTokenTests.cs`

### 4.4 运行全部测试的命令与耗时

**Sidecar 测试**:
```bash
cd sidecar
npm test
```

**Unity EditMode 测试**:
- 在 Unity Editor 中打开 Test Runner 窗口
- 选择 EditMode 测试
- 点击 Run All

**⚠️ 无法获取耗时**: 原因：需要实际运行测试，当前环境无法执行。

**建议**: 在本地运行 `npm test` 并记录耗时，Unity 测试在 Unity Editor 中运行并记录耗时。

---

## 5) 依赖环/耦合宏观检测

### 5.1 JavaScript 循环依赖检测

**推荐命令**:
```bash
cd sidecar
npx madge --circular src
```

**⚠️ 无法执行**: 原因：PowerShell 命令执行环境限制，`&&` 操作符不支持。

**替代方案**:
```bash
# 方法 1: 使用 Git Bash / WSL
cd sidecar
npx madge --circular src

# 方法 2: 如果 madge 未安装
npm install -g madge
madge --circular sidecar/src

# 方法 3: 手动检查（grep require 链）
# 查找可能的循环：A require B, B require A
```

**建议**: 在本地运行 `npx madge --circular src` 并记录结果。

### 5.2 C# 粗粒度依赖层级检查

**检查规则**:
- **Domain** 不应引用 Infrastructure/Application
- **Application** 可以引用 Domain/Ports，不应引用 Infrastructure（通过接口）
- **Infrastructure** 可以引用 Domain/Ports，不应引用 Application

**检查命令**（grep 近似）:
```bash
# 检查 Domain 是否引用 Infrastructure/Application
grep -r "using UnityAI.Editor.Codex.Infrastructure" Assets/Editor/Codex/Domain/
grep -r "using UnityAI.Editor.Codex.Application" Assets/Editor/Codex/Domain/

# 检查 Application 是否直接引用 Infrastructure（应通过接口）
grep -r "using UnityAI.Editor.Codex.Infrastructure\." Assets/Editor/Codex/Application/ | grep -v "Ports"

# 检查 Infrastructure 是否引用 Application
grep -r "using UnityAI.Editor.Codex.Application" Assets/Editor/Codex/Infrastructure/
```

**基于已读取文件的分析**:

| 文件 | Using 语句 | 跨层依赖异常 |
|------|-----------|------------|
| `ConversationController.cs` (Application) | `using UnityAI.Editor.Codex.Infrastructure;` | ⚠️ **异常**: Application 直接引用 Infrastructure（应通过 Ports 接口） |
| `SidecarContracts.cs` (Domain) | 无 Infrastructure/Application 引用 | ✅ 正常 |
| `UnityVisualActionExecutor.cs` (Infrastructure) | `using UnityAI.Editor.Codex.Domain;` | ✅ 正常（Infrastructure 可引用 Domain） |

**结论**: 
- ✅ **未发现循环依赖**（基于文件读取，无明确 A->B->A 证据）
- ⚠️ **存在跨层依赖异常**: `ConversationController` (Application) 直接引用 `UnityVisualActionExecutor` (Infrastructure)，应通过 `IUnityVisualActionExecutor` 接口

---

## 6) Hotspot（如果 git 可用）

### 6.1 Git 历史统计命令

**推荐命令**:
```bash
# 最近 3 个月变更最多的文件 Top 20
git log --since="3 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20

# 最近 100 次提交变更最多的文件 Top 20
git log -100 --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20

# 带 insertions/deletions 统计
git log --since="3 months ago" --stat --oneline | grep -E "^ [0-9]+ files? changed" | head -20
```

**⚠️ 无法执行**: 原因：PowerShell 命令执行环境限制，`&&` 操作符不支持。

**建议**: 在本地 Git Bash / WSL 中运行上述命令，并标注哪些文件属于 HARD/SOFT 列表。

---

## 附录：本地运行命令清单

### A.1 LOC 统计命令

```powershell
# Windows PowerShell
Get-ChildItem -Path . -Include *.js,*.ts,*.tsx,*.cs -Recurse -File | 
  Where-Object { $_.FullName -notmatch '(Library|Temp|node_modules|bin|obj|dist|build|\.min\.|Generated)' } | 
  ForEach-Object { 
    $lines = (Get-Content $_.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    [PSCustomObject]@{ 
      Path = $_.FullName.Replace((Get-Location).Path + '\', '').Replace('\', '/')
      Lines = $lines
      Ext = $_.Extension 
    } 
  } | 
  Sort-Object -Property Lines -Descending | 
  Export-Csv -Path "file-loc-stats.csv" -NoTypeInformation
```

### A.2 循环依赖检测

```bash
# Git Bash / WSL
cd sidecar
npx madge --circular src
```

### A.3 Git Hotspot 统计

```bash
# Git Bash / WSL
cd D:/csgo/csgoToolV02/UnityAI
git log --since="3 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20
```

### A.4 测试运行

```bash
# Sidecar 测试
cd sidecar
npm test

# Unity 测试（在 Unity Editor 中）
# 打开 Test Runner 窗口 -> EditMode -> Run All
```

---

**报告结束**
