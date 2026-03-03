# V2-PROTOCOL 协议可用性缺口修复实施方案

版本：v1.4  
更新时间：2026-03-03  
适用范围：`sidecar`（L2） + `Assets/Editor/Codex`（L3，最小联动）

---

## 0. 目标与边界
### 0.1 阶段目标
- 修复“LLM 知道报错但仍持续走错”的协议可用性问题，不改变现有安全硬约束（OCC + 双锚点 + fail-closed）。
- 让 Cursor 在一次失败后可获得**机器可执行**的修复指令（而不是自由文本猜测）。
- 将简单写操作（如 rename）稳定收敛到“读一次 + 写一次”，减少多轮盲重试。
- 补齐 L3 严格 envelope 路径的“快速失败”语义，杜绝无效请求静默挂起到超时取消。

### 0.2 非目标
- 不回退 R16 以来的安全收口（不放宽 `based_on_read_token` / `write_anchor` / `target_anchor` 的硬约束）。
- 不通过新增大量“业务专用 action”规避协议问题（本阶段修的是协议可用性，不是功能数量）。
- 不修改 Unity 核心执行语义（Undo/Atomic 事务保持现状）。

---

## 1. 问题复盘（根因链）

### 1.1 现象
- 简单写操作出现大量重复调用（`apply_visual_actions` 多次失败后重试）。
- 常见失败形态：`target_anchor: {}`、`object_id/path` 缺失、token stale 后继续沿旧 payload 重试。
- 用户感知为“Cursor 在报错里打转”，吞吐明显下降。

### 1.2 根因
1. 工具契约信息分散：
`get_action_schema` 偏 action_data，`get_tool_schema` 才含完整 envelope，LLM 需要自行拼接。
2. 错误引导方向偏差：
`E_ACTION_SCHEMA_INVALID` 常被引导到 `get_action_schema`，而锚点类错误应优先看 `get_tool_schema`。
3. 缺少机器可执行修复：
当前错误响应多为自然语言 suggestion，缺少 `suggested_patch` / `normalized_payload`。
4. 重试缺少治理：
“同 payload + 同错误码”可重复触发，未熔断，导致失败风暴。

### 1.3 为什么“以前顺畅、现在卡锚点”
- 早期链路容错高（可隐式补全/旧字段兼容）；
- R16 收口后协议变严格（这是正确方向）；
- 但没有同步补齐“可用性层”（模板、预检、机器补丁、重试治理），导致严格协议下 LLM 反复猜错。

---

## 2. 修复总览（四层）

### 2.1 Contract Discoverability（让 LLM 一眼会用）
- 在 schema 返回中增加最小可执行模板：`minimal_valid_payload_template`。
- 增加写链路统一摘要：`write_envelope_contract`（必填字段、字段来源、调用顺序）。

### 2.2 Machine-Fixable Error（让错误可自动修）
- 错误响应新增结构化修复字段：`field_path`、`fix_kind`、`suggested_patch[]`、`next_step`。
- 锚点相关错误优先返回 tool schema 引导，不再只给 action schema。

### 2.3 Preflight + Normalization（执行前先纠错）
- 新增预检工具：`preflight_validate_write_payload`（只校验/归一化，不提交 Unity）。
- 在 L2 实施安全归一化：可唯一推断时回填 `target_anchor/write_anchor`；空对象锚点直接拒绝。
- 明确与现有 `dry_run` 的关系：`preflight_validate_write_payload` 是 `dry_run` 的超集升级版。Phase C 收口后，`dry_run` 保留为兼容 alias，并内部统一走 preflight 核心逻辑（语义不变、返回更完整）。

### 2.4 Retry Governance（避免盲重试）
- 对“同 payload_hash + 同 error_code”启用短窗熔断（返回 `E_DUPLICATE_RETRY_BLOCKED`）。
- 仅 `E_STALE_SNAPSHOT` 允许自动走“重新读 token -> 单次重试”。

---

## 3. 执行顺序（按依赖）
1. `Phase A / 引导纠偏`：R20-UX-A-01、R20-UX-A-02、R20-UX-A-03  
2. `Phase B / 契约可见性`：R20-UX-B-01、R20-UX-B-02、R20-UX-B-03  
3. `Phase C / 预检与归一化`：R20-UX-C-01、R20-UX-C-02、R20-UX-C-03  
4. `Phase D / 重试治理`：R20-UX-D-01、R20-UX-D-02  
5. `Phase E / QA 与验收`：R20-UX-QA-01、R20-UX-QA-02、R20-UX-E2E-01
6. `Phase F / Hotfix 收口`：R20-UX-HF-01、R20-UX-HF-02、R20-UX-HF-03
7. `Phase G / 协议治理闭环`：R20-UX-GOV-01、R20-UX-GOV-02、R20-UX-GOV-03、R20-UX-GOV-04、R20-UX-GOV-05、R20-UX-GOV-06、R20-UX-GOV-07、R20-UX-GOV-08

---

## 4. 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R20-UX-A-01 | Phase A | 错误引导纠偏 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、相关 tests | 锚点类 schema 错误优先引导 `get_tool_schema`，不再误导到 action-only | `E_ACTION_SCHEMA_INVALID`(anchor) 响应中 `schema_source=get_tool_schema` |
| R20-UX-A-02 | Phase A | 错误分类器 | `sidecar/src/application/turnPolicies.js` | 新增 field-path 级别分类（anchor/data/token） | `actions[0].target_anchor.*` 被识别为 anchor 类 |
| R20-UX-A-03 | Phase A | 工具面收敛 | `sidecar/src/ports/contracts.js`、`sidecar/src/mcp/mcpServer.js`、相关 tests | tools/list 输出推荐链路提示，deprecated alias 默认降噪 | LLM 可见工具描述包含“最短调用顺序” |
| R20-UX-B-01 | Phase B | action schema 增强 | `sidecar/src/application/capabilityStore.js`、`sidecar/src/mcp/commands/get_action_schema/handler.js`、相关 tests | `get_action_schema` 返回 `minimal_valid_payload_template`（含顶层 envelope） | schema 响应可直接用于一次 apply 调用 |
| R20-UX-B-02 | Phase B | tool schema 增强 | `sidecar/src/mcp/commands/get_tool_schema/handler.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、相关 tests | `get_tool_schema` 返回 `canonical_examples` 与 `required_sequence` | 至少提供 write 成功最小样例 |
| R20-UX-B-03 | Phase B | 契约聚合工具 | `sidecar/src/mcp/commands/get_write_contract_bundle/*`（新增）、`legacyCommandManifest.js`、相关 tests | 一次请求获取 action+tool+最小模板+常见错误修复；引入总字符预算与分级裁剪 | bundle 响应在预算内稳定输出，超限时按优先级降级 |
| R20-UX-C-01 | Phase C | 预检工具 + dry_run 统一 | `sidecar/src/mcp/commands/preflight_validate_write_payload/*`（新增）、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`mcpServer.js`、相关 tests | 不触发 Unity 的 payload 校验/归一化报告；`dry_run` 标记 deprecated alias 并复用 preflight 核心逻辑 | preflight 可输出 blocking/non-blocking 问题；`dry_run` 与 preflight 结论一致 |
| R20-UX-C-02 | Phase C | 安全归一化 | `sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/domain/validators/legacyValidators.js`、相关 tests | 唯一可推断时自动回填锚点；`{}` 锚点 fail-fast | 空锚点不再进入盲重试链 |
| R20-UX-C-03 | Phase C | 机器修复补丁 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/application/turnPolicies.js`、相关 tests | 返回 `suggested_patch[]`、`corrected_payload`（可用时）与 `next_step` | LLM 可优先使用 `corrected_payload` 一次修正并成功 |
| R20-UX-D-01 | Phase D | 重试熔断 | `sidecar/src/application/writeRetryFuse.js`（新增）、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/application/mcpGateway/mcpEyesService.js`、`sidecar/src/application/turnService.js`、`sidecar/src/index.js`、相关 tests | 同 payload+同错误短窗阻断（可配置），含 scope/window/hash 规则 | 重复失败次数显著下降，且不误伤跨线程合法请求 |
| R20-UX-D-02 | Phase D | stale 专用重试策略 | `sidecar/src/application/retryPolicy.js`（新增）、`sidecar/src/application/unitySnapshotService.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/utils/turn/legacyTurnUtils.js`、相关 tests | 仅 `E_STALE_SNAPSHOT` 触发“读 token 后单次重试”建议 | 非 stale 错误不再被建议盲重试 |
| R20-UX-QA-01 | Phase E | Sidecar 回归 | `sidecar/tests/application/r20-protocol-phase-e-closure-gate.test.js`（新增）、`sidecar/tests/application/turn-policies-schema-compensation.test.js`、`sidecar/tests/application/anchor-write-guard.test.js`、`sidecar/tests/application/anchor-error-feedback.test.js`、`sidecar/tests/application/get-write-contract-bundle.test.js`、`sidecar/tests/domain/*`、`sidecar/package.json` | 新增协议可用性回归集（误导修正/预检/补丁/熔断）+ `test:r20:qa` 脚本 | 新增用例全绿 |
| R20-UX-QA-02 | Phase E | Unity 联动回归 | `Assets/Editor/Codex/Tests/EditMode/*`（必要时） | 验证不破坏现有写执行与 selection/read token 链路 | EditMode 编译+关键测试全绿 |
| R20-UX-E2E-01 | Phase E | 验收收口 | `docs/Phase20-Protocol-Usability-Acceptance.md`（新增）、`Assets/Docs/evidence/phase20/README.md`（新增） | 固化 Case A/B/C/D 与证据目录规范 | 按文档可重复完成端到端验收 |
| R20-UX-HF-01 | Phase F | L3 失败语义收口 | `Assets/Editor/Codex/Application/Conversation/TurnStateCoordinator.cs`、`Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs`、相关 EditMode tests | 无效 `unity_action_request` 不再“静默 pending”，必须回报可诊断失败 | 同类异常不再触发 `E_JOB_MAX_RUNTIME_EXCEEDED` 挂起超时 |
| R20-UX-HF-02 | Phase F | 可选锚点兼容防抖 | `Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs`、`Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs` | 非 `create_gameobject` 场景下，`target_anchor` 有效时忽略畸形可选 `parent_anchor` | rename 等高频 mutation 不再因可选锚点脏值误失败 |
| R20-UX-HF-03 | Phase F | 回归与证据补录 | `docs/Phase20-Protocol-Usability-Acceptance.md`、`Assets/Docs/evidence/phase20/*` | 新增“L3 strict envelope hotfix”实机证据与回归条目 | 复现用例从“pending->超时取消”变为“快速失败或一次成功” |
| R20-UX-GOV-01 | Phase G | canonical 语义统一 | `sidecar/src/ports/contracts.js`、`sidecar/src/domain/validators/legacyValidators.js`、`sidecar/src/application/schemaCompensationFixes.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs`、相关 tests | 建立 alias->canonical 单一语义表（create/mutation/anchor policy）并在 L2/L3 复用 | `create_object/create_gameobject`、`rename_object/rename_gameobject` 在 L2/L3 锚点要求一致，无“L2 过/L3 拒绝”漂移 |
| R20-UX-GOV-02 | Phase G | 门禁一致性回归 | `sidecar/tests/application/anchor-write-guard.test.js`、`sidecar/tests/application/turn-policies-schema-compensation.test.js`、`sidecar/tests/application/r20-protocol-phase-e-closure-gate.test.js`、`Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs`、`Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs` | 新增 alias parity 矩阵（canonical + alias 对等） | 覆盖 `create/rename/set_parent/set_active` 的 canonical/alias case，且端到端行为一致 |
| R20-UX-GOV-03 | Phase G | 结构化修复全覆盖 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/application/turnService.js`、相关 tests | 锚点家族错误统一输出 `field_path/fix_kind/suggested_patch/corrected_payload`；L3 源错误做 best-effort 路径补全 | `target_anchor/parent_anchor/write_anchor` 三类错误都可返回机器可执行修复体 |
| R20-UX-GOV-04 | Phase G | 异步终态语义收口 | `sidecar/src/mcp/commands/legacyCommandManifest.js`、`sidecar/src/mcp/commands/get_tool_schema/handler.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/turnService.js`、相关 tests | 统一“提交后必须轮询终态”的可执行指引，禁止把 `accepted` 视为成功 | 工具描述、schema 示例、错误建议均包含 `submit -> poll(get_unity_task_status) -> terminal` 链路 |
| R20-UX-GOV-05 | Phase G | 可观测性增强 | `sidecar/src/application/turnService.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`Assets/Editor/Codex/Infrastructure/Write/OperationHistoryStore.cs`、`Assets/Editor/Codex/Tests/EditMode/OperationHistoryStoreTests.cs`、相关 tests | 失败事件统一携带 `request_id/error_code/error_message/field_path/anchor_snapshot` 并持久化 | 单条失败可从 evidence 直接定位到请求、字段路径与锚点上下文 |
| R20-UX-GOV-06 | Phase G | 黄金路径模板 | `sidecar/src/mcp/commands/get_write_contract_bundle/handler.js`、`sidecar/src/mcp/commands/get_tool_schema/handler.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、相关 tests | 内置高频任务模板（`create`/`rename`/`set_parent`/`set_active`）+ action-type 锚点决策表 | Cursor 在单轮 schema 查询后可按模板一次构造正确 payload（无空锚点重试风暴） |
| R20-UX-GOV-07 | Phase G | 指标基线闭环 | `sidecar/src/application/mcpGateway/metricsView.js`、`sidecar/scripts/generate-r20-ux-governance-baseline.js`（新增）、`docs/Phase20-Protocol-Usability-Acceptance.md`、`Assets/Docs/evidence/phase20/*` | 采集并固化“改造前/后”指标（重试次数、收敛轮次、超时率、token 消耗） | 验收文档含可追溯的 before/after 数值与证据文件 |
| R20-UX-GOV-08 | Phase G | lifecycle 收口 | `sidecar/src/mcp/commands/preflight_validate_write_payload/handler.js`、`sidecar/src/mcp/commands/preflight_validate_write_payload/validator.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`docs/V2-PROTOCOL-协议可用性缺口修复实施方案.md` | 明确 `preflight` 升级 stable 的门槛与时间点；`dry_run` 仅保留兼容 alias（带 deprecation 指引） | 旧调用不破坏，新调用默认引导 preflight，且迁移规则在文档和响应中一致 |

---

## 5. 核心 DTO 与返回结构（建议）

### 5.1 `write_envelope_contract`
```json
{
  "tool_name": "apply_visual_actions",
  "required_top_level": ["based_on_read_token", "write_anchor", "actions"],
  "required_action_level": ["type", "target_anchor", "action_data"],
  "anchor_shape": { "object_id": "string", "path": "string" }
}
```

### 5.2 `minimal_valid_payload_template`
```json
{
  "based_on_read_token": "<from get_current_selection.read_token>",
  "write_anchor": { "object_id": "<id>", "path": "Scene/Path" },
  "actions": [
    {
      "type": "rename_object",
      "target_anchor": { "object_id": "<id>", "path": "Scene/Path" },
      "action_data": { "name": "NewName" }
    }
  ]
}
```

### 5.3 `suggested_patch`
```json
{
  "error_code": "E_ACTION_SCHEMA_INVALID",
  "field_path": "actions[0].target_anchor.object_id",
  "fix_kind": "missing_required_field",
  "suggested_patch": [
    {
      "op": "replace",
      "path": "/actions/0/target_anchor",
      "value": { "object_id": "<from write_anchor.object_id>", "path": "<from write_anchor.path>" }
    }
  ],
  "next_step": "retry_with_patched_payload"
}
```

### 5.4 `corrected_payload`（建议并行返回）
```json
{
  "error_code": "E_ACTION_SCHEMA_INVALID",
  "field_path": "actions[0].target_anchor.object_id",
  "fix_kind": "missing_required_field",
  "normalization_applied": true,
  "original_payload_hash": "sha256:...",
  "corrected_payload": {
    "based_on_read_token": "rt_xxx",
    "write_anchor": { "object_id": "go_x", "path": "Scene/Canvas/Panel" },
    "actions": [
      {
        "type": "rename_object",
        "target_anchor": { "object_id": "go_x", "path": "Scene/Canvas/Panel" },
        "action_data": { "name": "A" }
      }
    ]
  }
}
```

### 5.5 `preflight_validate_write_payload` 响应
```json
{
  "ok": true,
  "preflight": {
    "valid": false,
    "blocking_errors": [
      {
        "error_code": "E_ACTION_SCHEMA_INVALID",
        "field_path": "actions[0].target_anchor.object_id"
      }
    ],
    "normalized_payload": { "...": "..." }
  }
}
```

### 5.6 归一化决策表（C-02）
| 场景 | 是否回填 | 规则 |
|---|---|---|
| 单 action，`target_anchor` 缺失/空对象，`write_anchor` 有效 | ✅ | `target_anchor := write_anchor` |
| 单 action，`create_gameobject/create_object` 且 `parent_anchor` 缺失/空对象，`write_anchor` 有效 | ✅ | `parent_anchor := write_anchor`（仅 create 语义） |
| 多 action（N>1），存在缺失 `target_anchor` | ❌ | 拒绝，返回 `E_ACTION_SCHEMA_INVALID`（非唯一目标） |
| `create_gameobject/create_object` 语义需要 `parent_anchor` | ❌（不回填 target） | 按 action 语义要求 `parent_anchor` |
| `write_anchor` 本身为空对象或缺字段 | ❌ | fail-fast，不做推断 |
| `target_anchor` 与 `write_anchor` 同时存在且冲突 | ❌ | 返回冲突错误，不自动覆盖 |

### 5.7 Retry Fuse DTO（D-01）
```json
{
  "fuse_key": "sha256(thread_id + normalized_payload_wo_token + error_code)",
  "scope": "per_thread",
  "window_ms": 30000,
  "max_attempts": 2,
  "escalation_error_code": "E_DUPLICATE_RETRY_BLOCKED"
}
```

### 5.8 `get_write_contract_bundle` 预算与降级
```json
{
  "bundle_budget_chars": 3600,
  "trim_priority": [
    "write_envelope_contract",
    "minimal_valid_payload_template",
    "canonical_examples",
    "error_fix_map"
  ],
  "budget_truncated": false
}
```

---

## 6. 技术约束
- 不放宽 OCC：`based_on_read_token` 仍为硬门槛。
- 不放宽锚点：`object_id/path` 仍为硬门槛；仅在“可唯一推断”时做自动回填。
- 不引入隐式 Unity 写：preflight 仅校验，不提交任务。
- `preflight_validate_write_payload` 与 `dry_run` 共存期内语义一致，最终以 preflight 为主入口。
- 所有新错误码必须接入 `mcpErrorFeedback`，并带 `recoverable/suggestion`。
- 新增返回字段必须保持向后兼容（新增不删减）。
- 本阶段不改 Unity（L3）错误返回结构；`field_path/fix_kind/corrected_payload` 由 L2 生成。若 L3 返回无字段路径错误，L2 做 best-effort 推断。
- L3 严格校验保留，但不得采用“静默忽略并保持 pending”的行为；无效请求必须可观测、可终态收敛。

---

## 7. 风险与回滚
| 风险 | 影响 | 缓解 |
|---|---|---|
| 归一化过度导致误写 | 错误对象被修改 | 仅允许“唯一推断”回填；多候选直接报错 |
| 熔断误伤合法重试 | 吞吐下降 | 熔断仅针对“同 payload_hash + 同错误码 + 短时间窗” |
| schema 体积增大 | token 增加 | 模板压缩 + hint 长度上限 |
| 新字段影响旧客户端 | 兼容风险 | 只增不改；保留旧字段语义 |
| preflight 与 dry_run 双入口造成选择困难 | LLM 仍可能走错入口 | dry_run 标记 deprecated alias，文档与工具描述统一引导 preflight |
| JSON Patch 对 LLM 认知负担高 | 仍可能修复失败 | 并行返回 `corrected_payload`，优先消费完整修正体 |
| L3 严格 envelope 与 L2 容错不一致 | 出现“L2 放行、L3 拒绝”的体验割裂 | Phase F 增加一致性 hotfix + 端到端回归 |

回滚策略：
- 通过 feature flag 分阶段启用：`UX_SCHEMA_TEMPLATE_ENABLED`、`UX_PREFLIGHT_ENABLED`、`UX_RETRY_FUSE_ENABLED`。
- 任一阶段异常可单独关闭，不影响现有写执行主链路。

---

## 8. 阶段映射与状态跟踪（R20-UX）
| 阶段 | 阶段ID 范围 | 目标 | 状态 |
|---|---|---|---|
| Phase A | `R20-UX-A-01 ~ A-03` | 错误引导纠偏与工具降噪 | ✅ 已完成 |
| Phase B | `R20-UX-B-01 ~ B-03` | 契约可见性与最小模板 | ✅ 已完成 |
| Phase C | `R20-UX-C-01 ~ C-03` | 预检 + 安全归一化 + 机器补丁 | ✅ 已完成（开发 + Sidecar 回归） |
| Phase D | `R20-UX-D-01 ~ D-02` | 重试治理 | ✅ 已完成（开发 + Sidecar 回归） |
| Phase E | `R20-UX-QA-01 ~ E2E-01` | QA 与验收收口 | 🟡 进行中（`R20-UX-QA-01`/`R20-UX-E2E-01` 已完成，`QA-02` 待 Unity 实机证据） |
| Phase F | `R20-UX-HF-01 ~ HF-03` | L3 strict envelope hotfix 收口 | ✅ 已完成（后续发现 alias parity 缺口，已转入 Phase G） |
| Phase G | `R20-UX-GOV-01 ~ GOV-08` | 协议治理闭环（语义统一、修复覆盖、可观测、模板化） | 🟡 待启动（本次已补齐执行矩阵，待按依赖推进） |

---

## 9. 定量验收指标（新增）
| 指标 | 当前基线（先测） | 目标（Phase D 后） |
|---|---|---|
| rename 平均重试次数 | 待基线采样（预估 3~5） | ≤ 1.5 |
| 锚点类错误到成功收敛轮次 | 待基线采样 | ≤ 2 |
| 同 payload 重复失败风暴次数 | 待基线采样 | 0（被熔断阻断） |
| `schema 往返次数`（单次写） | 待基线采样 | ≤ 1 |
| `pending -> max_runtime_timeout` 比例（简单 mutation） | 待基线采样 | 0 |

---

## 10. 建议先启动的任务
0. `R20-UX-HF-01 + R20-UX-HF-02`：先收口 L3 strict envelope 挂起缺陷，确保请求终态可收敛。  
1. `R20-UX-A-01 + R20-UX-A-02`：先做错误引导纠偏 + field-path 分类（强依赖，需一起落）。  
2. `R20-UX-B-01`：补 `minimal_valid_payload_template`（直接降低 LLM 猜测成本）。  
3. `R20-UX-C-03`：补 `suggested_patch + corrected_payload`（依赖 A-02 的分类产物）。  

---

## 11. 后续优化（本阶段不实施）
- 错误码语义拆分（`E_ACTION_SCHEMA_INVALID` 降载）：  
  建议后续拆分为 `E_ANCHOR_MISSING/E_ANCHOR_INVALID/E_ACTION_DATA_INVALID/...`，降低单错误码多语义歧义。  
- 若评审后确认需要，可在 `Phase B+` 单独立项推进并做兼容迁移。

---

## 12. 二次复盘（架构级归因，2026-03-03 增补）
### 12.1 关键结论
- 当前问题不是“单个参数填错”，而是**门禁严格性与可用性配套不对称**。
- 严格门禁本身是正确的（保护 OCC/锚点/原子性）；真正问题是：
  `严格校验` 已上线，但 `契约可见性 + 机器修复 + 双层一致性` 未完全闭环。
- 近期反复暴露的问题，90% 属于“参数/封套形状错误”，但根因是系统设计缺口，不是用户操作问题。

### 12.2 反复失败的系统性模式
| 模式 | 表象 | 架构根因 |
|---|---|---|
| L2/L3 规则不一致 | L2 放行，L3 拒绝（`E_ACTION_SCHEMA_INVALID`） | 双层门禁使用了不同的 create/mutation 语义判定 |
| Alias 语义漂移 | `create_object` 在某层被视为 create，在另一层被视为 mutation | 别名映射未在所有门禁点同步 |
| 修复建议单点化 | 只修 `target_anchor`，`parent_anchor` 仍打转 | 机器修复策略覆盖面不完整（仅部分锚点家族） |
| 终态可观测性不足 | 仅看到错误码，看不到触发字段/消息 | 日志与错误结构缺少 field-path 级诊断 |
| 异步执行被误解为失败 | `accepted + job_id` 被当作已完成 | 工具语义与调用策略（轮询直到终态）没有被硬约束 |

### 12.3 “以前顺畅、现在卡住”的真实原因
- 早期阶段：容错高，隐式兼容多，模型即使参数不严谨也能“碰巧成功”。
- 收口之后：严格性提升是正确的，但若不同时提供“自动对齐层”，模型会持续撞门禁。
- 因此不是“太严格”，而是“严格但缺少工业化防呆层”。

### 12.4 代码级缺口（已确认，采纳 Cursor 审查意见）
1. `create_object` alias 在 L2/L3 语义不一致（高优先级）  
   - L2 `legacyValidators` 的硬检查曾只覆盖 `create_gameobject`，而 L2 归一化/L3 校验均将 `create_object` 视为 create-like。  
   - 结果是同一 payload 可能出现 “L2 可过 / L3 拒绝”。
2. 高频 action 的锚点校验依赖路径分散（高优先级）  
   - 组件类 mutation 有硬编码兜底；其余高频 action 更依赖 capability policy 动态校验。  
   - 当 policy 缺失或别名漂移时，行为可用性下降。
3. 结构化修复信息在“L3 返回错误”路径覆盖不足（中优先级）  
   - `suggested_patch/corrected_payload` 主要由 L2 校验补偿生成。  
   - L3 来源错误目前仅 best-effort 分类，修复建议完整性不稳定。
4. `tools/list` 的锚点决策提示粒度不足（中优先级）  
   - 目前有“最短调用顺序”，但 action-type 级锚点规则仍不够直观，LLM 仍需往返查询。
5. 定量基线尚未固化（中优先级）  
   - 已定义指标但未完成版本基线采样，难以证明优化收益幅度。

---

## 13. 根治方案（从补丁模式升级为治理模式）
### 13.1 治理原则
- `P1` 不放宽安全：OCC、锚点完整性、原子回滚保持硬门槛。
- `P2` 单一契约源：L2/L3 对 action 语义、alias、锚点策略使用同一份规范。
- `P3` 失败可执行：所有高频 schema 失败都必须返回可重放 `corrected_payload`。
- `P4` 默认可收敛：简单任务在 1~2 轮内收敛，不允许无限重试风暴。

### 13.2 新增治理任务（Phase G，优先级高于后续新功能）
| 任务ID | 模块 | 目标 | 交付 |
|---|---|---|---|
| R20-UX-GOV-01 | L2/L3 契约统一 | 建立 action 语义与 alias 单一真源（create/mutation 判定一致） | 在 `legacyValidators`、`mcpEyesWriteService`、L3 `PendingActionCoordinator` 统一 alias->canonical 判定 + 回归测试 |
| R20-UX-GOV-02 | 门禁一致性测试 | 防止“L2 通过/L3 拒绝”回归 | 新增 parity test：`create_object/create_gameobject`、`rename_object/rename_gameobject`、`set_active/set_gameobject_active` 等 canonical/alias 对等 case |
| R20-UX-GOV-03 | 修复覆盖面扩展 | 机器修复覆盖 `target_anchor/parent_anchor/write_anchor` 全族 | `corrected_payload` + `suggested_patch` 全锚点家族统一输出；L3 来源错误增加 best-effort field_path 回填 |
| R20-UX-GOV-04 | 异步语义约束 | 工具说明与策略强制“提交后轮询终态” | tools 描述 + turn policy + E2E 场景收口（禁止 `accepted` 即结束） |
| R20-UX-GOV-05 | 可观测性增强 | 失败日志必须可定位字段与上下文 | `error_code + error_message + field_path + anchor_snapshot + request_id` 统一落盘到 operation_history |
| R20-UX-GOV-06 | 黄金路径封装 | 为高频任务提供“最短可执行链路”模板 | create/rename/set-parent/set-active 四类黄金模板；在 `tools/list` 内联锚点决策表（action-type 级） |
| R20-UX-GOV-07 | 指标基线采样 | 建立改造前后可比的定量证据 | 采集“重试次数、收敛轮次、超时取消率、token 消耗”基线，并固化到 evidence |
| R20-UX-GOV-08 | lifecycle 收口 | 消除 `dry_run` 与 `preflight` 双入口歧义 | 明确 preflight 从 experimental -> stable 的升级门槛与时间点，`dry_run` 保持 alias 但文档降级为兼容入口 |

### 13.3 不应采取的“伪修复”
- 不通过放宽 schema 来“提升成功率”。
- 不通过新增大量专用 action 回避封套问题。
- 不通过关闭门禁规避 LLM 参数错误。
- 不在 L3 silently fallback（必须显式失败并可诊断）。

### 13.4 审慎采纳项（默认关闭）
- “归一化成功后直接执行”仅作为受控实验能力：  
  - 默认 `OFF`，仅在 feature flag + 审计日志完整 + 明确用户授权场景下启用。  
  - 原因：该模式属于“隐式改写后执行”，若默认开启会提升误写风险。

### 13.5 Phase G 执行顺序（按依赖）
1. `R20-UX-GOV-01`：先统一 canonical 语义与 alias 映射（先修根，再修表现）。  
2. `R20-UX-GOV-02`：建立 L2/L3 parity 回归矩阵，锁住一致性。  
3. `R20-UX-GOV-03`：扩展机器修复覆盖面到三类锚点全族。  
4. `R20-UX-GOV-04`：统一异步终态语义，禁止 `accepted` 被当成功。  
5. `R20-UX-GOV-05`：补齐失败可观测字段并落盘。  
6. `R20-UX-GOV-06`：上线高频黄金模板，降低 LLM 拼装成本。  
7. `R20-UX-GOV-07`：采集 before/after 指标，形成治理收益证据。  
8. `R20-UX-GOV-08`：完成 preflight/dry_run lifecycle 收口与迁移公告。

---

## 14. 架构审查清单（供 Cursor 评审）
### 14.1 一致性审查
- `create_object` 与 `create_gameobject` 在 L2/L3 是否同语义、同锚点要求。
- `rename_object` 与 `rename_gameobject` 是否同语义、同目标锚点要求。
- `anchor_policy` 是否由同一能力快照驱动，不允许硬编码分叉。

### 14.2 可用性审查
- 高频失败是否总能返回 `field_path + fix_kind + corrected_payload`。
- `preflight` 与真实写执行的验证结果是否一致。
- `dry_run` alias 是否严格等价于 preflight 核心逻辑。

### 14.3 终态审查
- 提交异步任务后，客户端是否轮询到 `succeeded/failed/cancelled` 再结束。
- 5 分钟超时取消是否带明确可恢复建议，且不会误导为“已执行成功”。

### 14.4 回归审查
- 必须覆盖四类 case：`rename`、`create UI`、`set parent`、`component add/remove`。
- 每类至少包含：正确 payload、空锚点 payload、alias payload、stale token payload。

---

## 15. 当前阶段结论（给管理决策）
- 现状可用性已经显著提升，但仍未达到“工程化稳态”。
- 在 `Phase G` 完成前，不建议继续推进高复杂新能力（尤其自升级自动写代码链路）。
- 推荐策略：先完成协议治理闭环（GOV-01~06），再恢复 V2 及后续能力开发。
