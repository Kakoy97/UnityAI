# UnityAI 项目架构指南（R16-HYBRID）

版本：v2.0  
更新时间：2026-03-02  
适用范围：`sidecar`（L2）+ `Assets/Editor/Codex`（L3）+ Cursor/MCP Client（L1）

## 1. 项目目标

本项目的核心目标是：让大模型通过 MCP 安全、稳定地驱动 Unity Editor 完成读写任务，并在复杂场景下保持可回滚、可观测、可扩展。

当前采用“三层混合能力架构”：
- 原语层：高频、确定性动作（如 `set_parent`、`set_sibling_index`）
- 泛化层：`set_serialized_property` / `get_serialized_property_tree`
- 专科层：高语义子系统工具（当前首批为 UI 布局诊断与修复建议）

## 2. 三层职责与通信

### 2.1 L1（Cursor / MCP Client）
- 只做任务规划与工具调用。
- 不直接访问 Unity 进程。
- 通过 MCP tools/resources 与 L2 交互。

### 2.2 L2（Node.js Sidecar）
- MCP 协议入口与路由：`sidecar/src/mcp/mcpServer.js`
- 命令注册：`sidecar/src/mcp/commands/legacyCommandManifest.js`
- 写链路编排：`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`
- 查询编排：`sidecar/src/application/queryRuntime/queryCoordinator.js`
- 错误反馈与契约门禁：`sidecar/src/application/turnPolicies.js`、`sidecar/src/domain/validators/legacyValidators.js`

### 2.3 L3（Unity Editor C#）
- Action 执行入口：`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
- Query 执行入口：`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
- Action 注册：`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
- Query 注册：`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`

## 3. 线缆与协议关键点

### 3.1 外部协议（LLM 可见）
- 外部写入统一使用 `action_data` object。
- 外部 payload 禁止 `action_data_json` 和 `action_data_marshaled`。
- 违规时返回 `E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED`。

### 3.2 L2 -> L3 内部桥接
- 当前内部桥接保留双栈兼容：`action_data_marshaled`（优先）+ `action_data_json`（回退）。
- 解析入口：`McpVisualActionContext`。
- 目标是稳定过渡后仅保留 `action_data_marshaled` 主链路。

## 4. 当前能力面（R16）

### 4.1 泛化写
- 工具：`set_serialized_property`
- 能力：基础类型 + 数组 + 对象引用写入，接入原子回滚体系。
- Unity 实现：
  - `SerializedPropertyActionHandler.cs`
  - `SerializedObjectReferenceResolver.cs`

### 4.2 泛化读
- 工具：`get_serialized_property_tree`
- 能力：按 depth/page/budget 懒加载字段树，支持 `truncated` + `next_cursor`。
- Unity 实现：
  - `SerializedPropertyTreeReadService.cs`
  - `GetSerializedPropertyTreeQueryHandler.cs`

### 4.3 专科层（首批）
- 工具：`validate_ui_layout`（专科增强模式）
- 新增专科字段：
  - 请求：`include_repair_plan`、`max_repair_suggestions`、`repair_style`
  - 响应：`specialist_summary`、`repair_plan`、`repair_plan_generated_by`
- Unity 生成首选修复建议，Sidecar 在必要时回退生成，保证端到端可用。

## 5. 专科层数据流（UI）

1. L1 调用 `validate_ui_layout` 并开启 `include_repair_plan=true`。  
2. L2 validator 校验专科参数后，提交 Unity query。  
3. L3 `UiLayoutReadService` 输出问题列表 + 专科摘要 + 修复建议。  
4. L2 统一归一化输出；若 Unity 未给出修复建议，L2 生成 fallback repair_plan。  
5. L1 可以按 `recommended_action_type` 继续调用 Phase2 原语或泛化写工具。

## 6. 原子安全与测试门禁

- 原子基座：`AtomicActionTestBase`
- 目标：所有 `atomic_safe` action 必须覆盖三类断言：
  - 成功提交
  - 失败回滚
  - fail-closed（Undo 漏注册时必须失败）
- 门禁脚本：`sidecar/scripts/r16-wire-guard.js`
  - 检查线缆字段外泄
  - 检查原子测试覆盖缺口（可 `--strict-atomic`）

## 7. 脚本与资产（ASSET-01）

### 7.1 核心诊断脚本
- `diagnose-ui.js`：UI V1 主链路诊断（tree/hit/validate/set）
- `diagnose-ui-specialist.js`：UI 专科诊断（repair_plan + action catalog 兼容性）
- `diagnose-capture.js`：截图链路基线诊断
- `r16-wire-guard.js`：R16 协议与原子门禁

### 7.2 推荐执行序列
1. `npm --prefix sidecar test`
2. `npm --prefix sidecar run test:r16:qa`
3. `npm --prefix sidecar run gate:r11-command-boundary`
4. `npm --prefix sidecar run gate:r16-wire`
5. `npm --prefix sidecar run diagnose:ui -- --base-url http://127.0.0.1:46321 --skip-set`
6. `npm --prefix sidecar run diagnose:ui:specialist -- --base-url http://127.0.0.1:46321 --strict`

## 8. 已知风险与后续方向

- Prefab/Variant 专科仍需单独工具化（当前专科首批聚焦 UI）。
- `action_data_json` 回退仍存在于内部兼容链路，后续需清退。
- `set_serialized_property` 在高风险类型（如 ManagedReference）上仍建议保持受限策略。

## 9. 快速定位（文件索引）

- L2 命令定义：`sidecar/src/mcp/commands/legacyCommandManifest.js`
- UI 专科命令：`sidecar/src/mcp/commands/validate_ui_layout/`
- Unity UI 专科实现：`Assets/Editor/Codex/Infrastructure/Read/UiLayoutReadService.cs`
- Unity 专科契约：`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.UiVision.cs`
- R16 门禁脚本：`sidecar/scripts/r16-wire-guard.js`
- UI 专科诊断脚本：`sidecar/scripts/diagnose-ui-specialist.js`
- Phase16 验收文档：`docs/Phase16-Hybrid-Architecture-Acceptance.md`
