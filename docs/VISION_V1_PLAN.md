# VISION_V1_PLAN（结构化 UI 视觉能力闭环）

## Executive Summary

本方案定义一个接近正式版 V1 的“结构化视力（UI）闭环”，目标是在不依赖截图的前提下，让 L1（Cursor/Codex）完成：

1. UI 元素定位：从 viewport 点位稳定命中到 anchor（`object_id + path`）。
2. UI 结构读取：返回可用于定位与规则检查的树、组件摘要、Rect 关键数据。
3. 规则化布局验证：多分辨率下输出结构化 `issues[]`。
4. UI 写入：最小但高频的 RectTransform/Image/TMP 字段可写。
5. 结构化报告：读/检/写均回传可追踪诊断字段与可恢复建议。

V1 的核心设计选择：
- 保留现有 registry 架构，不新增主干 switch-case。
- `get_ui_tree` 增强字段，`hit_test_ui_at_viewport_point` 与 `validate_ui_layout` 新增为 read query。
- 写入优先走 `set_ui_properties`（专用写指令），内部映射到现有 `apply_visual_actions` 体系，复用 OCC、anchor、Undo、错误模板。

---

## Existing Code Baseline（引用真实挂载点）

### 1) MCP Command 注册/路由

- MCP 入口仍是 JSON-RPC 方法分发（非 tool-name 分发）：
  - `sidecar/src/mcp/mcpServer.js`（`tools/list`、`tools/call`）
- Command 分发由 registry 统一：
  - `sidecar/src/mcp/commandRegistry.js`
  - `dispatchHttpCommand(...)`
  - `dispatchMcpTool(...)`
- 命令定义中心：
  - `sidecar/src/mcp/commands/index.js`（`MCP_COMMAND_DEFINITIONS`）
- HTTP 路由先走 registry，再处理少量系统路由：
  - `sidecar/src/api/router.js`

现状结论：新增 MCP command 不需要改 `mcpServer.js` 的 tool-name switch，但仍需改 `commands/index.js` 与 freeze 合同。

### 2) Unity L3 read query 执行入口

- Unity 主入口：
  - `Assets/Editor/Codex/Application/ConversationController.cs`
  - `ExecutePulledReadQueryAsync(...)` -> `_unityQueryRegistry.DispatchAsync(...)`
- Query registry：
  - `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs`
  - `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`
- Query handler：
  - `Assets/Editor/Codex/Infrastructure/Queries/Handlers/GetUiTreeQueryHandler.cs`
  - `Assets/Editor/Codex/Infrastructure/Queries/Handlers/HitTestUiAtScreenPointDisabledQueryHandler.cs`
- 读服务：
  - `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`

现状结论：L3 read 已 registry 化，无 per-query 主干 switch-case。

### 3) 现有 get_ui_tree 能力

- L2 command：
  - `sidecar/src/mcp/commands/get_ui_tree/validator.js`
  - `sidecar/src/mcp/commands/get_ui_tree/handler.js`
  - `sidecar/src/mcp/commands/index.js`（`get_ui_tree`）
- L3 DTO：
  - `Assets/Editor/Codex/Domain/SidecarContracts.cs`
  - `UnityGetUiTreePayload`
  - `UnityGetUiTreeData`
  - `UnityUiTreeNode`
  - `UnityUiRectTransformInfo`
- L3 实现：
  - `UnityRagReadService.GetUiTree(...)`
  - 返回 `canvases[] + roots[] + components + rect_transform`

现状结论：
- 已有结构化树，能提供 `anchor(path/object_id)`、`sibling_index`、`RectTransform` 基础字段。
- 仍缺 hit-test/validate 所需的“可点击状态、屏幕空间 rect、多分辨率语义、文本溢出指标”等字段。

### 4) 现有 hit-test 能力

- L2 命令仍存在，但执行直接禁用：
  - `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js` -> `E_COMMAND_DISABLED`
- L3 query handler 仍会调用 read service，但 read service 同样禁用：
  - `UnityRagReadService.HitTestUiAtScreenPoint(...)` -> `E_COMMAND_DISABLED`
- 工具可见性策略默认隐藏该工具：
  - `sidecar/src/ports/contracts.js`（`MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools`）

现状结论：V1 需重建 hit-test 的“结构化可用路径”，不能依赖当前禁用实现。

### 5) 现有写链路（Action）

- L2 写指令：
  - `apply_visual_actions` 在 `sidecar/src/mcp/commands/index.js`
- 写服务与 OCC：
  - `sidecar/src/application/mcpGateway/mcpEyesWriteService.js`
  - `validateWriteReadToken(...)`
  - `validateMcpApplyVisualActions(...)`
  - `submitUnityTask(...)`
  - `sidecar/src/application/unitySnapshotService.js`（`validateReadTokenForWrite`）
- L2->L3 bridge：
  - `sidecar/src/application/unityDispatcher/runtimeUtils.js`
  - `buildUnityActionRequest(...)`
- L3 执行：
  - `ConversationController.TryValidateActionRequestPayload(...)`
  - `UnityVisualActionExecutor.Execute(...)`（registry dispatch）
  - `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`

现状结论：
- OCC/read_token + write_anchor + action anchor 已有硬校验。
- UI 常用写 action 已存在（RectTransform/Image/Text/LayoutElement），可直接复用。

### 6) validator/schema/contracts 与错误模板

- Tool schema 来源：`sidecar/src/mcp/commands/index.js`
- 输入校验：各命令 `validator.js` + `sidecar/src/domain/validators.js`
- 协议冻结：`sidecar/src/ports/contracts.js`
- 错误模板：`sidecar/src/application/turnPolicies.js`（`MCP_ERROR_FEEDBACK_TEMPLATES`）
- 错误归一：`sidecar/src/application/mcpGateway/mcpErrorFeedback.js`（`withMcpErrorFeedback`）

现状结论：已有统一模板与校验体系，可直接承接 V1 新接口。

---

## API Specs（4 个接口最终形态）

以下为 V1 最终接口形态。命名以可迁移与兼容为原则：

1. `get_ui_tree`（增强现有接口）
2. `hit_test_ui_at_viewport_point`（新接口，替代已禁用 `hit_test_ui_at_screen_point`）
3. `validate_ui_layout`（新接口）
4. `set_ui_properties`（新写接口，内部复用 `apply_visual_actions`）

### 1) `get_ui_tree`（read, stable）

#### 输入（建议）

```json
{
  "ui_system": "auto",
  "scope": {
    "root_path": "Scene/Canvas/HUD"
  },
  "include_inactive": true,
  "include_components": true,
  "include_layout": true,
  "include_interaction": true,
  "include_text_metrics": true,
  "max_depth": 6,
  "node_budget": 1000,
  "char_budget": 120000,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "timeout_ms": 10000
}
```

#### 输出（建议）

```json
{
  "ok": true,
  "captured_at": "2026-03-01T10:00:00.000Z",
  "read_token": { "...": "..." },
  "data": {
    "ui_system": "ugui",
    "scope": { "root_path": "Scene/Canvas/HUD" },
    "returned_node_count": 134,
    "truncated": false,
    "runtime_resolution": { "width": 1920, "height": 1080 },
    "runtime_source": "canvas_pixel_rect",
    "canvases": [
      {
        "object_id": "go_canvas_hud",
        "path": "Scene/Canvas/HUD",
        "name": "HUD",
        "render_mode": "ScreenSpaceOverlay",
        "sorting_order": 100,
        "reference_resolution": { "width": 1920, "height": 1080 }
      }
    ],
    "roots": [
      {
        "anchor": {
          "object_id": "go_btn_start",
          "path": "Scene/Canvas/HUD/StartButton"
        },
        "name": "StartButton",
        "active_in_hierarchy": true,
        "sibling_index": 3,
        "rect_transform": {
          "anchor_min_x": 0.5,
          "anchor_min_y": 0.5,
          "anchor_max_x": 0.5,
          "anchor_max_y": 0.5,
          "pivot_x": 0.5,
          "pivot_y": 0.5,
          "anchored_position_x": 0,
          "anchored_position_y": -120,
          "size_delta_x": 280,
          "size_delta_y": 72
        },
        "rect_screen_px": {
          "x": 820,
          "y": 444,
          "width": 280,
          "height": 72
        },
        "interaction": {
          "raycast_target": true,
          "interactable": true,
          "blocks_raycast": true,
          "has_graphic_raycaster": true
        },
        "text_metrics": {
          "overflowing": false,
          "preferred_width": 96,
          "preferred_height": 28
        },
        "components_summary": [
          { "type": "Button", "enabled": true },
          { "type": "Image", "enabled": true },
          { "type": "TMP_Text", "enabled": true }
        ],
        "children": []
      }
    ]
  }
}
```

#### 基于当前实现需补齐字段

当前已有：`anchor(path/object_id)`、`active`、`sibling_index`、`components`、`rect_transform`。  
V1 需补：`rect_screen_px`、`interaction`（interactable/raycast/blocks_raycast）、`text_metrics`、`scope` 结构化对象。

挂载点：
- L2 validator/handler：`sidecar/src/mcp/commands/get_ui_tree/*`
- L3 DTO：`Assets/Editor/Codex/Domain/SidecarContracts.cs`
- L3 组装：`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`

#### V1 addendum for `get_ui_tree`

- `get_ui_tree` should return `runtime_resolution` + `runtime_source` in the top-level `data` payload.
- This aligns tree snapshots with hit-test/validate coordinate mapping and reduces ambiguity when `CanvasScaler` is active.
- `rect_screen_px` must use the same origin as hit-test: `coord_origin=bottom_left`.

---

### 2) `hit_test_ui_at_viewport_point`（read, stable）

> 新增命令；旧命令 `hit_test_ui_at_screen_point` 保持 deprecated + disabled（fail-closed）。

#### 输入（建议）

```json
{
  "view": "game",
  "coord_space": "viewport_px",
  "x": 960,
  "y": 540,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "scope": {
    "root_path": "Scene/Canvas/HUD"
  },
  "max_results": 8,
  "include_non_interactable": false,
  "timeout_ms": 5000
}
```

也支持：
- `coord_space = "normalized"`，则 `x/y` 取 [0,1]。

#### 输出（建议）

```json
{
  "ok": true,
  "captured_at": "2026-03-01T10:00:01.000Z",
  "read_token": { "...": "..." },
  "data": {
    "view": "game",
    "coord_space": "viewport_px",
    "coord_origin": "bottom_left",
    "requested_point": { "x": 960, "y": 540 },
    "mapped_point": { "x": 960, "y": 540 },
    "resolution": { "width": 1920, "height": 1080 },
    "runtime_resolution": { "width": 1920, "height": 1080 },
    "runtime_source": "canvas_pixel_rect",
    "approximate": false,
    "approx_reason": null,
    "confidence": "high",
    "hit_count": 2,
    "hits": [
      {
        "rank": 1,
        "anchor": {
          "object_id": "go_btn_start",
          "path": "Scene/Canvas/HUD/StartButton"
        },
        "name": "StartButton",
        "component": "Button",
        "interactable": true,
        "raycast_target": true,
        "rect_screen_px": { "x": 820, "y": 444, "width": 280, "height": 72 },
        "z_order_hint": 1003
      }
    ]
  }
}
```

#### 实现要求（V1 强约束）

- 禁止依赖桌面坐标与 `ReadScreenPixel`。
- 仅依赖 UGUI 结构和 Raycaster/RectTransform 计算路径（Unity 不前台也可执行）。
- 通过 `GraphicRaycaster.Raycast` + `EventSystem`/PointerEventData 得到命中栈（top->down）。
- 对 `ScreenSpaceOverlay` 与 `ScreenSpaceCamera` 分别处理坐标映射；V1 优先 UGUI。

挂载点：
- L2 command 新目录：`sidecar/src/mcp/commands/hit_test_ui_at_viewport_point/*`
- L3 query handler 新增：`Assets/Editor/Codex/Infrastructure/Queries/Handlers/HitTestUiAtViewportPointQueryHandler.cs`
- L3 read service 新增方法：`UnityRagReadService.HitTestUiAtViewportPoint(...)`
- Query 注册：`UnityQueryRegistryBootstrap.cs`

#### V1 reliability clarifications for `hit_test_ui_at_viewport_point`

- Runtime resolution source is frozen with strict priority:
  1. `Canvas.pixelRect` of scope-matched overlay/main canvas (`display 0`)
  2. largest `Canvas.pixelRect` when multiple canvases are available
  3. request `resolution` fallback with `runtime_source=fallback_req_resolution`
- Scope binding rule is strict:
  - when `scope.root_path` points to a subtree under a specific Canvas, runtime selection must prefer that Canvas (or its nearest ancestor Canvas), and must not switch to another unrelated full-screen Canvas.
- Response must include:
  - `runtime_resolution.{width,height}`
  - `runtime_source` (`canvas_pixel_rect|largest_canvas_pixel_rect|fallback_req_resolution`)
  - `coord_origin` and `mapped_point`
- Coordinate contract is frozen:
  - `coord_origin=bottom_left` for `viewport_px` and `normalized`
  - if caller provides top-left convention, convert with `mapped_y = runtime_h - 1 - y`
  - raw mapping formula:
    - `viewport_px`: `raw_mapped_x = x / request_w * runtime_w`, `raw_mapped_y = y / request_h * runtime_h`
    - `normalized`: `raw_mapped_x = x * runtime_w`, `raw_mapped_y = y * runtime_h`
- Coordinate mapping must clamp:
  - `mapped_x = clamp(round(raw_mapped_x), 0, runtime_w - 1)`
  - `mapped_y = clamp(round(raw_mapped_y), 0, runtime_h - 1)`
  - the clamped value is the final `mapped_point` returned to L1.
- Raycast missing fallback is allowed but must be explicit:
  - `approximate=true`
  - `approx_reason=NO_RAYCAST_SOURCE`
  - `confidence=low|medium`

---

### 3) `validate_ui_layout`（read, stable）

#### 输入（建议）

```json
{
  "scope": {
    "root_path": "Scene/Canvas/HUD"
  },
  "resolutions": [
    { "name": "landscape_fhd", "width": 1920, "height": 1080 },
    { "name": "portrait_fhd", "width": 1080, "height": 1920 }
  ],
  "checks": [
    "OUT_OF_BOUNDS",
    "OVERLAP",
    "NOT_CLICKABLE",
    "TEXT_OVERFLOW"
  ],
  "max_issues": 200,
  "time_budget_ms": 1200,
  "layout_refresh_mode": "scoped_roots_only",
  "timeout_ms": 15000
}
```

#### 输出（建议）

```json
{
  "ok": true,
  "captured_at": "2026-03-01T10:00:02.000Z",
  "read_token": { "...": "..." },
  "data": {
    "scope": { "root_path": "Scene/Canvas/HUD" },
    "resolutions": [
      { "name": "landscape_fhd", "width": 1920, "height": 1080 },
      { "name": "portrait_fhd", "width": 1080, "height": 1920 }
    ],
    "time_budget_ms": 1200,
    "partial": false,
    "truncated_reason": null,
    "issue_count": 3,
    "issues": [
      {
        "anchor": {
          "object_id": "go_btn_start",
          "path": "Scene/Canvas/HUD/StartButton"
        },
        "issue_type": "OUT_OF_BOUNDS",
        "severity": "error",
        "resolution": "portrait_fhd",
        "details": "Rect exceeds right boundary by 24px",
        "suggestion": "Reduce width or update anchors to fit portrait width."
      }
    ]
  }
}
```

#### V1 必须支持 issue_type 与实现思路

每条 `issues[]` 建议补充统一字段：
- `mode`：`direct_runtime|derived_only|theoretical_with_raycast_context|static_only`
- `confidence`：`high|medium|low`

1. `OUT_OF_BOUNDS`
- 思路：节点 `rect_screen_px` 与所属 Canvas 可视区域 AABB 比较。
- 近似：使用轴对齐矩形，不做旋转多边形裁剪。

2. `OVERLAP`
- 思路：同 Canvas 同层级可见节点两两做 AABB 交集，交集面积超过阈值触发。
- 近似：V1 忽略复杂遮罩链，先按 `z_order_hint + sibling_index` 近似。

3. `NOT_CLICKABLE`
- 思路：对可交互组件（Button/Toggle/Slider/InputField/TMP_InputField）检查：
  - active、component.enabled、interactable
  - CanvasGroup(`blocksRaycasts`, `alpha`)
  - Graphic `raycastTarget`
  - 场景是否有 EventSystem/GraphicRaycaster

4. `TEXT_OVERFLOW`
- 思路：
  - TMP：优先 `isTextOverflowing` + preferred size 对比 rect
  - UGUI Text：`cachedTextGeneratorForLayout` preferredWidth/Height 对比 rect
- 近似：多语言换行场景允许少量误报，标记 `severity=warning` 可配置。

挂载点：
- L2 command 新目录：`sidecar/src/mcp/commands/validate_ui_layout/*`
- L3 query handler 新增：`Assets/Editor/Codex/Infrastructure/Queries/Handlers/ValidateUiLayoutQueryHandler.cs`
- L3 rule engine 新增：`Assets/Editor/Codex/Infrastructure/UiValidation/UiLayoutValidator.cs`

#### V1 validation model freeze (multi-resolution + performance)

- V1 uses a pure derived model for multi-resolution checks and does not mutate global GameView/editor state.
- `CanvasScaler` (`ScaleWithScreenSize`) uses one canonical formula:
  - `scaleX = runtime_w / ref_w`
  - `scaleY = runtime_h / ref_h`
  - `uiScale = pow(scaleX, 1 - matchWidthOrHeight) * pow(scaleY, matchWidthOrHeight)`
- `rect_screen_px` in validate is an AABB approximation derived from `RectTransform` + `uiScale` (not pixel-perfect clipping).
- `rect_screen_px` in validate uses `bottom_left` origin, consistent with hit-test `coord_origin`.
- `OVERLAP` complexity control is mandatory:
  - compare only within same canvas group
  - default to visible/interactive candidates
  - use spatial hash buckets before pairwise overlap
- `NOT_CLICKABLE` semantics are frozen as “theoretical clickability” (attribute/raycast-path feasibility), not a point-hit guarantee.
- `NOT_CLICKABLE` output mode is frozen:
  - raycast path available: `mode=theoretical_with_raycast_context`
  - raycast path unavailable: `mode=static_only`, `severity=warning`
- `TEXT_OVERFLOW` cross-resolution semantics are frozen:
  - current runtime resolution: high-confidence check after layout refresh
  - other requested resolutions: derived-only approximation with `mode=derived_only`, default `severity=warning`
- Layout refresh policy before validation:
  - call `Canvas.ForceUpdateCanvases()`
  - call `LayoutRebuilder.ForceRebuildLayoutImmediate` only for candidate roots
  - call `TMP_Text.ForceMeshUpdate()` only for candidate text nodes
- Budget behavior:
  - stop when `time_budget_ms` is exceeded
  - return `partial=true` and `truncated_reason=TIME_BUDGET_EXCEEDED|NODE_BUDGET_EXCEEDED|ISSUE_BUDGET_EXCEEDED`

---

### 4) `set_ui_properties`（write, stable）

#### 取舍结论（选择方案 B）

选择：**专用写指令 `set_ui_properties`**，不在 V1 引入通用 `set_serialized_property`。

原因：
- 当前仓库已具备对应原子 action 与治理元数据（RectTransform/Image/Text/LayoutElement）：
  - `McpActionRegistryBootstrap.cs`
  - `UnityVisualActionExecutor.cs`
- 专用写指令可直接映射到已有 action，复用 OCC、anchor、Undo、错误模型。
- 通用 `set_serialized_property` 反射面过大，V1 风险高（类型安全、可回滚、白名单治理难度高）。

#### 输入（建议）

```json
{
  "based_on_read_token": "rt_xxx",
  "write_anchor": {
    "object_id": "go_canvas_hud",
    "path": "Scene/Canvas/HUD"
  },
  "operations": [
    {
      "target_anchor": {
        "object_id": "go_btn_start",
        "path": "Scene/Canvas/HUD/StartButton"
      },
      "rect_transform": {
        "anchored_position": { "x": 0, "y": -120 },
        "size_delta": { "x": 300, "y": 80 }
      },
      "image": {
        "color": { "r": 0.2, "g": 0.6, "b": 1.0, "a": 1.0 },
        "raycast_target": true
      },
      "text": {
        "content": "Start",
        "font_size": 36,
        "color": { "r": 1, "g": 1, "b": 1, "a": 1 }
      }
    }
  ],
  "atomic": true,
  "dry_run": false,
  "thread_id": "t_default"
}
```

#### 输出（建议）

```json
{
  "status": "accepted",
  "job_id": "job_xxx",
  "planned_actions_count": 6,
  "mapped_actions": [
    "set_rect_transform_anchored_position",
    "set_rect_transform_size_delta",
    "set_ui_image_color",
    "set_ui_image_raycast_target",
    "set_ui_text_content",
    "set_ui_text_font_size"
  ]
}
```

#### `dry_run` semantics freeze (V1)

- `dry_run=true`:
  - must not submit Unity task (`submitUnityTask` is skipped)
  - must not mutate scene/runtime state
  - returns planning result only: `planned_actions_count` + `mapped_actions` (+ optional `diff_summary`)
- `dry_run=false`:
  - follows normal write path with OCC/anchor/undo/rollback checks
  - returns accepted job payload and execution lifecycle status

`dry_run=true` response example:

```json
{
  "status": "planned",
  "planned_actions_count": 6,
  "mapped_actions": [
    "set_rect_transform_anchored_position",
    "set_rect_transform_size_delta",
    "set_ui_image_color"
  ]
}
```

#### OCC / anchor / Undo / 回滚策略

- OCC/read_token 硬校验：
  - `mcpEyesWriteService.validateWriteReadToken(...)`
  - `unitySnapshotService.validateReadTokenForWrite(...)`
- 顶层与动作锚点硬校验：
  - `validateMcpApplyVisualActions(...)`
  - `ConversationController.TryValidateActionRequestPayload(...)`
- 对外禁止 `action_data_json`，只允许 `action_data`：
  - `sidecar/src/domain/validators.js`（`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`）
- Undo：
  - 现有执行器已使用 `Undo.RecordObject`/`Undo.AddComponent`（`UnityVisualActionExecutor.cs`）。
- 回滚：
  - `atomic=true` 时封装为 `composite_visual_action`（复用已有 composite handler）；
  - `atomic=true` 的语义是 *atomic with rollback verification*（不是 best effort）：
    - 失败后执行 `UndoGuard.Rollback(...)`
    - 再执行 `RollbackVerifier.VerifyAfterRollback(...)`
    - 校验失败 fail-closed：`E_COMPOSITE_ROLLBACK_INCOMPLETE`
  - `atomic=false` 时保持逐动作失败即停，不宣称原子性。

#### `set_ui_properties` 设计边界（避免双契约）

- 保留该接口是为了给 L1 提供字段级写入协议，减少直接拼装 action list 的出错率。
- 执行链路仍只有一套：`set_ui_properties -> apply_visual_actions -> UnityVisualActionExecutor`。
- 映射规则必须 deterministic：
  - 同一输入必须得到同一 `mapped_actions` 顺序
  - 不允许“同字段多映射且无优先级”歧义
  - 回包必须始终包含 `mapped_actions` 供审计

#### `set_ui_properties` 到现有 action 映射（V1）

| set_ui_properties 字段 | 目标 action_type | 当前实现位置 |
|---|---|---|
| `rect_transform.anchored_position` | `set_rect_transform_anchored_position` | `McpActionRegistryBootstrap.cs` + `ValuePackVisualActionHandlers.cs` |
| `rect_transform.size_delta` | `set_rect_transform_size_delta` | 同上 |
| `rect_transform.pivot` | `set_rect_transform_pivot` | 同上 |
| `rect_transform.anchors` | `set_rect_transform_anchors` | 同上 |
| `image.color` | `set_ui_image_color` | 同上 |
| `image.raycast_target` | `set_ui_image_raycast_target` | 同上 |
| `text.content` | `set_ui_text_content` | 同上 |
| `text.color` | `set_ui_text_color` | 同上 |
| `text.font_size` | `set_ui_text_font_size` | 同上 |
| `layout_element.*` | `set_layout_element` | 同上 |

---

## Registration & Decoupling

### 新增 4 接口时，是否需要改主干 switch-case

结论：**不需要改主干 tool-name switch-case**，但会改中心化注册文件。

需要改动：

L2：
1. 新建命令模块目录（validator/handler）。
2. `sidecar/src/mcp/commands/index.js` 增加定义。
3. `sidecar/src/ports/contracts.js` 增加 route/tool freeze（以及可见性策略）。
4. 对应测试快照更新（r11/r12 系列）。

L3：
1. `IUnityQueryHandler.cs` 增加 query type 常量。
2. 新建 query handler 文件。
3. `UnityQueryRegistryBootstrap.cs` 注册 handler。
4. `UnityRagReadService.cs` 增加对应 read 方法与 DTO 映射。

无需改：
- `mcpServer.js` 的 tool-name 分发逻辑。
- `ConversationController.cs` 的 per-query switch（当前已 registry dispatch）。

### 当前仍存在的主干侵入点与 V1 最小改造

侵入点：
- `commands/index.js` 仍是命令中心数组。
- `contracts.js` freeze 清单仍需手工同步。

V1 最小改造：
- 先不重构 registry loader，保持现状；
- 仅新增 UI V1 命令项 + freeze 清单 + 快照测试，控制变更面；
- 在文档与测试里明确“新增命令必须同步三处：index / contracts / snapshot”。

### 新增一个 UI rule 的最短路径（<=8 步）

1. 在 `UiLayoutValidator` 新增 rule 函数与 `issue_type` 常量。  
2. 在 `validate_ui_layout` handler 参数校验中放行该 `issue_type`。  
3. 在 `turnPolicies.js` 增加对应错误模板（如需）。  
4. 补 Unity EditMode rule 单测。  
5. 补 Node validator 单测。  
6. 更新 `get_tool_schema` 快照（如 schema 变更）。  
7. 跑 Node CI 门禁。  
8. 跑 Unity 发布前门禁。

### 新增一个 UI command 的最短路径（<=8 步）

1. 新建 `sidecar/src/mcp/commands/<name>/validator.js`。  
2. 新建 `sidecar/src/mcp/commands/<name>/handler.js`。  
3. 在 `commands/index.js` 注册定义与 schema。  
4. 在 `contracts.js` 同步 route/tool freeze 与可见性策略。  
5. 若是 read query：新增 L3 handler + bootstrap 注册。  
6. 若是 write：映射到 `apply_visual_actions` 或 `submitUnityTask`。  
7. 增加 Node contract+validator 测试。  
8. 增加 Unity EditMode 行为测试。

---

## Validation & Error Model

### 1) Schema 与 validator 一致性（必须）

现有机制基础：
- Tool schema 在 `commands/index.js`
- validator 在命令目录
- `get_tool_schema` 可返回 full schema
- 现有快照测试：`r11-command-contract-snapshot.test.js`、`r12-tool-registry-consistency.test.js`

V1 加固建议：
- 新增 `sidecar/tests/application/ui-v1-tool-schema-validator-parity.test.js`：
  - 对 4 个接口做“schema required 字段”和“validator required 字段”一致性断言。
- 新增 `sidecar/tests/domain/validators.validate-ui-layout.test.js`
- 新增 `sidecar/tests/domain/validators.set-ui-properties.test.js`

### 2) 对外禁止 `action_data_json`

保持现有策略，不变更：
- 外部 payload 只能传 `action_data`
- `action_data_json` 只允许 L2->L3 内部 bridge 生成
- 违规返回：`E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`

### 3) unknown action / unknown command fail-closed

保持现有 fail-closed：
- unknown action：L2 可 submit-open，但执行时若 L3 无 handler，最终失败 `E_ACTION_HANDLER_NOT_FOUND`
  - 参考：`sidecar/tests/application/mcp-command-unknown-action-fail-closed.test.js`
- unknown/disabled command：
  - disabled：`E_COMMAND_DISABLED`（如现有 hit-test）
  - 路由不存在：`E_NOT_FOUND`（router 默认 404）
  - 工具不可见：`Tool not enabled by visibility policy`（MCP tools/call 层）

### 4) V1 错误码表（>=10，含层级）

| error_code | 产生层 | 适用接口 | 含义 |
|---|---|---|---|
| `E_SCHEMA_INVALID` | L2 | 全部 | 入参结构非法 |
| `E_UI_TREE_SOURCE_NOT_FOUND` | L3->L2 | get_ui_tree | UI root/canvas 不存在 |
| `E_UI_TREE_QUERY_FAILED` | L3->L2 | get_ui_tree | 树构建失败 |
| `E_UI_HIT_TEST_SOURCE_NOT_FOUND` | L3->L2 | hit_test | 无 EventSystem/GraphicRaycaster/目标源 |
| `E_UI_HIT_TEST_QUERY_FAILED` | L3->L2 | hit_test | 命中流程失败 |
| `E_UI_HIT_TEST_APPROXIMATE_ONLY` | L3->L2 | hit_test | 仅能返回几何近似命中，非真实 raycast 结果 |
| `E_UI_COORD_MAPPING_INVALID` | L2/L3 | hit_test | 坐标系/原点/范围非法 |
| `E_UI_RUNTIME_RESOLUTION_UNAVAILABLE` | L3->L2 | hit_test/validate_ui_layout | 无法确定 runtime 分辨率 |
| `E_UI_LAYOUT_VALIDATION_FAILED` | L3->L2 | validate_ui_layout | 校验执行失败 |
| `E_UI_LAYOUT_SCOPE_NOT_FOUND` | L3->L2 | validate_ui_layout | scope root 不存在 |
| `E_UI_LAYOUT_PARTIAL` | L3->L2 | validate_ui_layout | 预算触发，仅返回部分结果 |
| `E_STALE_SNAPSHOT` | L2 | set_ui_properties | read_token 过期/不匹配 |
| `E_ACTION_SCHEMA_INVALID` | L2/L3 | set_ui_properties | 锚点/动作 schema 不合法 |
| `E_TARGET_ANCHOR_CONFLICT` | L3 | set_ui_properties | write_anchor 与 action anchor 冲突 |
| `E_ACTION_HANDLER_NOT_FOUND` | L3->L2 | set_ui_properties | 映射出的 action 在 L3 未注册 |
| `E_ACTION_COMPONENT_NOT_FOUND` | L3->L2 | set_ui_properties | 目标缺失必要组件（如 Image/TMP） |
| `E_COMPOSITE_ROLLBACK_INCOMPLETE` | L3->L2 | set_ui_properties | atomic 回滚校验失败 |
| `E_COMMAND_DISABLED` | L2/L3 | 旧 hit_test | 工具禁用（fail-closed） |
| `E_UNITY_NOT_CONNECTED` | L2 | read/write | Unity 未就绪 |
| `E_QUERY_TIMEOUT` | L2 | read | Query 超时 |

所有失败回包通过 `withMcpErrorFeedback` 输出 `suggestion` 与 `recoverable`。

---

## Observability

V1 需在 read/write 回包中补充统一诊断字段，便于跨层追踪：

1. `correlation_id`
- 建议默认复用 `request_id`，并在 Sidecar 透传到 Unity query/report。

2. `handler_name`
- L3 记录具体 handler（如 `GetUiTreeQueryHandler`、`ValidateUiLayoutQueryHandler`）。

3. `timing`
- `timing.queue_wait_ms`
- `timing.unity_exec_ms`
- `timing.total_ms`

4. `scope_token`
- 由 `ui_system + root_path + resolution` 生成短 hash，便于聚合分析。

5. `resolution_context`
- 对 `hit_test`/`validate` 输出实际使用分辨率与坐标映射信息。
6. `runtime_resolution` + `runtime_source`
- 记录本次命中的 runtime 宽高与来源（`canvas_pixel_rect|largest_canvas_pixel_rect|fallback_req_resolution`）。
7. `coord_origin` + `mapped_point`
- 固定返回坐标原点与落地点，便于排查“上下颠倒/映射漂移”。
8. `approximate` + `approx_reason` + `confidence`
- 标记是否走几何近似命中，避免 L1 将近似命中误判为真实可点。
9. `budget`
- 返回 `time_budget_ms`、`time_spent_ms`、`partial`、`truncated_reason`。

建议新增指标（L2 metrics）：
- `ui_tree_query_total`, `ui_tree_query_failed_total`
- `ui_hit_test_total`, `ui_hit_test_failed_total`
- `ui_layout_validate_total`, `ui_layout_issue_total`
- `ui_set_properties_total`, `ui_set_properties_failed_total`
- `ui_error_code_missing_total`（防吞码）
- `ui_validate_partial_total`
- `ui_hit_test_approximate_total`

---

## Test Plan & Acceptance

### 双门禁策略

### A. Node/Sidecar（CI 强制，必须通过）

1. 合同快照
- `r11-command-contract-snapshot.test.js`
- `r12-tool-registry-consistency.test.js`
- 新增 `ui-v1-tool-contract-snapshot.test.js`

2. validator 行为
- `validators.get-ui-tree.test.js`
- `validators.hit-test-ui-at-screen-point.test.js`（保留兼容）
- 新增 `validators.hit-test-ui-at-viewport-point.test.js`
- 新增 `validators.validate-ui-layout.test.js`
- 新增 `validators.set-ui-properties.test.js`
- 新增 `validators.coord-mapping-clamp.test.js`
- 新增 `validators.dry-run.test.js`

3. 路由/可见性/错误模板
- `r11-screenshot-route-and-feedback.test.js`
- `mcp-tool-schema-minimal.test.js`
- 新增 `ui-v1-tool-schema-validator-parity.test.js`

### B. Unity EditMode（发布前门禁）

至少 3 条必须跑（建议 5 条）：

1. `UnityRagReadServiceUiTreeTests`（已有，增强断言新增字段）
2. 新增 `UnityRagReadServiceHitTestViewportTests`
   - 覆盖 clamp 后 `mapped_point` 始终在 `[0,runtime-1]`
   - 覆盖 `scope.root_path` 命中子树时的 canvas 选择优先级
3. 新增 `UnityUiLayoutValidatorTests`
   - 覆盖 `time_budget_ms`、`partial`、`truncated_reason`
   - 覆盖 `CanvasScaler` 推导模型在横竖屏下的一致性
   - 覆盖 `TEXT_OVERFLOW` 在非当前分辨率返回 `mode=derived_only`
   - 覆盖无 raycast 源时 `NOT_CLICKABLE` 返回 `mode=static_only` + `warning`
4. 新增 `UnitySetUiPropertiesMappingTests`
   - 覆盖 `set_ui_properties` 映射 action 在 L3 registry 全部可调度
   - 覆盖映射 action capability 的 `undo_safety=atomic_safe`
5. `UnityAnchorExecutionTests`（确保 write_anchor/target_anchor 一致性不回归）
6. `AtomicSafeAdmissionTests` + `CompositeTransactionRunnerTests`
- 模板：执行 -> 注入失败 -> 回滚 -> `VerifyAfterRollback` 断言
- 规则：凡声明 `undo_safety=atomic_safe` 的 handler，注册前必须通过该模板

### 验收脚本流程（`diagnose-ui.js`）

已新增：`sidecar/scripts/diagnose-ui.js`

流程：
1. 调 `get_ui_tree`（scope=HUD，输出 node_count 与是否 truncated）
2. 调 `hit_test_ui_at_viewport_point`（中心点 + 按钮点）
3. 调 `validate_ui_layout`（1080p + 1080x1920）
4. 可选调 `set_ui_properties`（修改一个按钮文本与位置）
5. 再调 `get_ui_tree` 验证变更
6. 输出 `diagnose-ui-report.json`（issues、commands、timings、error_codes）
7. 报告强制包含：`runtime_source`、`coord_origin`、`mapped_point`、`approximate`、`partial`、`truncated_reason`

---

## 7. 执行顺序与任务矩阵（VISION-V1-CLOSE）

### 7.1 执行顺序（按依赖）
1. `Phase A / L2 契约与注册收口`：V1-CLOSE-L2-01、V1-CLOSE-L2-02、V1-CLOSE-L2-03、V1-CLOSE-L2-04  
2. `Phase B / L3 Query 与规则引擎收口`：V1-CLOSE-L3-01、V1-CLOSE-L3-02、V1-CLOSE-L3-03、V1-CLOSE-L3-04  
3. `Phase C / 资产与验证收口`：V1-CLOSE-ASSET-01、V1-CLOSE-QA-01、V1-CLOSE-QA-02、V1-CLOSE-E2E-01

### 7.2 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| V1-CLOSE-L2-01 | Phase A | `get_ui_tree` 契约补齐 | `sidecar/src/mcp/commands/get_ui_tree/validator.js`、`sidecar/src/mcp/commands/get_ui_tree/handler.js`、`sidecar/src/mcp/commands/index.js`、`sidecar/src/ports/contracts.js` | 返回补齐 `runtime_resolution/runtime_source` 与树字段一致性 | `get_tool_schema` 与 validator 一致；回包包含 runtime 上下文 |
| V1-CLOSE-L2-02 | Phase A | `hit_test_ui_at_viewport_point` 收口 | `sidecar/src/mcp/commands/hit_test_ui_at_viewport_point/validator.js`、`sidecar/src/mcp/commands/hit_test_ui_at_viewport_point/handler.js`、`sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`、`sidecar/src/mcp/commands/index.js`、`sidecar/src/ports/contracts.js` | 新命令启用；旧 `hit_test_ui_at_screen_point` 保持 fail-closed；坐标映射 freeze（scope 优先 + clamp） | 边界点不再越界；`mapped_point` 总在 `[0,runtime-1]`；旧命令只返回禁用/弃用错误 |
| V1-CLOSE-L2-03 | Phase A | `validate_ui_layout` 收口 | `sidecar/src/mcp/commands/validate_ui_layout/validator.js`、`sidecar/src/mcp/commands/validate_ui_layout/handler.js`、`sidecar/src/mcp/commands/index.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 支持 4 类 issue + budget/partial；补齐 `TEXT_OVERFLOW` 跨分辨率 `mode=derived_only` 与 `NOT_CLICKABLE` `mode=static_only` 口径 | `OUT_OF_BOUNDS/OVERLAP/NOT_CLICKABLE/TEXT_OVERFLOW` 可稳定返回；超时返回 `partial`；语义不冲突 |
| V1-CLOSE-L2-04 | Phase A | `set_ui_properties` 写接口收口 | `sidecar/src/mcp/commands/set_ui_properties/validator.js`、`sidecar/src/mcp/commands/set_ui_properties/handler.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/domain/validators.js` | 字段级写接口映射到现有 action 链，禁止外部 `action_data_json`；冻结 `dry_run` 为“仅规划不提交” | `dry_run=true` 不提交 Unity、不改状态；返回 `planned_actions_count + mapped_actions` |
| V1-CLOSE-L3-01 | Phase B | hit-test Query 实现 | `Assets/Editor/Codex/Infrastructure/Queries/Handlers/HitTestUiAtViewportPointQueryHandler.cs`、`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | 实现 viewport 坐标命中栈，回包含 `coord_origin/runtime_source/approximate`，并执行 clamp 与 scope-canvas 绑定 | Unity 非前台可执行；无 raycast 源时有明确 approximate 标记；跨边界点不越界 |
| V1-CLOSE-L3-02 | Phase B | layout validator 实现 | `Assets/Editor/Codex/Infrastructure/UiValidation/UiLayoutValidator.cs`、`Assets/Editor/Codex/Infrastructure/Queries/Handlers/ValidateUiLayoutQueryHandler.cs`、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | 多分辨率纯推导模型 + `time_budget_ms` + `truncated_reason`；`TEXT_OVERFLOW` 跨分辨率 derived-only；`NOT_CLICKABLE` static-only 降级 | 不污染 GameView 全局状态；预算触发时回包完整且可诊断；误报语义可解释 |
| V1-CLOSE-L3-03 | Phase B | `get_ui_tree` 字段增强 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Infrastructure/Queries/Handlers/GetUiTreeQueryHandler.cs`、`Assets/Editor/Codex/Domain/SidecarContracts.cs` | 补齐 interaction/text/rect/runtime 关键字段，并冻结 `rect_screen_px` 为 bottom-left origin | UI 树可直接支撑 hit-test 与 validate，不再缺关键字段且坐标口径一致 |
| V1-CLOSE-L3-04 | Phase B | 写链路原子语义收口 | `Assets/Editor/Codex/Infrastructure/Actions/CompositeTransactionRunner.cs`、`Assets/Editor/Codex/Infrastructure/Actions/RollbackVerifier.cs`、`Assets/Editor/Codex/Infrastructure/Actions/CompositeVisualActionHandler.cs`、`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | `atomic=true` 语义固定为 rollback verification（非 best effort） | 回滚失败 fail-closed 为 `E_COMPOSITE_ROLLBACK_INCOMPLETE` |
| V1-CLOSE-ASSET-01 | Phase C | 脚本与说明收口 | `sidecar/scripts/diagnose-ui.js`、`sidecar/scripts/README.md`、`sidecar/package.json` | 新增 UI 验收脚本并固化输出字段，提供 `npm run diagnose:ui` 入口 | 脚本可串联 `get_ui_tree -> hit_test -> validate -> set` 并产出报告 |
| V1-CLOSE-QA-01 | Phase C | Sidecar 回归收口 | `sidecar/tests/application/ui-v1-tool-contract-snapshot.test.js`、`sidecar/tests/application/ui-v1-tool-schema-validator-parity.test.js`、`sidecar/tests/domain/validators.hit-test-ui-at-viewport-point.test.js`、`sidecar/tests/domain/validators.validate-ui-layout.test.js`、`sidecar/tests/domain/validators.set-ui-properties.test.js`、`sidecar/tests/domain/validators.coord-mapping-clamp.test.js`、`sidecar/tests/domain/validators.dry-run.test.js` | 契约、validator、错误码、路由可见性全覆盖，并覆盖 clamp/dry_run 语义 | Node CI 全绿；unknown/disabled fail-closed 持续成立；dry_run 不触发提交 |
| V1-CLOSE-QA-02 | Phase C | Unity 回归收口 | `Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceHitTestViewportTests.cs`、`Assets/Editor/Codex/Tests/EditMode/UnityUiLayoutValidatorTests.cs`、`Assets/Editor/Codex/Tests/EditMode/UnitySetUiPropertiesMappingTests.cs`、`Assets/Editor/Codex/Tests/EditMode/AtomicSafeAdmissionTests.cs`、`Assets/Editor/Codex/Tests/EditMode/CompositeTransactionRunnerTests.cs` | 覆盖命中、布局预算、写映射、原子回滚准入，并覆盖 scope-canvas 绑定与 derived/static mode | 编译 + EditMode 全绿；`atomic_safe` handler 准入测试通过；关键 mode 字段断言通过 |
| V1-CLOSE-E2E-01 | Phase C | 验收文档收口 | `docs/VISION_V1_PLAN.md`、`Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md`（如需同步） | 固化 V1 验收流程与回包关键字段检查清单 | Cursor/Codex 按文档可重复完成端到端验收 |

---

### Phase C 验收执行（V1-CLOSE-E2E-01）
1. Node 侧回归（Sidecar）
   - `cd sidecar`
   - `node --test "tests/application/ui-v1-tool-contract-snapshot.test.js" "tests/application/ui-v1-tool-schema-validator-parity.test.js" "tests/domain/validators.coord-mapping-clamp.test.js" "tests/domain/validators.dry-run.test.js" "tests/domain/validators.hit-test-ui-at-viewport-point.test.js" "tests/domain/validators.validate-ui-layout.test.js" "tests/domain/validators.set-ui-properties.test.js"`
2. 端到端诊断报告
   - `npm run diagnose:ui -- --base-url http://127.0.0.1:46321 --scope-root Scene/Canvas/HUD --x 960 --y 540 --width 1920 --height 1080`
   - 产物：`diagnose-ui-report.json`
3. 报告通过标准（必须全部满足）
   - `checks.tree_runtime_resolution_present === true`
   - `checks.hit_runtime_resolution_present === true`
   - `checks.hit_coord_origin_bottom_left === true`
   - `checks.hit_mapped_point_in_runtime_range === true`
   - `checks.validate_runtime_resolution_present === true`
   - `checks.validate_partial_flag_present === true`
   - `checks.set_has_planning_payload === true`（未 `--skip-set` 时）
4. Unity EditMode 回归（发布前门禁）
   - `UnityRagReadServiceHitTestViewportTests`
   - `UnityUiLayoutValidatorTests`
   - `UnitySetUiPropertiesMappingTests`
   - `AtomicSafeAdmissionTests`
   - `CompositeTransactionRunnerTests`

---
## V2 Screenshot Integration

### 为什么 V1 不依赖截图

1. 目标是“可定位、可验证、可写入”的结构化闭环，核心是 deterministic 数据链路。  
2. 当前截图链路在仓库中仍有模式限制（`render_output` 收口，`final_pixels` 不稳定）。  
3. 以截图为硬依赖会将 V1 稳定性绑定到 Editor 渲染时机与前台状态。

### V2 如何接入 offscreen `final_pixels`

V2 建议增加独立截图 provider（不破坏 V1 API）：

1. 方案一：Canvas 劫持合成（UGUI 优先）
- 在离屏目标 RT 中按 Canvas sort order 合成 UI + Camera 输出。

2. 方案二：GameView buffer 抽象层
- 统一从 Game 渲染缓冲读像素，避免桌面屏幕依赖。

3. 保留 V1 结构化 API 不变，新增 `visual_evidence` 字段：
- `artifact_uri`
- `pixel_hash`
- `diff_summary`

### 结构化视力 + 截图如何组合

推荐组合顺序：

1. 先 `get_ui_tree` / `hit_test` / `validate` 做结构化定位与规则诊断。  
2. 再用截图做最终“视觉微调确认”（颜色/像素级错位）。  
3. 报告合并：
- `issues_structured[]`（规则问题）
- `issues_visual[]`（像素问题）
- `anchor_cross_refs[]`（结构化 anchor 与截图区域映射）

该组合可保证：V1 即可闭环交付，V2 在不破坏契约的前提下增强最终视觉精度。

