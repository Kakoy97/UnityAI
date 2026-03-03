# V1-POLISH 泛化层打磨实施方案

版本：v1.1  
更新时间：2026-03-02  
适用范围：`sidecar`（L2）+ `Assets/Editor/Codex`（L3）

---

## 0. 目标与边界

### 0.1 阶段目标
- 将泛化层从“可用”提升到“高可用 + 高可诊断 + 高可控”。
- 降低 LLM 在泛化读写链路上的失败率与回滚率。
- 为后续 `V1-CAPTURE`、`V2-SELFUPGRADE` 提供稳定底座。

### 0.2 非目标
- 本阶段不引入全新架构层（仍沿用“原语 + 泛化 + 专科”）。
- 不在本阶段实现第三方插件 SDK。
- 不在本阶段推进“全自动代码生成执行”。

---

## 1. 执行顺序（按依赖）

1. `Phase A / Blocker 收口`：`R17-POLISH-E2E-00`、`R17-POLISH-P0-01`、`R17-POLISH-P0-02`、`R17-POLISH-P0-03`  
2. `Phase B / 泛化写增强`：`R17-POLISH-W-00`、`R17-POLISH-W-01`、`R17-POLISH-W-02`、`R17-POLISH-W-03`、`R17-POLISH-W-04`  
3. `Phase C / 泛化读增强`：`R17-POLISH-R-01`、`R17-POLISH-R-02`  
4. `Phase D / 可观测与效率闭环`：`R17-POLISH-O11Y-01`、`R17-POLISH-O11Y-02`  
5. `Phase E / QA 与验收收口`：`R17-POLISH-QA-01`、`R17-POLISH-QA-02`、`R17-POLISH-E2E-01`

---

## 2. 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R17-POLISH-E2E-00 | Phase A | 验收大纲左移 | `docs/Phase17-V1-Polish-Acceptance.md`（先创建大纲） | 先固化 Case 列表（bool/array/dry_run/hint/限制策略）与证据模板 | 后续每个任务都可映射到验收 Case ID |
| R17-POLISH-P0-01 | Phase A | bool 写入补齐 | `sidecar/src/mcp/commands/set_serialized_property/validator.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`Assets/Editor/Codex/Infrastructure/Actions/SerializedPropertyActionHandler.cs`、`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`、相关 tests | `value_kind=bool` 端到端可写（含 tool schema 与 action schema 文案一致性） | boolean 字段写入成功，类型不匹配错误码稳定，schema parity 用例通过 |
| R17-POLISH-P0-02 | Phase A | CloneAction 线缆修复 | `Assets/Editor/Codex/Infrastructure/Actions/BuiltInVisualActionHandlers.cs`、相关 tests | `CloneAction` 补齐 `action_data_marshaled` 复制 | composite 步骤克隆不再丢失 marshaled 数据 |
| R17-POLISH-P0-03 | Phase A | patch 数量硬限制 | `sidecar/src/mcp/commands/set_serialized_property/validator.js`、`Assets/Editor/Codex/Infrastructure/Actions/SerializedPropertyActionHandler.cs`、相关 tests | `max_patches_per_action`（建议 64）双端硬限制 | 超限请求稳定返回 `E_SCHEMA_INVALID`/对应错误码 |
| R17-POLISH-W-00 | Phase B | 数组 patch mini-design | `docs/V1-POLISH-Array-Patch-Schema-Mini-Design.md`（新增） | 固化数组 patch schema：采用 `op=set|insert|remove|clear`（`value_kind=array`） | 方案评审通过后再进入 W-01 |
| R17-POLISH-W-01 | Phase B | 数组 op 增强 | `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`、`sidecar/src/mcp/commands/set_serialized_property/validator.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`Assets/Editor/Codex/Infrastructure/Actions/SerializedPropertyActionHandler.cs`、相关 tests | 在 `value_kind=array` 下支持 `op=insert/remove/clear` | 数组增删改行为可回归，remove 按高索引到低索引执行 |
| R17-POLISH-W-02 | Phase B | L3 dry_run 回执 | `sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`、`Assets/Editor/Codex/Infrastructure/Actions/SerializedPropertyActionHandler.cs`、`sidecar/src/mcp/commands/set_serialized_property/*`、相关 tests | `dry_run=true` 透传到 Unity 并返回 per-patch 校验摘要 | `set_serialized_property` dry_run 不落盘且含 `patch_index/status/error_code`；L2 不再短路该命令 |
| R17-POLISH-W-03 | Phase B | 高风险类型策略 | `SerializedPropertyActionHandler.cs`、`ReadErrorMapper.cs`（必要时） | `ManagedReference` 只读不写策略 | 命中高风险类型返回稳定受限错误码 |
| R17-POLISH-W-04 | Phase B | P1/P2 类型支持 | `SidecarContracts.Action.cs`、`sidecar/src/mcp/commands/set_serialized_property/*`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`SerializedPropertyActionHandler.cs`、相关 tests | 支持 `Quaternion/Vector4/Rect`；`AnimationCurve` 受限只读 | 新类型写入与受限策略行为均有稳定测试覆盖 |
| R17-POLISH-R-01 | Phase C | property tree hint | `SerializedPropertyTreeReadService.cs`、`SidecarContracts.Query.cs`、`get_serialized_property_tree/*` | 新增 `common_use/llm_hint` 输出 | 常用组件字段可给出稳定 hint 摘要 |
| R17-POLISH-R-02 | Phase C | 批量读取能力（同对象） | `SidecarContracts.Query.cs`、`SerializedPropertyTreeReadService.cs`、`GetSerializedPropertyTreeQueryHandler.cs`、`sidecar/src/mcp/commands/get_serialized_property_tree/*`、相关 tests | 一次请求支持“同一 GameObject 的多组件”字段树查询 | 批量场景无 token 爆炸，`truncated/next_cursor` 语义不破坏；跨 GameObject 明确后置 |
| R17-POLISH-O11Y-01 | Phase D | 指标采集与存储落地 | `sidecar/src/application/*`、`sidecar/src/api/router.js`（必要时）、`/mcp/metrics` 相关 tests、`docs/V1-POLISH-Metrics-Storage-Design.md`（新增） | 指标采集 + 存储方案（路径/保留周期/开关） | metrics 可观测且有测试快照；存储策略可配置并有文档 |
| R17-POLISH-O11Y-02 | Phase D | 原语提升输入报表 | `sidecar/scripts/*`、`sidecar/package.json`、`docs/*` | 自动生成“高频 property_path 候选原语报表”，支持手动与 CI 触发 | 可重复生成 TopN 候选并纳入评审输入 |
| R17-POLISH-QA-01 | Phase E | Sidecar 回归 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | `V1-POLISH` 新增用例全绿 | Node CI 全绿，关键失败码覆盖完整 |
| R17-POLISH-QA-02 | Phase E | Unity 回归 | `Assets/Editor/Codex/Tests/EditMode/*` | EditMode：bool/array/dry_run/hint/限制策略回归 | 编译 + EditMode 全绿 |
| R17-POLISH-E2E-01 | Phase E | 验收文档 | `docs/Phase17-V1-Polish-Acceptance.md`（新增） | 固化 Cursor + MCP 端到端验收流程 | 按文档可重复完成完整验收 |

---

## 3. 阶段入口与退出条件

### 3.1 Phase A 入口条件
- `R16-HYBRID` 基线已通过（Sidecar gate 全绿）。
- 当前分支已可稳定运行 `npm --prefix sidecar test`。

### 3.2 Phase A 退出条件
- HOT-001/HOT-002/HOT-003 三项全部关闭。
- `set_serialized_property` 不再存在 blocker 级功能缺口。

### 3.3 Phase B/C 退出条件
- 泛化写具备可控的 dry_run + array op 能力。
- P1/P2 类型补齐策略落地（或明确延后记录）。
- 泛化读具备 hint 与批量读取能力，且预算截断逻辑稳定。

### 3.4 Phase E 退出条件
- `test:r17:qa`（待新增）与全量回归通过。
- Phase17 验收文档完成并附证据清单。

---

## 4. 技术约束与统一规范

- 外部协议保持 `action_data` object-only；不得回退暴露 `action_data_json`。
- 所有新增错误码需映射到 `mcpErrorFeedback`，并提供可恢复建议。
- 对 `atomic_safe` action 的改动必须保持 `AtomicActionTestBase` 覆盖。
- 读路径新增字段不得破坏既有 `truncated/next_cursor` 语义。
- 新增 `value_kind` 或 `op` 的实施顺序固定为：L2 validator 先行 → L3 handler 实现 → 双端测试补齐。
- `R17-POLISH-R-02` 仅覆盖“同一 GameObject 多组件批量读取”；跨 GameObject 批量读取不在本阶段范围。
- 指标采集必须可关闭、可清理、可审计：默认本地持久化 + 保留周期配置 + 报表生成有固定入口命令。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| dry_run 升级后返回体过大 | 提高 token 消耗 | 回执采用摘要字段，限制 patch 明细长度 |
| 批量读取导致查询时间抖动 | 影响查询稳定性 | 强制 `node_budget/char_budget/page_size` 上限 |
| array remove 索引漂移 | 写入行为错误 | 统一高索引到低索引删除策略 |
| 指标采集侵入主链路 | 影响时延 | 异步聚合 + 可关闭开关 |

---

## 6. 评审与推进机制（给 Cursor 方案评审员）

每一阶段提交时，PR 说明必须包含：
1. 对应 `任务ID` 列表（仅允许同阶段 ID）。  
2. 变更文件清单与风险说明。  
3. 自动化测试结果（Sidecar / Unity 分开列）。  
4. 未完成项与下一阶段切换条件。  

推荐节奏：  
- 一次只推进一个阶段；阶段内可以按任务 ID 拆多个 PR。  
- 阶段通过后，在 `ROADMAP.md` 更新状态，再进入下阶段。  
- `R17-POLISH-E2E-00` 在 Phase A 启动时先创建并冻结 Case ID，后续任务 PR 必须引用对应 Case ID。  

---

## 7. 当前建议起步任务

建议从 `Phase A` 开始，顺序固定：
1. `R17-POLISH-E2E-00`（先冻结验收大纲）
2. `R17-POLISH-P0-01`（bool 写入）
3. `R17-POLISH-P0-02`（CloneAction marshaled 修复）
4. `R17-POLISH-P0-03`（patch 限制）

完成 `Phase A` 后，再开启 `Phase B`。  
