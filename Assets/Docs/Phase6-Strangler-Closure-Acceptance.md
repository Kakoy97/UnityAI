# Phase 6 Strangler Closure Acceptance

## 1. 目的

本文档用于固化 Phase 6（绞杀收口）终局验收。
验收目标是确认系统已经进入“仅保留新架构路径”的冻结基线状态。

## 2. 验收范围

- 旧入口硬拒绝：旧 HTTP 路由、旧 MCP 工具不再可用。
- 新入口可用：L1->L2->L3 新链路（读、写、回调、状态、流）可稳定工作。
- 硬防线不回退：OCC、双锚点、自动清理、错误反馈模板持续强制。
- 指标可观测：`/mcp/metrics` 与 stream 关键字段、契约版本标记稳定。

## 3. 终局验收链路（P6-E2E-01）

### A. 旧入口拒绝（必须通过）

1. 访问旧路由（例如 `/session/start`、`/turn/send`、`/file-actions/apply`、旧 MCP eyes 路由）。
2. 预期：统一返回 `410`，`error_code=E_GONE`。
3. 判定：不存在任何可绕过新链路的旧执行入口。

### B. 新入口可用（必须通过）

1. 走新写链路：`submit_unity_task` / `apply_script_actions` / `apply_visual_actions`。
2. 走新读链路：`list_assets_in_folder` / `get_scene_roots` / `find_objects_by_component` / `query_prefab_info`。
3. 走 Unity 回调链路：`/unity/query/pull` + `/unity/query/report`、`/unity/runtime/ping`、`/unity/action/result`。
4. 预期：任务可被创建、查询、取消；读写握手闭环稳定。

### C. 硬防线不回退（必须通过）

1. OCC：缺失/过期/漂移 token 必须被拦截，返回 `E_STALE_SNAPSHOT`。
2. 双锚点：写请求缺 `write_anchor` 或 action 锚点不满足联合类型必须拒绝。
3. 自动清理：失联/超时 Job 自动取消并释放锁，无需手工恢复。
4. 错误模板：关键错误 suggestion 保持固定策略，不出现随机漂移。

### D. 指标与流协议可观测（必须通过）

1. `GET /mcp/metrics` 返回字段：
   - `observability_phase=phase6_freeze`
   - `metrics_contract_version=mcp.metrics.v1`
2. `GET /mcp/stream`：
   - 响应头包含 `X-Codex-Stream-Contract-Version` 与 `X-Codex-Stream-Ready-Contract-Version`
   - `stream.ready` 事件包含 `stream_ready_contract_version=mcp.stream.ready.v1`
   - 普通流事件包含 `stream_event_contract_version=mcp.stream.event.v1`

## 4. 自动化映射

### 4.1 Sidecar 回归矩阵（P6-QA-01）

执行：

```bash
cd sidecar
npm test
npm run smoke:fast
npm run gate:step8
```

关键覆盖：

- `sidecar/tests/application/phase6-freeze-regression.test.js`
  - 旧路由硬拒绝
  - MCP 工具去旧化
  - stream/metrics 契约版本标记
- `sidecar/tests/domain/contracts.phase6-freeze.test.js`
  - 冻结契约常量完整性（工具清单、观测版本）
- 既有守护测试（OCC/双锚点/自动清理/错误模板）
  - `occ-write-guard.test.js`
  - `validators.anchor-hardcut.test.js`
  - `job-lease-janitor.test.js`
  - `anchor-error-feedback.test.js`

### 4.2 Unity EditMode 收口测试（P6-QA-02）

在 Unity Test Runner（EditMode）执行：

- `UnityPhase6ClosureTests.UnityActionRequestEnvelope_Deserializes_Phase6RequiredFields`
- `UnityPhase6ClosureTests.PollingEntry_IsGlobalBootstrap_NotWindowUpdateBound`
- `UnityPhase6ClosureTests.NormalizeUnityActionResultRequest_PreservesPhase6ReceiptCoreFields`

补充既有用例：

- `UnityAnchorExecutionTests`
- `UnityRuntimeRecoveryTests`
- `UnityErrorFeedbackReceiptTests`

## 5. 退出标准（全部满足）

1. A/B/C/D 四条终局链路全部通过。
2. Sidecar 自动化全部通过（`npm test`、`smoke:fast`、`gate:step8`）。
3. Unity EditMode 收口测试通过，且无旧路径回归。
4. 文档/脚本/契约均已冻结在新架构路径，不再依赖历史兼容行为。

满足以上条件后，可标记：**Phase 6 完成，Codex-Unity 重构总蓝图收口完成**。
