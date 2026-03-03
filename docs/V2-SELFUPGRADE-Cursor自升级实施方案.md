# V2-SELFUPGRADE Cursor自升级实施方案

版本：v1.1  
更新时间：2026-03-03  
适用范围：`sidecar`（L2）+ `Assets/Editor/Codex`（L3）+ 验收文档/脚本资产

---

## 0. 目标与边界

### 0.1 阶段目标
- 建立“缺失能力检测 -> 代码草案生成 -> 人工审批 -> 编译注册 -> 能力生效”的闭环。
- 将接入体验前置为基础设施：提供 Unity 内一键启动/诊断 Sidecar 能力。
- 为 V2-KNOWLEDGE 提供会话级操作历史底座（持久化 + 回放入口）。

### 0.2 非目标
- 不实现“无人工确认”的全自动代码执行与落盘。
- 不在本阶段引入第三方插件 SDK（属于 `V2-PLUGIN`）。
- 不开放任意 shell/文件系统写入型 MCP 工具（仅白名单配置与诊断）。

---

## 1. 执行顺序（按依赖）

1. `Phase A / 接入体验与底座护航`：`R19-SU-E2E-00`、`R19-SU-A-01`、`R19-SU-A-02`、`R19-SU-A-03`  
2. `Phase B / 自升级协议与沙箱`：`R19-SU-B-00`、`R19-SU-B-01`、`R19-SU-B-02`、`R19-SU-B-03`  
3. `Phase C / 审批与注册闭环`：`R19-SU-C-01`、`R19-SU-C-02`、`R19-SU-C-03`、`R19-SU-C-04`  
4. `Phase D / 历史回放与可观测`：`R19-SU-D-01`、`R19-SU-D-02`  
5. `Phase E / QA 与验收收口`：`R19-SU-QA-01`、`R19-SU-QA-02`、`R19-SU-E2E-01`

---

## 2. 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R19-SU-E2E-00 | Phase A | 验收大纲左移 | `docs/Phase19-V2-SelfUpgrade-Acceptance.md`（新增） | 冻结 Case 列表（接入窗口/doctor/生成审批/回放）与证据模板 | 后续任务都可映射到 Case ID，证据目录规范固定 |
| R19-SU-A-01 | Phase A | Unity 接入窗口（M1.5） | `Assets/Editor/Codex/UI/CodexChatWindow.cs`（扩展）或 `Assets/Editor/Codex/UI/CodexControlPanelWindow.cs`（新增）、`Assets/Editor/Codex/Application/ConversationController.cs`（最小接线）、相关 tests | 通用 Control Panel 支持 Sidecar 启停、健康检查、首次配置入口、最近错误展示；SelfUpgrade 审批 UI 不在本任务落地 | Unity 内可“一键启动 + 一键诊断 + 一键首次配置”；无 Node 环境时有明确引导 |
| R19-SU-A-02 | Phase A | AI 自举安装工具（M1.5） | `sidecar/src/mcp/commands/setup_cursor_mcp/*`（新增）、`sidecar/src/mcp/commands/verify_mcp_setup/*`（新增）、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`sidecar/scripts/setup-cursor-mcp.js`、`sidecar/scripts/verify-mcp-setup.js`、相关 tests | 将 setup/verify 脚本包装为 MCP tools，支持对话式重配置/校验；首次安装主路径由 A-01 的 Unity 面板承担 | tools/list 可见且 fail-closed；仅允许白名单路径/字段改写；首次安装不依赖 MCP 已连通 |
| R19-SU-A-03 | Phase A | 会话历史持久化底座（M1.5） | `Assets/Editor/Codex/Infrastructure/Write/WriteReceiptService.cs`、`Assets/Editor/Codex/Infrastructure/Write/OperationHistoryStore.cs`（新增）、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`、相关 tests | 将 write_receipt 追加写入 `Library/Codex/operation_history/*.jsonl` | 默认保留策略（7 天/1000 条）生效；不污染版本库 |
| R19-SU-B-00 | Phase B | 自升级协议 mini-design | `docs/V2-SELFUPGRADE-Protocol-Mini-Design.md`（新增） | 固化“提案 -> 草案预检 -> 审批 -> 应用 -> 编译 -> 回滚”DTO 与状态机；固化 `[CodexGeneratedAction]` 元数据与域重载后自动扫描重注册 | 评审通过后再进入 B-01~B-03；明确 `ScanAndRegisterGeneratedActions` 失败静默降级策略 |
| R19-SU-B-01 | Phase B | 缺失能力检测与提案接口 | `sidecar/src/mcp/commands/propose_missing_action_handler/*`（新增）、`sidecar/src/application/*`、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/ActionGapAnalyzer.cs`（新增）、相关 tests | MCP 工具可返回缺失 action 的候选实现提案（不直接落盘） | 提案包含 action schema/风险提示/影响文件列表；无执行副作用 |
| R19-SU-B-02 | Phase B | 代码草案生成沙箱 | `Assets/Editor/Codex/Infrastructure/SelfUpgrade/ActionHandlerTemplateEngine.cs`（新增）、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/GeneratedActionSandbox.cs`（新增）、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`、相关 tests | 接收 L1/LLM 草案代码并执行结构校验 + boilerplate 补全（namespace/attribute/usings）；输出到 `Assets/Editor/Codex/Generated/Pending/` 并产出结构化 diff | 生成产物可重复，目录隔离，禁止覆盖非生成目录；每个草案必须带 `[CodexGeneratedAction]` 元数据 |
| R19-SU-B-03 | Phase B | 编译守卫与失败回滚 | `Assets/Editor/Codex/Infrastructure/SelfUpgrade/GeneratedActionCompileGuard.cs`（新增）、`Assets/Editor/Codex/Application/ConversationController.cs`（必要时）、相关 tests | 编译失败自动清理 Pending 产物并返回可恢复错误 | 失败不污染现有能力；错误码与恢复建议稳定 |
| R19-SU-C-01 | Phase C | 人工审批 UI 与差异预览 | `Assets/Editor/Codex/UI/CodexSelfUpgradeWindow.cs`（新增，或挂载到 Control Panel 的 SelfUpgrade 标签页）、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/GeneratedActionApprovalStore.cs`（新增）、相关 tests | 审批界面可查看提案摘要、文件 diff、风险标签、合规扫描结果，并执行批准/拒绝 | 未批准前不得进入编译应用流程；审批决策可审计 |
| R19-SU-C-02 | Phase C | 批准后应用与注册接线 | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/*`、`Assets/Editor/Codex/Application/Conversation/CapabilityReporter.cs`、相关 tests | 批准后自动迁移到 `Generated/Active`、触发能力上报；`BuildDefaultRegistry` 增加 `ScanAndRegisterGeneratedActions`，支持域重载后自动重注册 | `get_action_catalog` 可见新 action，域重载后能力仍可见；扫描异常不阻断内建 action |
| R19-SU-C-03 | Phase C | 多轮会话幂等与并发保护 | `sidecar/src/application/turnService.js`、`sidecar/src/application/mcpGateway/*`、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/*`、相关 tests | 同一提案 ID 幂等处理；并发审批冲突返回稳定错误 | 不出现重复写盘/重复注册；冲突可恢复 |
| R19-SU-C-04 | Phase C | 已激活能力禁用/卸载 | `Assets/Editor/Codex/UI/CodexSelfUpgradeWindow.cs`、`Assets/Editor/Codex/Infrastructure/SelfUpgrade/*`、`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`、相关 tests | 对 `Generated/Active` action 提供 Disable/Remove；删除后触发刷新与能力上报收敛 | 卸载后 `get_action_catalog` 不再暴露该 action；不影响内建能力 |
| R19-SU-D-01 | Phase D | 操作历史读取 Query | `sidecar/src/mcp/commands/get_operation_history/*`（新增）、`Assets/Editor/Codex/Infrastructure/Queries/Handlers/GetOperationHistoryQueryHandler.cs`（新增）、`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`、相关 tests | `get_operation_history` 支持按 `session_id/action_type/object_path/time_range` 过滤 | Cursor 可检索最近操作链，结果分页可控 |
| R19-SU-D-02 | Phase D | 历史回放与诊断脚本 | `sidecar/scripts/replay-operation-history.js`（新增）、`sidecar/scripts/README.md`、`Assets/Docs/Codex-Unity-MCP-Main-Index.md`（必要时） | 提供“回放计划”脚本（默认 dry_run），输出可审计报告；commit 模式执行前逐条 precondition 校验 | 回放默认不改场景；commit 模式遇到 precondition 冲突必须中止并输出冲突报告 |
| R19-SU-QA-01 | Phase E | Sidecar 回归 | `sidecar/tests/application/*self-upgrade*.test.js`（新增）、`sidecar/tests/domain/*` | 自升级工具、历史查询、白名单安全策略全绿 | Node CI 全绿，安全用例覆盖完整 |
| R19-SU-QA-02 | Phase E | Unity 回归 | `Assets/Editor/Codex/Tests/EditMode/*SelfUpgrade*.cs`（新增）、`*OperationHistory*.cs`（新增） | 审批流、编译守卫、历史持久化与读取回归 | 编译 + EditMode 全绿；失败回滚可重复验证 |
| R19-SU-E2E-01 | Phase E | 验收文档收口 | `docs/Phase19-V2-SelfUpgrade-Acceptance.md`、`Assets/Docs/evidence/phase19/*` | 固化端到端验收（提案->审批->生效->历史回放） | 按文档可重复完成验收，证据可审计 |

---

## 3. 阶段入口与退出条件

### 3.1 Phase A 入口条件
- `R18-CAPTURE` 已完成收口（`docs/Phase18-V1-Capture-Acceptance.md` sign-off 勾选完成）。
- 当前分支可稳定运行 `npm --prefix sidecar test`。
- Unity EditMode 编译稳定，无未处理编译报错。

### 3.2 Phase A 退出条件
- Unity 内接入窗口可用，Sidecar 启停与健康检查可执行。
- setup/verify 已作为 MCP tool 对外暴露，并通过安全校验；首次安装可由 Unity 面板独立完成。
- 会话历史可持续写入本地账本，不影响主写链路。

### 3.3 Phase B/C 退出条件
- 自升级提案、审批、应用、编译守卫、失败回滚全链路打通。
- 新注册能力可通过 `get_action_catalog` 查询，且域重载后可自动重注册，不破坏既有工具契约。
- 并发与幂等保护通过回归用例验证。
- 已激活 action 可禁用/卸载并完成能力收敛。

### 3.4 Phase D/E 退出条件
- 历史查询与回放脚本可复现并产出证据。
- `test:r19:qa`（待新增）与全量回归通过。
- Phase19 验收文档完成并附证据清单。

---

## 4. 技术约束与统一规范

- 自升级默认“提案模式”：未审批前不得写入 `Generated/Active`。
- 仅允许写入 `Assets/Editor/Codex/Generated/` 白名单目录；禁止越界写入。
- 生成代码由 L3 `GeneratedActionSandbox` 直接写入 `Assets/Editor/Codex/Generated/`；不经过 L2 `FileActionExecutor`，因此不改 Sidecar `allowedWriteRoots`。
- setup/verify MCP 工具仅允许配置读写与状态诊断，不允许任意命令执行。
- 首次安装主路径为 A-01 Unity 面板；MCP 版 setup/verify 用于重配置与环境诊断。
- 审批动作必须可审计：记录 `approved_by`、`approved_at`、`proposal_id`、`diff_hash`。
- 编译失败必须自动回滚 Pending 产物并输出稳定错误码（含恢复建议）。
- 生成代码必须遵守当前三层架构分层与命名约定，不得绕过 Registry 注册流程。
- 生成 action 必须带 `[CodexGeneratedAction]` 元数据；`BuildDefaultRegistry` 末尾执行 `ScanAndRegisterGeneratedActions`，扫描异常仅记录告警并静默降级。
- 生成 action 仅允许 `lifecycle=experimental`；不允许直接注册为 stable。
- 生成 action 走既有 `apply_visual_actions/submit_unity_task` 管道，不新增专用 MCP 写工具；L3 注册 + capability 上报后由 L2 capabilityStore 自动感知。
- 历史持久化默认写入 `Library/Codex/operation_history/`，并带保留策略开关。
- 历史回放默认 `dry_run=true`；commit 回放需显式参数开启。
- commit 回放必须逐条校验 precondition（对象存在、组件存在、关键属性快照一致）；不满足即中止回放。
- 所有新增错误码必须接入 `mcpErrorFeedback`，保持 recoverable/suggestion 语义一致。
- 新增工具必须同步 `legacyCommandManifest`、validator、handler 与 schema parity 测试。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| 生成代码质量不稳定 | 编译失败率上升、体验波动 | 模板引擎 + 沙箱目录 + 编译前静态校验 + 自动回滚 |
| 人工审批负担过高 | 自升级效率下降 | 差异摘要 + 风险标签 + 批量审批模式 |
| 工具权限过大 | 安全风险 | setup/verify 严格白名单 + 路径约束 + 审计日志 |
| 域重载后生成能力丢失 | 新 action 无法再次调用 | `ScanAndRegisterGeneratedActions` + `[CodexGeneratedAction]` 元数据 + 扫描失败静默降级 |
| 历史文件膨胀 | 磁盘与读取性能问题 | 7 天/1000 条保留策略 + JSONL 分片轮转 |
| 并发审批竞态 | 重复落盘/重复注册 | 提案 ID 幂等锁 + 冲突错误码 `E_SELFUPGRADE_CONFLICT` |
| 域重载中断流程 | 状态不一致 | 状态机持久化 + 重启恢复 + 中断后安全回滚 |
| 历史回放 commit 与当前场景冲突 | 误改或删除错误对象 | commit 前逐条 precondition 校验，冲突即中止并输出 conflict report |

---

## 6. 阶段映射与状态跟踪（R19-SELFUPGRADE）

| 阶段 | 阶段ID 范围 | 目标 | 状态 |
|---|---|---|---|
| Phase A | `R19-SU-E2E-00 ~ A-03` | 接入体验与底座护航 | 🟡 已完成开发，待实机验收 |
| Phase B | `R19-SU-B-00 ~ B-03` | 自升级协议与沙箱 | 🔲 未开始 |
| Phase C | `R19-SU-C-01 ~ C-04` | 审批与注册闭环 | 🔲 未开始 |
| Phase D | `R19-SU-D-01 ~ D-02` | 历史回放与可观测 | 🔲 未开始 |
| Phase E | `R19-SU-QA-01 ~ E2E-01` | QA 与验收收口 | 🔲 未开始 |

---

## 7. 评审与推进机制（给 Cursor 方案评审员）

每一阶段提交时，PR 说明必须包含：
1. 对应 `任务ID` 列表（仅允许同阶段 ID）。  
2. 变更文件清单与风险说明。  
3. 自动化测试结果（Sidecar / Unity 分开列）。  
4. 安全边界说明（白名单路径、审批链、回滚行为）。  
5. 未完成项与下一阶段切换条件。  

推荐节奏：  
- 先落 `Phase A`（低风险高回报），尽快提升接入体验。  
- `Phase B/C` 每个任务必须包含失败回滚用例。  
- `Phase D` 以 dry_run 回放为默认策略，避免历史回放误写场景。  
- 阶段通过后，在 `ROADMAP.md` 更新状态，再进入下阶段。  

---

## 8. 当前建议起步任务

建议从 `Phase A` 开始，顺序固定：
1. `R19-SU-E2E-00`（先冻结验收大纲）
2. `R19-SU-A-01`（Unity 接入窗口）
3. `R19-SU-A-02`（setup/verify MCP tool 化）
4. `R19-SU-A-03`（会话历史持久化底座）

完成 `Phase A` 后，再开启 `Phase B`。  

---

## 9. Selection 解冻变更追溯（2026-03-03）

### 9.1 变更目标
- 修复 Cursor 无法读取“当前选中节点”的问题，恢复最小必要的 selection 读能力。
- 保证解冻走当前 MCP 链路（`MCP tool -> /mcp/* -> turnService -> mcpEyesReadService`），不恢复 session/turn 旧链路。
- 保持 `get_prefab_info/get_compile_state/get_console_errors` 继续冻结，避免范围失控。

### 9.2 解冻范围
- 解冻 MCP tools:
`get_current_selection`、`get_gameobject_components`、`get_hierarchy_subtree`。
- 解冻 HTTP routes:
`/mcp/get_current_selection`、`/mcp/get_gameobject_components`、`/mcp/get_hierarchy_subtree`、`/unity/selection/snapshot`。
- 保持冻结不变:
`/unity/console/snapshot`、`/mcp/get_prefab_info`、`/mcp/get_compile_state`、`/mcp/get_console_errors`。

### 9.3 文件级改动清单
- `sidecar/src/ports/contracts.js`
从 deprecated 列表移除 selection 三件套与 `/unity/selection/snapshot`，并加入 active `mcp_read_http_routes`/`mcp_tool_names`。
- `sidecar/src/api/router.js`
恢复 `/unity/selection/snapshot` callback 路由，确保 Unity 选中快照可进入当前 sidecar 链路。
- `sidecar/src/mcp/commands/legacyCommandManifest.js`
新增 3 个工具定义并映射到现有 `turnService` 方法：
`getCurrentSelectionForMcp`、`getGameObjectComponentsForMcp`、`getHierarchySubtreeForMcp`。
- `sidecar/src/mcp/mcpServer.js`
补充三项 wrapper 方法，保持 MCP server API 一致性。
- `sidecar/tests/application/r11-command-contract-snapshot.test.js`
更新 required-field 快照。
- `sidecar/tests/application/mcp-tool-schema-minimal.test.js`
新增三项工具可见性与 endpoint 映射断言。
- `sidecar/tests/application/phase6-freeze-regression.test.js`
新增回归用例，锁定 `/unity/selection/snapshot` 不能再被误冻结为不可达路由。

### 9.4 链路约束说明（评审要点）
- 本次未恢复 `session.start/turn.send/turn.status` 任何旧协议接口。
- selection 解冻依赖现有 sidecar 读服务与 OCC token 机制，写入侧契约不变。
- 解冻仅用于“读锚点恢复”，不影响自升级审批链路。

### 9.5 验证结果（已通过）
- `sidecar/tests/domain/contracts.phase6-freeze.test.js`
- `sidecar/tests/application/phase6-freeze-regression.test.js`
- `sidecar/tests/application/r11-command-contract-snapshot.test.js`
- `sidecar/tests/application/r12-tool-registry-consistency.test.js`
- `sidecar/tests/application/mcp-tool-schema-minimal.test.js`
- `sidecar/tests/application/r11-command-modules-and-screenshot.test.js`
