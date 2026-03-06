# Codex-Unity MCP 动作治理与高价值动作包升级蓝图（R10）

## 0. 目标与硬约束

### 0.1 总目标
在不削弱现有硬防线（OCC + 双锚点 + 自动清理 + 错误模板）的前提下，将当前可扩展动作架构升级为“可治理、可组合、可规模化”的稳定动作平台，避免动作数量爆炸和 API 铺平式扩张。

### 0.2 本轮必须解决的三大技术缺口
1. 组合动作上下文传递（Context Piping）：支持“前一步创建对象，后一步可引用”。  
2. 组合动作原子性（Atomicity）：首版必须保证一步失败全链回滚，不能留下脏场景。  
3. Token 防爆：30+ 动作时 tools/list 必须降维，Schema 按需懒加载。  

### 0.3 不可退让约束
1. 所有写请求继续强制 `based_on_read_token`。  
2. 顶层 `write_anchor(object_id + path)` 继续硬校验。  
3. 动作级锚点（`target_anchor` / `parent_anchor`）继续硬校验。  
4. 细分错误码必须具备 `suggestion + recoverable`。  
5. 不允许通过兼容分支绕过治理门禁。

---

## 1. 总体增量设计

### 1.1 架构增量
1. 在 L3 增加 `CompositeActionHandler` + `AliasResolver` + `CompositeTransactionRunner`。  
2. 在 L2 增加组合动作 schema 校验与 step 限制。  
3. 在 L1/L2 对 capability 展示做“索引化”，Schema 通过读工具按需拉取。  

### 1.2 动作元数据升级
`McpActionCapability` 增加治理字段：
1. `domain`（`gameobject|component|transform|rect_transform|ui|prefab|scene`）  
2. `tier`（`core|advanced|experimental`）  
3. `lifecycle`（`draft|experimental|stable|deprecated|removed`）  
4. `undo_safety`（`atomic_safe|non_atomic`）  
5. `replacement_action_type`（deprecated 动作必须提供）  

---

## 2. 阶段一：动作目录治理（Action Catalog Governance）

### 2.1 目标
1. 建立命名规范、分层、数量上限、弃用策略。  
2. 通过门禁脚本阻断无序动作增长。  

### 2.2 命名与分层规则（强制）
1. 统一 `lower_snake_case`。  
2. 以语义命名，不以参数碎片命名。  
3. `stable` 动作默认可见；`experimental` 动作默认不在 tools/list 主提示中展开。  

### 2.3 建议上限（初版）
1. `stable` 总数 <= 50。  
2. `experimental` 总数 <= 30。  
3. 单域 `stable` 数 <= 12。  

### 2.4 核心文件
1. `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`  
2. `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`  
3. `Assets/Editor/Codex/Application/ConversationController.cs`  
4. `sidecar/src/application/capabilityStore.js`  
5. `sidecar/src/mcp/mcpServer.js`  

---

## 3. 阶段二：组合动作能力（Composite Actions v1）

### 3.1 目标
1. 用组合动作覆盖高频流程，减少新增细粒度动作。  
2. 首版必须解决 Alias 引用和原子回滚。

### 3.2 组合动作 JSON Payload 草案（L1 入站）
```json
{
  "type": "composite_visual_action",
  "target_anchor": {
    "object_id": "go_canvas",
    "path": "Scene/Canvas"
  },
  "action_data": {
    "schema_version": "r10.v1",
    "transaction_id": "tx_ui_hpbar_001",
    "atomic_mode": "all_or_nothing",
    "max_step_ms": 1500,
    "steps": [
      {
        "step_id": "s1_create_bar_root",
        "type": "create_gameobject",
        "parent_anchor": {
          "object_id": "go_canvas",
          "path": "Scene/Canvas"
        },
        "action_data": {
          "name": "HealthBar",
          "components": ["RectTransform", "Image"]
        },
        "bind_outputs": [
          { "source": "created_object", "alias": "hp_bar_root" }
        ]
      },
      {
        "step_id": "s2_create_fill",
        "type": "create_gameobject",
        "parent_anchor_ref": "hp_bar_root",
        "action_data": {
          "name": "Fill",
          "components": ["RectTransform", "Image"]
        },
        "bind_outputs": [
          { "source": "created_object", "alias": "hp_fill" }
        ]
      },
      {
        "step_id": "s3_set_fill_color",
        "type": "set_ui_image_color",
        "target_anchor_ref": "hp_fill",
        "action_data": {
          "r": 1.0,
          "g": 0.25,
          "b": 0.25,
          "a": 1.0
        }
      }
    ]
  }
}
```

### 3.3 L2 -> L3 归一化 Payload 草案（JsonUtility 安全）
1. 外部契约（LLM/L1）强制规则：
- `action_data` 在 LLM 可见 schema 中必须始终是 JSON Object。
- LLM 请求体中禁止出现任何字符串化 JSON 字段（如 `legacy_stringified_action_data`、`steps[*].legacy_stringified_action_data`）。
- 若 L2 收到字符串化 JSON，必须硬拒绝：`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`。
2. 内部桥接规则（仅 L2 -> L3）：
- 仅允许 `turnPayloadBuilders.js` 在下发 Unity 的最后阶段执行 `JSON.stringify`。
- `legacy_stringified_action_data` 属于内部线缆格式（wire-only），不得暴露到 tools/list 或对话示例。
3. L3 侧统一使用 `TryDeserializeActionData<T>(legacy_stringified_action_data, ...)` 进入类型化 Handler。

`turnPayloadBuilders.js` 归一化伪代码：
```js
function normalizeCompositeStepForUnity(step) {
  return {
    step_id: step.step_id,
    type: step.type,
    target_anchor: step.target_anchor,
    target_anchor_ref: step.target_anchor_ref,
    parent_anchor: step.parent_anchor,
    parent_anchor_ref: step.parent_anchor_ref,
    bind_outputs: step.bind_outputs,
    legacy_stringified_action_data: JSON.stringify(step.action_data ?? {})
  };
}
```

L2->L3 线缆草案（示意）：
```json
{
  "type": "composite_visual_action",
  "target_anchor": { "object_id": "go_canvas", "path": "Scene/Canvas" },
  "legacy_stringified_action_data": "<internal_stringified_json_generated_by_l2_only>"
}
```

### 3.4 Alias 机制定义（Context Piping）
1. 作用域：Alias 仅在单个 `transaction_id` 内有效，请求结束即销毁。  
2. 绑定语义：step 成功后执行 `bind_outputs`，失败 step 禁止写入 alias 表。  
3. 标准可绑定输出：
- `created_object`：当前 step 创建出来的对象锚点。
- `target_object`：当前 step 解析到的 target 锚点。
- `parent_object`：当前 step 解析到的 parent 锚点。
4. Alias 表结构（运行时）：
```json
{
  "hp_fill": {
    "anchor": {
      "object_id": "go_4fcd7a...",
      "path": "Scene/Canvas/HealthBar/Fill",
      "scene_guid": "5f3e..."
    },
    "source_step_id": "s2_create_fill",
    "source_output": "created_object"
  }
}
```
5. 引用语义：后续 step 通过 `target_anchor_ref` / `parent_anchor_ref` 引用 alias，L3 在执行前解引用为标准锚点。  
6. 约束：
- alias 正则：`^[a-z][a-z0-9_]{2,31}$`
- 单组合最大 alias：16
- 禁止重复绑定
- 禁止前向引用
- `*_anchor` 与 `*_anchor_ref` 必须互斥
7. 失败码：
- `E_COMPOSITE_ALIAS_NOT_FOUND`
- `E_COMPOSITE_ALIAS_DUPLICATED`
- `E_COMPOSITE_ALIAS_INVALID`
- `E_COMPOSITE_ALIAS_FORWARD_REF`
8. 首版边界（必须写明）：
- v1 仅支持 `target_anchor_ref` / `parent_anchor_ref` 的空间层级引用。
- v1 暂不支持在 `action_data` 内部使用 `$ref:alias`（或等价语法）做组件属性插值。
- 若检测到 `action_data` 内 alias 插值语法，返回 `E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED`，并提示改为拆分动作或等待后续版本。

### 3.5 L3 C# 执行防线（Alias + 原子执行主线）
```csharp
// 核心伪代码：CompositeTransactionRunner.ExecuteAtomic(...)
var baseline = SceneBaseline.Capture();
var txGroup = UndoGuard.BeginGroup("Codex composite_visual_action");
var aliasTable = new CompositeAliasTable();
var ledger = new CompositeLedger();

try
{
    // Fail-fast：未知动作、非 atomic_safe 动作、非法 alias 在执行前拦截
    CompositePreflight.Validate(request, _registry, _policy);

    foreach (var step in request.Steps)
    {
        var resolvedTarget = AliasResolver.ResolveTarget(step, aliasTable); // target_anchor_ref -> target_anchor
        var resolvedParent = AliasResolver.ResolveParent(step, aliasTable); // parent_anchor_ref -> parent_anchor
        var normalized = StepNormalizer.ToVisualActionItem(step, resolvedTarget, resolvedParent);

        var result = _singleActionExecutor.Execute(normalized, txGroup); // 复用 typed handler 链
        if (!result.Success)
        {
            throw CompositeStepException.FromResult(step.StepId, result);
        }

        // 只有成功 step 可以输出 alias
        aliasTable.Bind(step.BindOutputs, result.OutputAnchors);
        ledger.RecordStepSuccess(step.StepId, result);
    }

    UndoGuard.Commit(txGroup); // Undo.CollapseUndoOperations(txGroup)
    return CompositeResult.Success(ledger);
}
catch (CompositeStepException ex)
{
    UndoGuard.Rollback(txGroup); // Undo.RevertAllDownToGroup(txGroup)
    var integrity = RollbackVerifier.Verify(baseline, ledger);
    if (!integrity.Ok)
    {
        _writeCircuitBreaker.Trip("E_COMPOSITE_ROLLBACK_INCOMPLETE", integrity.Message);
        return CompositeResult.Fail("E_COMPOSITE_ROLLBACK_INCOMPLETE", integrity.Message);
    }

    return CompositeResult.Fail("E_COMPOSITE_STEP_FAILED", ex.ToPayload());
}
catch (Exception ex)
{
    UndoGuard.Rollback(txGroup);
    _writeCircuitBreaker.Trip("E_COMPOSITE_EXECUTION_FAILED", ex.Message);
    return CompositeResult.Fail("E_COMPOSITE_EXECUTION_FAILED", ErrorSanitizer.Clean(ex));
}
```

### 3.6 原子性策略（首版强制）
1. 仅允许 `undo_safety=atomic_safe` 的动作进入组合执行。  
2. 每个 step Handler 必须显式记录 Undo：
- 创建对象：`Undo.RegisterCreatedObjectUndo`
- 修改对象：`Undo.RecordObject`
- 组件增删：`Undo.AddComponent` / `Undo.DestroyObjectImmediate`
3. 任一步失败后必须执行 `Undo.RevertAllDownToGroup(txGroup)`，不允许部分成功。  
4. 回滚一致性验证（强制）：
- `ledger.createdInstanceIds` 在回滚后全部不可解析
- 事务开始前后的 `SceneDirtySnapshot` 无新增脏场景
- 锚点路径回放一致（避免层级残留）
5. 若一致性验证失败，返回 `E_COMPOSITE_ROLLBACK_INCOMPLETE`，并触发写入熔断（fail-closed）。

### 3.7 L2 校验要求（组合动作）
1. `steps` 上限：8；嵌套深度上限：1（首版禁止组合套组合）。  
2. `step_id` 必须唯一，建议正则：`^[a-z][a-z0-9_]{2,47}$`。  
3. 每步必须满足互斥规则：
- `target_anchor` 与 `target_anchor_ref` 二选一
- `parent_anchor` 与 `parent_anchor_ref` 二选一
4. `bind_outputs.source` 仅允许 `created_object|target_object|parent_object`。  
5. 超时与预算：
- 单步 `max_step_ms` 上限：3000
- 组合总时长上限：12000
6. 失败码映射：
- 输入校验失败：`E_COMPOSITE_PAYLOAD_INVALID`
- alias 规则失败：`E_COMPOSITE_ALIAS_INVALID`
- 预算超限：`E_COMPOSITE_BUDGET_EXCEEDED`
- 外部字符串化 JSON：`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`
- 内联 alias 插值未支持：`E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED`

---

## 4. 阶段三：Token 防爆与 Schema 懒加载

### 4.1 目标
1. 30+ 动作下，tools/list 仍保持短提示、低 token。  
2. 详细 schema 仅按需拉取。

### 4.2 tools/list 降维输出草案（极简索引）
```json
{
  "tool": "apply_visual_actions",
  "description_mode": "compact_index",
  "capability_index": {
    "catalog_version": "sha256:cap_v10",
    "catalog_etag": "\"cap_v10_20260228\"",
    "connection_state": "unity_connected",
    "stable_action_count": 34,
    "experimental_action_count": 9,
    "domains": [
      { "name": "ui", "count": 10 },
      { "name": "component", "count": 8 },
      { "name": "transform", "count": 6 }
    ],
    "action_hints": [
      { "type": "create_gameobject", "summary": "Create object under parent anchor", "tier": "core" },
      { "type": "set_rect_transform", "summary": "Set anchors/size/position", "tier": "core" },
      { "type": "set_ui_image_color", "summary": "Set Image RGBA color", "tier": "core" },
      { "type": "add_component", "summary": "Attach component by type name", "tier": "core" }
    ],
    "schema_lookup_required": true,
    "schema_fetch_tool": "get_action_schema",
    "catalog_fetch_tool": "get_action_catalog"
  }
}
```
1. `tools/list` 中不下发完整参数 schema，只下发动作索引和检索入口。  
2. `action_hints` 仅展示高频动作，且受预算上限约束。  
3. 当 Unity 未连接时，`connection_state` 必须显式为 `unity_disconnected`，并在描述中加入执行警告。

### 4.3 新增按需查询工具（建议）
1. `get_action_catalog`：分页拉取动作摘要，不返回深层属性定义。  
2. `get_action_schema`：按动作类型返回单动作完整 schema。  
3. `catalog_version + etag` 用于防止旧缓存污染。

`get_action_catalog` 请求草案：
```json
{
  "domain": "ui",
  "tier": "core",
  "lifecycle": "stable",
  "cursor": "0",
  "limit": 10,
  "catalog_version": "sha256:cap_v10"
}
```

`get_action_catalog` 响应草案：
```json
{
  "catalog_version": "sha256:cap_v10",
  "next_cursor": "10",
  "items": [
    {
      "type": "set_ui_image_color",
      "summary": "Set RGBA color on UnityEngine.UI.Image",
      "required_anchors": ["target_anchor"],
      "undo_safety": "atomic_safe",
      "lifecycle": "stable"
    }
  ]
}
```

`get_action_schema` 请求草案：
```json
{
  "action_type": "set_ui_image_color",
  "catalog_version": "sha256:cap_v10",
  "if_none_match": "\"cap_v10_20260228:set_ui_image_color\""
}
```

`get_action_schema` 响应草案：
```json
{
  "action_type": "set_ui_image_color",
  "catalog_version": "sha256:cap_v10",
  "etag": "\"cap_v10_20260228:set_ui_image_color\"",
  "schema": {
    "type": "object",
    "required": ["r", "g", "b", "a"],
    "properties": {
      "r": { "type": "number", "minimum": 0, "maximum": 1 },
      "g": { "type": "number", "minimum": 0, "maximum": 1 },
      "b": { "type": "number", "minimum": 0, "maximum": 1 },
      "a": { "type": "number", "minimum": 0, "maximum": 1 }
    },
    "additionalProperties": false
  }
}
```

### 4.4 L2 Token 防线（预算 + 降级）
1. 常量上限（建议）：
- `TOOLS_LIST_MAX_ACTION_HINTS = 12`
- `TOOLS_LIST_MAX_DESCRIPTION_CHARS = 900`
- `GET_ACTION_CATALOG_MAX_LIMIT = 20`
- `ACTION_SCHEMA_MAX_PROPERTIES = 40`
- `ACTION_SCHEMA_MAX_DEPTH = 6`
2. 超预算降级：
- tools/list 只保留 `domains + topN action_hints + lookup tools`
- 如果单动作 schema 超预算，返回 `schema_compact`（仅 required + type + range）
- suggestion 强制引导 LLM 分步查询 schema
3. 版本一致性：
- `catalog_version` 不匹配返回 `E_ACTION_CAPABILITY_MISMATCH`
- `etag` 命中返回 `304` 语义（或显式 `not_modified: true`），减少 token 与带宽
4. 错误与恢复：
- `E_ACTION_SCHEMA_NOT_FOUND`：提示先调用 `get_action_catalog`
- `E_ACTION_SCHEMA_TOO_LARGE`：提示切换 `compact=true`
- `E_COMPOSITE_PAYLOAD_INVALID`：默认附带 `schema_hint`（紧凑版）供 LLM 直接改参重试

### 4.5 C# 与 L2 协作边界
1. C# 上报完整能力模型：`type/summary/schema/undo_safety/lifecycle/domain/tier`。  
2. L2 负责能力缓存、token 预算裁剪、分页与懒加载接口。  
3. C# 不做 token 策略判断，避免执行层与提示层耦合。  
4. L2 对外永远输出“最小可行动信息”，把详细 schema 推迟到按需查询阶段。

### 4.6 错误驱动 Schema 补偿（减少无效往返）
1. 触发条件：`apply_visual_actions` 被 L2 校验拒绝且错误码为 `E_COMPOSITE_PAYLOAD_INVALID`。  
2. 返回策略（默认开启）：
- 在错误 payload 中直接附带 `schema_hint`（当前动作或当前 step 的紧凑 schema）。
- `schema_hint` 至少包含：`required`、字段 `type`、关键 `range/enum`、最小示例 `example`。
- 同时附带 `schema_source`（`inline_hint` 或 `get_action_schema`）和 `retryable=true`。
3. 预算防线：
- `ERROR_SCHEMA_HINT_MAX_CHARS = 1200`
- 超预算时只返回 `required + example + schema_ref`
- `schema_ref` 统一指向 `get_action_schema(action_type, catalog_version)`
4. 错误回包草案：
```json
{
  "ok": false,
  "code": "E_COMPOSITE_PAYLOAD_INVALID",
  "message": "Invalid action_data for step s3_set_fill_color",
  "retryable": true,
  "suggestion": "Use schema_hint to fix payload and retry apply_visual_actions directly.",
  "schema_source": "inline_hint",
  "schema_hint": {
    "action_type": "set_ui_image_color",
    "required": ["r", "g", "b", "a"],
    "properties": {
      "r": { "type": "number", "range": [0, 1] },
      "g": { "type": "number", "range": [0, 1] },
      "b": { "type": "number", "range": [0, 1] },
      "a": { "type": "number", "range": [0, 1] }
    },
    "example": { "r": 1, "g": 0.25, "b": 0.25, "a": 1 }
  }
}
```
5. L2 实现落点：
- `turnPolicies.js`：将 validator 错误映射为 `schema_hint` 注入策略。
- `mcpErrorFeedback.js`：扩展模板，支持 `schema_hint/schema_ref` 字段输出。

---

## 5. 阶段四：高价值动作包（20~50）

### 5.1 目标
构建跨项目复用的稳定动作包，覆盖 80% 常见场景。

### 5.2 分层建议
1. `Core(P0)`：15~20，默认展示。  
2. `Advanced(P1)`：10~15，按需展示。  
3. `Experimental(P2)`：5~15，灰度展示。  

### 5.3 域优先级建议
1. Component / GameObject  
2. Transform / RectTransform  
3. UI（Image/Text/Button/Layout）  
4. Prefab / Scene  

### 5.4 准入标准（每个动作）
1. 具备 DTO schema 与 anchor policy。  
2. 具备成功/失败最小测试。  
3. 具备错误码归类与 suggestion。  
4. 标注 `undo_safety`，用于组合动作准入检查。

---

## 6. QA 与门禁

### 6.1 Sidecar 回归
1. 组合动作 schema/alias 校验（重复绑定、前向引用、互斥字段）。  
2. `action_data -> legacy_stringified_action_data` 归一化链路与回传一致性。  
3. token 降维与懒加载接口（compact index、catalog 分页、schema 单查）。  
4. capability 版本不一致恢复路径（`E_ACTION_CAPABILITY_MISMATCH`）。
5. 外部字符串化 JSON 拒绝（`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`）。  
6. `E_COMPOSITE_PAYLOAD_INVALID` 包含 `schema_hint/schema_ref` 并可直接重试。  

### 6.2 Unity 回归
1. CompositeTransactionRunner 原子回滚测试（step 2 失败触发全量回滚）。  
2. Alias 正向/反向引用测试（不存在 alias、重复 alias、前向 alias）。  
3. rollback 后场景完整性测试（对象残留、dirty snapshot、层级路径）。  
4. Handler Undo 语义测试（`RegisterCreatedObjectUndo/RecordObject` 覆盖）。
5. 内联 alias 插值语法拒绝（`E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED`）。

### 6.3 门禁脚本
1. `gate:r10-action-catalog`（命名、分层、上限、生命周期）  
2. `gate:r10-composite-safety`（步数、深度、alias、undo_safety、atomic rollback）  
3. `gate:r10-token-budget`（tools/list 大小、schema 查询预算、etag 行为）  
4. `gate:r10-error-schema-hint`（校验失败携带 schema_hint 的覆盖率与预算）。

---

## 7. 执行顺序与任务矩阵（R10）

### 7.1 强制执行顺序（按依赖，不按编号）
1. `Phase 0 / Governance Gate`：先完成 `R10-ARCH-01~05`，再进入功能开发。  
2. `Phase 1 / Contract Hardening`：执行 `R10-L2-01`、`R10-L2-02`。  
3. `Phase 2 / Atomic Composite Core`：执行 `R10-L3-02`、`R10-L3-03`。  
4. `Phase 3 / Error-Driven Recovery`：执行 `R10-L2-05`。  
5. `Phase 4 / Token & Lazy Load`：执行 `R10-L2-03`、`R10-L2-04`。  
6. `Phase 5 / Catalog & Value Pack`：执行 `R10-L3-01`、`R10-L3-04`。  
7. `Phase 6 / QA & E2E Closure`：执行 `R10-QA-01`、`R10-QA-02`、`R10-E2E-01`，最后收口 `R10-ARCH-06`。

### 7.2 任务矩阵（按执行顺序）
| 执行阶段 | 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| Phase 0 | R10-ARCH-01 | L2 职责边界固化 | `sidecar/src/domain/validators.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpErrorFeedback.js` | 职责注释与边界守卫（禁止跨职责逻辑） | 任一文件不再同时承载校验+转换+文案三类逻辑 |
| Phase 0 | R10-ARCH-02 | L3 职责解耦固化 | `Assets/Editor/Codex/Infrastructure/Actions/CompositeTransactionRunner.cs`、`UndoGuard.cs`、`RollbackVerifier.cs` | 调度/事务/回滚验证三分离 | 类级单元测试能独立验证各职责 |
| Phase 0 | R10-ARCH-03 | 契约快照门禁 | `sidecar/tests/application/*`、`Assets/Editor/Codex/Tests/EditMode/*` | 错误回包与 capability 契约 snapshot 测试 | 契约字段变更需显式更新 snapshot 才能通过 |
| Phase 0 | R10-ARCH-04 | 耦合指标监控 | `sidecar/scripts/*`、`sidecar/package.json` | 新增 `gate:r10-responsibility`、`gate:r10-contract-snapshot` | CI 中可自动阻断职责漂移与契约漂移 |
| Phase 0 | R10-ARCH-05 | Token 防线守卫 | `sidecar/src/mcp/mcpServer.js`、`sidecar/src/application/capabilityStore.js` | `tools/list` 与 `schema_hint` 双预算守卫 | 超预算自动降级，且可观测告警 |
| Phase 1 | R10-L2-01 | 组合动作校验 | `sidecar/src/domain/validators.js`、`sidecar/src/domain/turnPolicies.js` | step/alias/预算校验、字符串化 JSON 硬拒绝、细分错误码 | 非法 payload 硬拒绝并可恢复 |
| Phase 1 | R10-L2-02 | Payload 归一化桥接 | `sidecar/src/utils/runtimeUtils.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/domain/contracts.js` | `action_data` 到 `legacy_stringified_action_data` 的统一转换（仅内部线缆） | Unity 端不再出现开放对象反序列化空值 |
| Phase 2 | R10-L3-02 | 组合动作上下文传递 | `Assets/Editor/Codex/Infrastructure/Actions/CompositeTransactionRunner.cs`、`Assets/Editor/Codex/Infrastructure/Actions/CompositeAliasTable.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | Alias 绑定、`*_anchor_ref` 解引用、runtime alias ledger | 可引用前序创建对象且禁止前向引用 |
| Phase 2 | R10-L3-03 | 组合动作原子回滚 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Infrastructure/Actions/UndoGuard.cs`、`Assets/Editor/Codex/Infrastructure/Actions/RollbackVerifier.cs` | UndoGroup 事务化执行、失败回滚与一致性校验 | 任一步失败全链无残留，失败时 fail-closed |
| Phase 3 | R10-L2-05 | 错误驱动 Schema 补偿 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpErrorFeedback.js` | `E_COMPOSITE_PAYLOAD_INVALID` 回包附 `schema_hint/schema_ref` | LLM 无需额外读工具即可首轮自纠错 |
| Phase 4 | R10-L2-03 | Token 防爆 | `sidecar/src/mcp/mcpServer.js`、`sidecar/src/application/capabilityStore.js` | tools/list 降维索引、connection_state 注记、预算裁剪 | 30+ 动作下提示稳定且可读 |
| Phase 4 | R10-L2-04 | 懒加载工具 | `sidecar/src/api/router.js`、`sidecar/src/application/turnService.js`、`sidecar/src/mcp/mcpServer.js` | `get_action_catalog` + `get_action_schema` + etag | 单动作 schema 可按需拉取且支持缓存命中 |
| Phase 5 | R10-L3-01 | 动作目录治理 | `McpActionRegistry.cs`、`McpActionRegistryBootstrap.cs` | 元数据分层、命名规范、上限与生命周期 | capability 中可见治理字段 |
| Phase 5 | R10-L3-04 | 高价值动作包 P0/P1/P2 | `Actions/*` handlers | 20~50 动作分批落地 | 80% 场景覆盖达标 |
| Phase 6 | R10-QA-01 | Sidecar 回归 | `sidecar/tests/domain/*`、`sidecar/tests/application/*` | 组合与 token 防爆回归集 | 常态全绿 |
| Phase 6 | R10-QA-02 | Unity 回归 | `Assets/Editor/Codex/Tests/EditMode/*` | alias/atomic/rollback 回归集 | Unity 编译与 EditMode 全绿 |
| Phase 6 | R10-E2E-01 | 终局验收 | `Assets/Docs/Phase8-Action-Governance-Acceptance.md` | 固化端到端验收流程 | 满足发布门槛 |
| Phase 6 | R10-ARCH-06 | 文档与扩展指引收口 | `docs/*.md`、`sidecar/README.md`、`README.zh-CN.md` | “新增动作”标准流程仅保留一条主路径 | 新成员按指引可在不触碰多模块情况下完成新增动作 |

---

## 8. 发布门槛

1. Alias 机制通过四类用例：正常引用、未定义引用、重复绑定、前向引用拒绝。  
2. UndoGroup 原子回滚通过：step 失败后对象无残留、dirty snapshot 不新增。  
3. L2->L3 归一化链路通过：组合 step 的 `legacy_stringified_action_data` 可被稳定反序列化。  
4. tools/list 在 30+ 动作下保持极简索引，不内嵌全量 schema，且 `get_action_schema` 可按需拉取。  
5. LLM/L1 输入层 0 容忍 stringified JSON：出现即 `E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`。  
6. `E_COMPOSITE_PAYLOAD_INVALID` 默认返回可执行的 `schema_hint`（超预算降级为 `schema_ref`）。  
7. v1 明确不支持 `action_data` 内 `$ref:alias` 插值，并有专用拒绝错误码。  
8. 高价值动作包达到 20~50 且覆盖 80% 目标场景。  
9. OCC/双锚点/错误模板四大硬防线零回退。  

---

## 9. 风险与回滚策略

### 9.1 主要风险
1. 组合动作引入复杂性导致错误定位困难。  
2. 部分动作 Undo 语义不完整导致回滚不彻底。  
3. 懒加载策略不当导致 LLM 仍频繁猜参。

### 9.2 回滚策略
1. 保留 `USE_COMPOSITE_VISUAL_ACTIONS` feature flag。  
2. 保留 `EXPOSE_EXPERIMENTAL_ACTIONS` feature flag。  
3. 异常时回退到“仅 stable 动作 + 非组合执行 + 极简 tools/list”。  

---

## 10. 架构治理执行护栏（防职责混乱与防耦合回升）

### 10.1 目标与硬约束
1. 将“单一职责边界”从口头约定升级为执行门禁。  
2. 将“跨层耦合”从隐式依赖升级为显式契约与兼容规则。  
3. 所有治理条目必须映射到任务ID、文件落点、自动化验收。

### 10.2 职责边界拆分（L2/L3 强制）
1. L2 `validators.js`：
- 只负责输入结构校验、互斥字段校验、上限预算校验。
- 禁止承载业务修复逻辑、禁止执行 payload 重写。
2. L2 `turnPayloadBuilders.js`：
- 只负责标准对象 -> 内部线缆格式转换（含 `legacy_stringified_action_data` 生成）。
- 禁止做策略判断、禁止生成错误文案。
3. L2 `turnPolicies.js`：
- 只负责错误分级、恢复策略、`schema_hint` 注入决策。
- 禁止直接修改原始业务 payload。
4. L2 `mcpErrorFeedback.js`：
- 只负责错误模板渲染，输入来自统一错误对象。
- 禁止重复实现校验与策略判断。
5. L3 `CompositeTransactionRunner/UndoGuard/RollbackVerifier`：
- Runner 负责调度；UndoGuard 负责事务边界；RollbackVerifier 负责回滚一致性验证。
- 禁止在单个类中混合“调度 + 回滚验证 + 错误模板”三种职责。

### 10.3 防耦合回升机制（协议与版本）
1. 协议单一来源：
- L2/L3 共享错误码字典与字段白名单（`code/retryable/suggestion/schema_hint/schema_ref`）。
- 新增字段必须经过契约快照更新（见 10.5）。
2. 版本兼容规则：
- capability 变更必须提升 `catalog_version`，并携带 `etag`。
- L2 缓存命中旧版本时必须返回 `E_ACTION_CAPABILITY_MISMATCH`。
3. 内部线缆隔离：
- `legacy_stringified_action_data` 标记为 internal-only，禁止出现在 tools/list 与公开示例。
- 对外输入出现 stringified JSON 一律拒绝（`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`）。
4. 依赖方向约束：
- L1/L2 依赖 capability 索引，不依赖具体 C# Handler 实现。
- L3 依赖注册表与 DTO，不依赖 L2 文案模板。

### 10.4 关键风险扩展与预警触发
1. 风险：职责漂移（一个模块承担多类逻辑）。  
预警：同一文件在单次变更中同时出现 `validate + stringify + suggestion` 关键字组合。  
处置：拆分提交或拒绝合并。
2. 风险：契约漂移（L2/L3 错误结构不一致）。  
预警：契约快照测试失败或 `code` 字段未命中字典。  
处置：阻断发布，先修复契约。
3. 风险：回滚幻觉（Undo 后有残留）。  
预警：`RollbackVerifier` 检测到对象残留或 dirty snapshot 增量。  
处置：触发写入熔断并强制人工确认。
4. 风险：Token 防线失效（tools/list 膨胀）。  
预警：`tools/list` 超预算阈值、`schema_hint` 超长度阈值。  
处置：降级到 compact 模式并回传 `schema_ref`。
5. 风险：功能蔓延（动作无限增长）。  
预警：`stable` 数量超过上限或 domain 分布失衡。  
处置：冻结新增动作，仅允许替换与合并动作。

### 10.5 任务拆分（R10-ARCH-xx，执行顺序以 7.1 / 7.2 为准）

说明：`R10-ARCH-01~05` 属于 `Phase 0` 前置门禁，`R10-ARCH-06` 属于 `Phase 6` 收口任务。

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| R10-ARCH-01 | L2 职责边界固化 | `sidecar/src/domain/validators.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpErrorFeedback.js` | 职责注释与边界守卫（禁止跨职责逻辑） | 任一文件不再同时承载校验+转换+文案三类逻辑 |
| R10-ARCH-02 | L3 职责解耦固化 | `Assets/Editor/Codex/Infrastructure/Actions/CompositeTransactionRunner.cs`、`UndoGuard.cs`、`RollbackVerifier.cs` | 调度/事务/回滚验证三分离 | 类级单元测试能独立验证各职责 |
| R10-ARCH-03 | 契约快照门禁 | `sidecar/tests/application/*`、`Assets/Editor/Codex/Tests/EditMode/*` | 错误回包与 capability 契约 snapshot 测试 | 契约字段变更需显式更新 snapshot 才能通过 |
| R10-ARCH-04 | 耦合指标监控 | `sidecar/scripts/*`、`sidecar/package.json` | 新增 `gate:r10-responsibility`、`gate:r10-contract-snapshot` | CI 中可自动阻断职责漂移与契约漂移 |
| R10-ARCH-05 | Token 防线守卫 | `sidecar/src/mcp/mcpServer.js`、`sidecar/src/application/capabilityStore.js` | `tools/list` 与 `schema_hint` 双预算守卫 | 超预算自动降级，且可观测告警 |
| R10-ARCH-06 | 文档与扩展指引收口 | `docs/*.md`、`sidecar/README.md`、`README.zh-CN.md` | “新增动作”标准流程仅保留一条主路径 | 新成员按指引可在不触碰多模块情况下完成新增动作 |

### 10.6 新增发布门槛（与第 8 节叠加）
1. `R10-ARCH-01~06` 全部完成并在 CI 绿灯。  
2. 职责边界巡检通过：无跨职责文件。  
3. 契约快照巡检通过：L2/L3 错误结构与 capability 结构一致。  
4. 回滚一致性巡检通过：组合动作失败后零残留。  
5. Token 预算巡检通过：`tools/list`、`schema_hint` 均在预算内。

