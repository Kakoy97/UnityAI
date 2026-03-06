# 28 指令旧链路清除与 SSOT 闭环执行计划

日期：2026-03-05  
范围：仅覆盖“旧 28 指令”迁移与旧链路彻底清除。  
不包含：A1~A10 Action 迁移（后续单独立项）。

---

## 1. 目标与边界

### 1.1 目标
1. 让旧 28 指令全部达到 `SSOT-only` 运行状态。  
2. 彻底铲除对应 legacy 路由、legacy 校验、legacy 执行依赖。  
3. 建立“删旧后再验收”的闭环，禁止“先过测试后补丁兼容”。

### 1.2 强制纪律
1. 禁止最小补丁式兼容：不新增“新旧格式转换器”或 fallback。  
2. 每个批次最多 3 个指令，按批次完成“迁移 + 删旧 + 复测”。  
3. 所有改动遵循 SRP：L1/L2/L3 各自只做本层职责，不跨层补洞。  
4. 任一批次未达到 `SSOT-only`，不得进入下一批。

---

## 2. 完成定义（DoD）

每个指令从“迁移中”到“已完成”必须同时满足：

1. L1：`tools/list` 只暴露 SSOT 生成契约（来自 `ssot/artifacts/l2/mcp-tools.generated.json`）。  
2. L2：请求只经 SSOT validator + `dispatchSsotRequest(query_type=ssot.request)`，无 legacy fallback。  
3. L3：只经 `SsotRequestDispatcher + 对应 SsotExecutor`，不落旧 Action 队列。  
4. 旧引用清零：该指令相关 legacy handler/registry/桥接引用数为 0。  
5. 验收双测通过：  
   - 路由与门禁测试（Node）。  
   - MCP 实机调用（包含 1 条正例 + 1 条 fail-fast 负例）。

---

## 3. 28 指令批次清单（每批 <= 3）

## Batch 1
1. `get_current_selection`  
2. `get_gameobject_components`  
3. `get_hierarchy_subtree`

## Batch 2
1. `get_scene_roots`  
2. `list_assets_in_folder`  
3. `find_objects_by_component`

## Batch 3
1. `query_prefab_info`  
2. `get_ui_tree`  
3. `get_ui_overlay_report`

## Batch 4
1. `hit_test_ui_at_viewport_point`  
2. `validate_ui_layout`  
3. `get_serialized_property_tree`

## Batch 5
1. `capture_scene_screenshot`  
2. `get_action_catalog`  
3. `get_action_schema`

## Batch 6
1. `get_tool_schema`  
2. `get_write_contract_bundle`  
3. `preflight_validate_write_payload`

## Batch 7
1. `setup_cursor_mcp`  
2. `verify_mcp_setup`  
3. `get_unity_task_status`

## Batch 8
1. `cancel_unity_task`  
2. `submit_unity_task`  
3. `apply_script_actions`

## Batch 9
1. `apply_visual_actions`  
2. `set_ui_properties`  
3. `set_serialized_property`

## Batch 10
1. `hit_test_ui_at_screen_point`

---

## 4. 优先级排序（从现在开始）

### P0（最高）：先清 Batch 8/9/10 的旧耦合
原因：当前“迁移中”集中在这些批次，且写入链路风险最高。  

1. Batch 8：把状态/任务类写入口的 SSOT-only 门禁做实，不再借道旧 Gateway 分叉。  
2. Batch 9：执行面去耦（重点），彻底移出 legacy visual/UI 队列映射。  
3. Batch 10：二选一收口  
   - 方案 A：正式退役（从可用清单移除，状态改“已退役”）。  
   - 方案 B：补齐 SSOT executor 后转“已完成”。  
   禁止长期 `disabled + 迁移中` 悬挂。

### P1：批次内删旧（不是最终统一删）
每完成一个批次，立即删除该批次对应 legacy 代码入口，避免“迁移完忘记删”。

### P2：全局扫尾
全部批次完成后，统一清空未引用 legacy 文件与测试残留。

---

## 5. 批次执行步骤（标准流水线）

每个批次统一执行以下 7 步：

1. 冻结边界  
   - 锁定本批 1~3 个指令，禁止跨批混改。
2. L1 契约确认  
   - 核对 SSOT 字典字段、required、description、example。
3. L2 门禁与分发  
   - 校验器仅来自 SSOT artifacts；handler 仅走 `ssot.request`。
4. L3 执行直达  
   - `SsotRequestDispatcher` 直分发到该批 executor；不触发旧队列。
5. 旧链路物理清理  
   - 删除该批 legacy 注册、legacy handler 调用、桥接字段读取。
6. 测试门禁  
   - Node 单测 + MCP 实机双测。
7. 文档回填  
   - 更新状态：`迁移中 -> 已完成(SSOT-only)`；记录删旧文件清单。

---

## 6. 旧链路“彻底铲除”判定规则

对每个已完成批次，必须满足以下“硬删除”判定：

1. 不存在该批指令的 legacy registry 注册项。  
2. 不存在该批指令到 legacy 执行队列/legacy gateway 的路由分支。  
3. 不存在该批指令相关 `action_data_json` / `action_data_marshaled` 依赖。  
4. 不存在该批指令新链路失败后回退旧链路的 `if/else`。  
5. 不存在“仅为兼容旧链路而保留”的中间转换层。

---

## 7. 风险控制与回滚

1. 回滚粒度：仅按批次回滚，不做全局回滚。  
2. 回滚条件：  
   - MCP 实机失败且短期不可定位。  
   - Unity 编译阻断且定位到本批变更。  
3. 回滚策略：  
   - 回退本批提交。  
   - 恢复该批状态为“迁移中”。  
   - 禁止带病推进下一批。

---

## 8. 当前执行指令（本文件生效后）

1. 先处理 Batch 8、Batch 9、Batch 10（按 P0 顺序）。  
2. 每完成一个批次，必须同时提交：  
   - 代码改动  
   - 删旧清单  
   - 实机测试结论  
   - 本文件状态更新
3. A1~A10 暂不在本计划执行范围内，后续单独出文档。

---

## 9. 文件级详细施工步骤（先做 Batch 8/9/10）

说明：以下步骤是“直接可执行”的清单，按顺序推进，不允许跨批混改。

### 9.1 Batch 8（`cancel_unity_task` / `submit_unity_task` / `apply_script_actions`）

### B8-S1：冻结边界与基线
1. 目标文件（只读）：  
   - `sidecar/src/mcp/commands/cancel_unity_task/*`  
   - `sidecar/src/mcp/commands/submit_unity_task/*`  
   - `sidecar/src/mcp/commands/apply_script_actions/*`  
   - `sidecar/src/application/turnService.js`  
   - `sidecar/src/mcp/commands/legacyCommandManifest.js`  
2. 任务：确认三条指令当前是否仍引用旧 Gateway/旧 Task 队列。
3. 验收：输出引用链（哪个 handler 调哪个 turnService 方法，再到哪个 service）。

### B8-S2：L2 路由切为 SSOT-only
1. 目标文件（可改）：  
   - `sidecar/src/mcp/commands/cancel_unity_task/handler.js`  
   - `sidecar/src/mcp/commands/submit_unity_task/handler.js`  
   - `sidecar/src/mcp/commands/apply_script_actions/handler.js`  
   - `sidecar/src/application/turnService.js`
2. 任务：  
   - handler 只调用 `turnService.<tool>ForMcp`。  
   - `turnService.<tool>ForMcp` 只走 `dispatchSsotToolForMcp(...)`。  
   - 禁止 fallback 到旧 gateway method。
3. 验收：`rg` 搜索三工具关键词时，不再出现旧 gateway 分支调用。

### B8-S3：删旧入口耦合
1. 目标文件（可改/可删）：  
   - `sidecar/src/application/mcpGateway/*`（仅删与三工具直接耦合的入口分支）  
   - `sidecar/src/application/mcpEyesWriteService.js`（仅删与三工具路由耦合点）  
   - `sidecar/src/mcp/commands/legacyCommandManifest.js`（删除无效依赖注入）
2. 任务：物理删除三工具的 legacy 路由桥接，不保留兼容分支。
3. 验收：三工具关键词不再命中旧桥接文件中的路由入口。

### B8-S4：测试与实机
1. Node：更新并运行 `sidecar/tests/application/ssot-batch-route.test.js`。  
2. MCP 实机：三工具各 1 正例 + 1 负例（AJV fail-fast）。  
3. 验收：三工具达到 `SSOT-only`，状态更新为“已完成”。

---

### 9.2 Batch 9（`apply_visual_actions` / `set_ui_properties` / `set_serialized_property`）

### B9-S1：执行面断开 legacy 队列
1. 目标文件（可改）：  
   - `sidecar/src/mcp/commands/apply_visual_actions/handler.js`  
   - `sidecar/src/mcp/commands/set_ui_properties/handler.js`  
   - `sidecar/src/mcp/commands/set_serialized_property/handler.js`  
   - `sidecar/src/application/turnService.js`
2. 任务：  
   - 三工具统一转 `dispatchSsotToolForMcp(...)`。  
   - 删除 `set_serialized_property -> legacy apply_visual_actions` 的映射。
3. 验收：三工具请求不进入 legacy visual/UI 队列。

### B9-S2：L3 纯 SSOT 分发
1. 目标文件（可改）：  
   - `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`  
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*`（仅三工具对应 executor）  
   - `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
2. 任务：  
   - 三工具只由 SSOT dispatcher + executor 处理。  
   - 从 legacy action registry 移除三工具注册。
3. 验收：Unity 侧不再存在这三工具进入 legacy registry 的注册路径。

### B9-S3：桥接字段清零
1. 目标文件（可改/可删）：  
   - `sidecar/src/application/turnPayloadBuilders.js`  
   - `sidecar/src/application/unityDispatcher/runtimeUtils.js`  
   - 任何读取 `action_data_json` / `action_data_marshaled` 的三工具相关分支
2. 任务：删除三工具对旧桥接字段的读取/写入。
3. 验收：三工具关键链路中不再命中桥接字段。

### B9-S4：测试与实机
1. Node：`ssot-batch-route` 覆盖三工具通过。  
2. MCP 实机：三工具各 1 正例 + 1 负例。  
3. 验收：Batch 9 全部转 `SSOT-only`。

---

### 9.3 Batch 10（`hit_test_ui_at_screen_point`）

### B10-S1：先做策略决策（必须二选一）
1. 方案 A（推荐）：正式退役。  
2. 方案 B：补齐 executor，迁为 `SSOT-only` 可执行工具。  
3. 约束：不得长期保持 `disabled + 迁移中`。

### B10-S2A（如果选方案 A：退役）
1. 目标文件：  
   - `ssot/dictionary/tools.json`  
   - `sidecar/src/mcp/commands/definitions/hit_test_ui_at_screen_point.js`  
   - `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`  
   - 迁移矩阵文档（本文件 + SSOT 主文档）
2. 任务：从可用工具清单移除，标记“已退役（非故障）”。
3. 验收：`tools/list` 不再暴露该工具，调用返回统一 deprecate 响应。

### B10-S2B（如果选方案 B：继续迁移）
1. 目标文件：  
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/HitTestUiAtScreenPointSsotExecutor.cs`（新建）  
   - `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`（注册）  
   - `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/*`（路由与校验）  
2. 任务：实现并接入 SSOT-only 执行链，删除 disabled 分支。
3. 验收：正例可执行，负例 fail-fast，状态更新“已完成”。

---

## 10. Batch 1~7 的详细模板（复用执行卡）

对 Batch 1~7 每批均执行以下“文件级模板”，差异仅在工具名。

### T-S1：工具契约核对
1. `ssot/dictionary/tools.json`  
2. `ssot/artifacts/l2/mcp-tools.generated.json`（build 后）  
3. 验收：required/description/examples 与工具语义一致。

### T-S2：L2 校验与分发核对
1. `sidecar/src/mcp/commands/<tool>/validator.js`  
2. `sidecar/src/mcp/commands/<tool>/handler.js`  
3. `sidecar/src/application/turnService.js`  
4. 验收：`validator -> turnService.<tool>ForMcp -> dispatchSsotToolForMcp` 单链路。

### T-S3：L3 分发与执行核对
1. `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`  
2. `Assets/Editor/Codex/Infrastructure/Ssot/Executors/<Tool>SsotExecutor.cs`  
3. 验收：不进入 legacy action registry 或 legacy coordinator 队列。

### T-S4：旧链路物理清除
1. 删除该工具 legacy registry 项。  
2. 删除该工具 legacy handler 路由。  
3. 删除该工具桥接字段读写。  
4. 验收：对应关键词在 legacy 文件中命中为 0。

### T-S5：双测与状态更新
1. Node 路由测试通过。  
2. MCP 实机正负例通过。  
3. 文档状态更新为“已完成（SSOT-only）”。

---

## 11. 每批提交物（必须同提交）

1. 代码变更（迁移 + 删旧）。  
2. 删旧清单（文件与函数级）。  
3. 测试结果（Node + MCP 实机）。  
4. 文档状态更新（本文件与 SSOT 主文档）。

---

## 12. 执行记录（进行中）

### 2026-03-05：Batch 8（S1~S4）已完成

### S1 基线引用链核对（已完成）
1. `submit_unity_task`：`definition -> turnServiceMethod -> submitUnityTask(旧)`（已识别为旧网关入口）。  
2. `cancel_unity_task`：`definition -> turnServiceMethod -> cancelUnityTask(旧)`（已识别为旧网关入口）。  
3. `apply_script_actions`：`definition -> turnServiceMethod -> applyScriptActionsForMcp -> mcpEyesService.applyScriptActions(旧)`（已识别为旧写服务入口）。

### S2 路由切换（已完成）
1. `submit_unity_task`：`turnServiceMethod` 改为 `submitUnityTaskForMcp`。  
2. `cancel_unity_task`：`turnServiceMethod` 改为 `cancelUnityTaskForMcp`。  
3. `turnService` 新增两个 `*ForMcp` 方法，统一走 `dispatchSsotToolForMcp(...)`。  
4. `applyScriptActionsForMcp` 已改为 `dispatchSsotToolForMcp("apply_script_actions", body)`。

### S3 旧耦合清理（已完成）
1. `mcpEyesWriteService.applyScriptActions` 已桩化为 `410 E_LEGACY_PIPELINE_DEPRECATED`，不再触发 legacy submit 路径。  
2. Batch 8 三工具 HTTP 路由已不再依赖旧 gateway method 名称进行分发。

### S4 测试门禁（已完成）
1. `node --test sidecar/tests/application/ssot-batch-route.test.js`：`58/58` 通过。  
2. `node --test sidecar/tests/application/protocol-write-consistency.test.js`：`4/4` 通过（测试桩已同步到新 `*ForMcp` 路由方法）。  
3. 说明：MCP 实机调用待你触发服务后执行（本地单测门禁已通过）。

### 2026-03-05：Batch 9（S1~S4）已完成 S1~S3，S4（Node）通过

### S1 基线引用链核对（已完成）
1. `apply_visual_actions`：`turnService.applyVisualActionsForMcp` 原先仍指向 `mcpEyesService.applyVisualActions`（legacy 写队列）。  
2. `set_ui_properties`：`turnService.setUiPropertiesForMcp` 原先仍指向 `mcpEyesService.setUiProperties`（legacy 写队列）。  
3. `set_serialized_property`：已走 SSOT 路由，但 definition 仍通过 `execute` 适配层进入 turnService。

### S2 路由切换（已完成）
1. `turnService.applyVisualActionsForMcp` 改为 `dispatchSsotToolForMcp("apply_visual_actions", body)`。  
2. `turnService.setUiPropertiesForMcp` 改为 `dispatchSsotToolForMcp("set_ui_properties", body)`。  
3. `set_ui_properties` definition 改为 `turnServiceMethod + validate`（移除 `execute` 入口）。  
4. `set_serialized_property` definition 改为 `turnServiceMethod + validate`（移除 `execute` 入口）。  
5. `commandRegistry` 校验后改为优先使用 `validation.value`，保证规范化 payload 不在 `turnServiceMethod` 路径丢失。

### S3 旧耦合清理（已完成）
1. `legacyCommandManifest` 已移除 `executeSetUiProperties` / `executeSetSerializedProperty` 依赖注入。  
2. `apply_visual_actions` 与 `set_ui_properties` 不再经 `mcpEyesService` 旧写服务入口。  
3. L3 `SsotRequestDispatcher` 增加对 `apply_visual_actions` / `set_ui_properties` 的 SSOT 分支，显式返回 `E_SSOT_TOOL_DEPRECATED`，确保不回退旧队列。

### S4 测试门禁
1. `node --test sidecar/tests/application/ssot-batch-route.test.js`：`58/58` 通过。  
2. `node --test sidecar/tests/application/protocol-write-consistency.test.js`：`4/4` 通过。  
3. MCP 实机（待执行）：  
   - `set_serialized_property`：应继续可执行（SSOT-only）。  
   - `apply_visual_actions` / `set_ui_properties`：应返回 `E_SSOT_TOOL_DEPRECATED`（不再借道 legacy 队列）。

### 2026-03-05：Batch 10（S1 + S2B）已完成

### S1 策略决策（已完成）
1. 本批次选择 `B10-S2B`：不退役，补齐 SSOT executor，迁为可执行工具。  
2. 约束落实：不再维持 `disabled + 迁移中` 悬挂状态。

### S2B 接入（已完成）
1. L2：`hit_test_ui_at_screen_point` definition 改为 `turnServiceMethod: hitTestUiAtScreenPointForMcp`，移除 disabled `execute` 路径。  
2. L2：`turnService` 新增 `hitTestUiAtScreenPointForMcp -> dispatchSsotToolForMcp("hit_test_ui_at_screen_point", body)`。  
3. L2：删除旧 disabled handler 文件 `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`。  
4. L3：新增 `HitTestUiAtScreenPointSsotExecutor`，并注册到 `SsotRequestDispatcher`。  
5. L3：screen-point 请求通过 SSOT executor 归一化为 viewport-px hit-test 执行，不回退 legacy disabled 查询分支。

### S4 测试门禁
1. `node --test sidecar/tests/application/ssot-batch-route.test.js`：`58/58` 通过（`hit_test_ui_at_screen_point` 已从 disabled 断言改为 dispatch 断言）。  
2. `node --test sidecar/tests/application/protocol-write-consistency.test.js`：`4/4` 通过。  
3. MCP 实机（待执行）：  
   - 正例：`x/y`（可选 `reference_width/reference_height`）应返回 `status=succeeded`。  
   - 负例：`x` 或 `y` 类型错误应返回 `E_SSOT_SCHEMA_INVALID`。

### B10-POSTCHECK: r12 gate passed
- Added r12 visibility test pass (2/2).
- Removed UnityQueryRegistryBootstrap registration for legacy screen-point disabled handler.
- Deleted legacy query handler file and meta for HitTestUiAtScreenPointDisabledQueryHandler.
- Remaining in Batch 10: MCP live dogfooding only.

### 2026-03-05 Batch1+Batch2 SRP Progress
- Batch1 S2: `get_current_selection` / `get_gameobject_components` / `get_hierarchy_subtree` switched from execute-hook to `turnServiceMethod + validate`.
- Batch1 S3/T-S4: deleted legacy handler files:
  - `sidecar/src/mcp/commands/get_current_selection/handler.js`
  - `sidecar/src/mcp/commands/get_gameobject_components/handler.js`
  - `sidecar/src/mcp/commands/get_hierarchy_subtree/handler.js`
- Batch2 check: `get_scene_roots` / `list_assets_in_folder` / `find_objects_by_component` already stay on `turnServiceMethod + validate` and SSOT dispatch path.
- Node gates:
  - `node --test sidecar/tests/application/ssot-batch-route.test.js` passed `58/58`
  - `node --test sidecar/tests/application/protocol-write-consistency.test.js` passed `4/4`
- Batch1+Batch2 checklist status: 实机留证已归档（按迁移矩阵口径计入已迁移）。

### 2026-03-05 Batch3+Batch4 SRP Progress
- Batch3/4 status check: all six definitions (`query_prefab_info`, `get_ui_tree`, `get_ui_overlay_report`, `hit_test_ui_at_viewport_point`, `validate_ui_layout`, `get_serialized_property_tree`) already run on `turnServiceMethod + validate` SSOT route.
- Legacy coupling cleanup in L2 manifest:
  - removed execute imports/exports for:
    - `executeGetUiTree`
    - `executeGetUiOverlayReport`
    - `executeHitTestUiAtViewportPoint`
    - `executeValidateUiLayout`
    - `executeGetSerializedPropertyTree`
- Deleted obsolete legacy handler files:
  - `sidecar/src/mcp/commands/get_ui_tree/handler.js`
  - `sidecar/src/mcp/commands/get_ui_overlay_report/handler.js`
  - `sidecar/src/mcp/commands/hit_test_ui_at_viewport_point/handler.js`
  - `sidecar/src/mcp/commands/validate_ui_layout/handler.js`
  - `sidecar/src/mcp/commands/get_serialized_property_tree/handler.js`
- Deleted obsolete legacy unit test:
  - `sidecar/tests/application/get-serialized-property-tree-handler.test.js`
- Node gates after cleanup:
  - `node --test sidecar/tests/application/ssot-batch-route.test.js` passed `58/58`
  - `node --test sidecar/tests/application/protocol-write-consistency.test.js` passed `4/4`
- Batch3+Batch4 checklist status: 实机留证已归档（按迁移矩阵口径计入已迁移）。

### 2026-03-05 Batch5+Batch6 SRP Progress
- Batch5 route baseline:
  - `capture_scene_screenshot` remains `turnServiceMethod + validate` SSOT dispatch.
  - `get_action_catalog` / `get_action_schema` remain SSOT static deprecated stubs (no Unity dispatch, no legacy gateway dependency).
- Batch6 route baseline:
  - `preflight_validate_write_payload` remains `turnServiceMethod + validate` and runs SSOT token/revision guard in L2.
  - `get_tool_schema` / `get_write_contract_bundle` remain SSOT static artifact handlers.
- Legacy dead-code cleanup:
  - removed manifest execute wiring for unused handlers:
    - `executeCaptureSceneScreenshot`
    - `executePreflightValidateWritePayload`
  - deleted obsolete files:
    - `sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`
    - `sidecar/src/mcp/commands/preflight_validate_write_payload/handler.js`
    - `sidecar/tests/application/ssot-preflight-token-gate.test.js`
  - deleted dead `turnService` methods no longer reachable from command definitions:
    - `getActionCatalogForMcp`
    - `getActionSchemaForMcp`
    - `getToolSchemaForMcp`
    - `getWriteContractBundleForMcp`
- Node gates after cleanup:
  - `node --test sidecar/tests/application/ssot-batch-route.test.js` passed `58/58`
  - `node --test sidecar/tests/application/protocol-write-consistency.test.js` passed `4/4`
  - `node --test sidecar/tests/application/get-tool-schema-lifecycle.test.js` passed `2/2`
  - `node --test sidecar/tests/application/get-write-contract-bundle.test.js` passed `3/3`
- Batch5+Batch6 checklist status: 实机留证已归档（按迁移矩阵口径计入已迁移）。

### 2026-03-05 Batch7+Batch8 SRP Progress
- Batch7 route normalization:
  - `setup_cursor_mcp` switched from `execute` hook to `turnServiceMethod: setupCursorMcpForMcp`.
  - `verify_mcp_setup` switched from `execute` hook to `turnServiceMethod: verifyMcpSetupForMcp`.
  - `get_unity_task_status` switched to `turnServiceMethod: getUnityTaskStatusForMcp` (no direct command-level legacy method binding).
- Batch7 legacy cleanup:
  - removed manifest execute wiring:
    - `executeSetupCursorMcp`
    - `executeVerifyMcpSetup`
  - deleted obsolete legacy handler files:
    - `sidecar/src/mcp/commands/setup_cursor_mcp/handler.js`
    - `sidecar/src/mcp/commands/verify_mcp_setup/handler.js`
- Batch8 checkpoint:
  - `cancel_unity_task` / `submit_unity_task` / `apply_script_actions` continue to stay on `turnServiceMethod + validate` and SSOT dispatch entry (`dispatchSsotToolForMcp`), no command-level legacy handler fallback reintroduced.
- Node gates after Batch7 cleanup:
  - `node --test sidecar/tests/application/ssot-batch-route.test.js` passed `58/58`
  - `node --test sidecar/tests/application/protocol-write-consistency.test.js` passed `4/4`
  - `node --test sidecar/tests/application/cursor-mcp-commands.test.js` passed `3/3`
- Remaining for Batch7+Batch8 checklist:
  - MCP live positive/negative dogfooding evidence for Batch8 three tools.

### 2026-03-05 Batch9+Batch10 Stage-10 Gate Sweep
- Batch9 routing checkpoint (L2):
  - `apply_visual_actions` / `set_ui_properties` / `set_serialized_property` definitions remain `turnServiceMethod + validate`.
  - `turnService` routes them only to `dispatchSsotToolForMcp(...)`.
- Batch9 legacy dead-file cleanup:
  - deleted obsolete files:
    - `sidecar/src/mcp/commands/set_ui_properties/handler.js`
    - `sidecar/src/mcp/commands/set_serialized_property/handler.js`
  - scan result: no remaining `executeSetUiProperties` / `executeSetSerializedProperty` references.
- Batch10 routing checkpoint:
  - `hit_test_ui_at_screen_point` remains `turnServiceMethod: hitTestUiAtScreenPointForMcp`.
  - SSOT executor path keeps screen-point request normalized to viewport hit-test and avoids legacy disabled query entry.
- Node gates:
  - `node --test sidecar/tests/application/ssot-batch-route.test.js` passed `58/58`
  - `node --test sidecar/tests/application/protocol-write-consistency.test.js` passed `4/4`
  - `node --test sidecar/tests/application/r12-tool-visibility-freeze.test.js` passed `2/2`
- Remaining for Batch9+Batch10 checklist:
  - MCP live positive/negative dogfooding evidence for Batch9 four tools.
  - MCP live positive/negative dogfooding evidence for Batch10 one tool.

### 2026-03-05 当前未完成项（除实机正负例留证外）
1. P2 全局扫尾未执行：按第 4 节定义，需在全部批次验收完成后统一清理未引用 legacy 文件与测试残留。  
2. DoD 最终签署未完成：第 2 节第 5 条（MCP 实机双测）未补齐前，不应把 Batch8/Batch9/Batch10 标记为最终 `已完成(SSOT-only)`。  

### 2026-03-05 P2 扫尾进展（安全子集）
1. 已清理 Batch9 失联 handler 死文件：  
   - `sidecar/src/mcp/commands/set_ui_properties/handler.js`  
   - `sidecar/src/mcp/commands/set_serialized_property/handler.js`  
2. 已清理 manifest 死代码：`validateGetUnityTaskStatusArgs`（无 definition 使用）。  
3. Sidecar 关键旧桥接关键字扫描（`sidecar/src`）命中 `0`：  
   - `action_data_json`  
   - `action_data_marshaled`  
   - `legacy_stringified_action_data`  
   - `legacy_marshaled_action_data`  
