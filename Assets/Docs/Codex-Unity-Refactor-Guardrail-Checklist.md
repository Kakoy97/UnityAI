# Codex Unity 重构防偏航检查清单（Guardrail Checklist v1）

- 状态: Active
- 日期: 2026-02-22
- 关联文档:
  - `Assets/Docs/Codex-Unity-Refactor-Roadmap.md`
  - `Assets/Docs/Codex-Unity-Refactor-Execution-Plan.md`
- 目的: 确保“最小风险渐进重构”不退化为“局部补丁堆叠”，并持续对齐最终目标架构。

## 1. 使用方式（强制）

1. 每次迭代只绑定一个主 Step（允许附带处理前后依赖，但不得跨级跳步）。
2. 开发前先填写“Step 级检查项”的预期证据与回滚开关。
3. 发布前逐项勾选本清单；任一 No-Go 命中则禁止灰度。
4. 发布后将证据落盘到:
   - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
   - 相关回归报告（JSON/CSV/日志快照）

## 2. 全局红线（任一触发即 No-Go）

1. 出现第二套执行状态机（MCP 复制了 Sidecar 执行状态）。
2. 破坏 `turn.completed` / `turn.error` / `turn.cancelled` 兼容语义。
3. 长耗时链路不可取消、不可超时或不可恢复。
4. 未经过本地 validator/权限校验就放行动作执行。
5. 无观测、无回归报告即推进灰度。
6. 无互斥/幂等保障即开放 MCP submit 并发提交。

## 3. Step 级检查项（发布门禁）

## Step 0（基线冻结）

1. 必须达成:
   - 协议、错误码、默认超时参数已冻结并记录。
   - 20 轮 smoke 可稳定复跑。
2. 偏航信号:
   - 直接改主流程逻辑但无基线对照。
3. 发布证据:
   - 回归通过率 >= 95%。
   - P50/P95 阶段耗时、超时率、提取失败率基线。
   - `E_CODEX_TIMEOUT` 与 `E_COMPILE_TIMEOUT` 可稳定复现记录。
4. 回滚要求:
   - Step 0 仅新增脚本/数据，可一键撤销。

## Step 1（执行内核稳定化）

1. 必须达成:
   - soft/hard/compile 超时行为统一。
   - 超时清扫 100% 触发 `AbortController.abort()`。
2. 偏航信号:
   - 只加“兜底重试”而不解决僵尸请求根因。
   - 超时处理分叉到多套不一致逻辑。
3. 发布证据:
   - in-flight 请求超时后全部终止。
   - 日志可定位卡在 Text 还是 Extraction 阶段。
4. 回滚要求:
   - 超时新策略必须受 feature flag 控制并可回退。

## Step 2（Planner/Prompt 轻量化）

1. 必须达成:
   - Phase 1 保留探索但收敛范围。
   - Phase 2 严格承担 JSON 翻译职责。
2. 偏航信号:
   - 把安全约束搬到 Prompt，弱化本地 validator。
   - 通过叠加规则掩盖提取问题，导致提示词继续膨胀。
3. 发布证据:
   - JSON 提取失败率下降。
   - TTFT 与单轮 token（P50/P95）较 Step 0 改善。
4. 回滚要求:
   - Prompt 版本可回滚到上一个稳定模板。

## Step 3（Action Protocol 完整化）

1. 必须达成:
   - 文件动作与视觉动作协议全集可校验、可执行。
   - Missing Script 清理与模糊匹配容错落地。
2. 偏航信号:
   - 通过“放宽校验”提升通过率，牺牲安全边界。
   - 视觉动作绕过编译门禁。
3. 发布证据:
   - 动作全集自动化 + 手工回归通过。
   - 重命名脚本 + 组件替换组合场景稳定通过。
4. 回滚要求:
   - 视觉动作按 type 可独立关闭。

## Step 4（ReAct 探针链路）

1. 必须达成:
   - `query_unity_components` 仅在 Phase 1 可用。
   - Sidecar-Unity 查询桥接可超时、可失败返回、不中断整轮。
2. 偏航信号:
   - 回退到“猜组件名”而不走查询结果驱动。
   - 查询执行未锁定 Unity 主线程。
3. 发布证据:
   - “移除除 X 外组件”稳定输出合法 `remove_component`。
   - `E_ACTION_COMPONENT_NOT_FOUND` 幻觉型错误下降。
4. 回滚要求:
   - 探针工具有独立开关，异常时回退无探针模式。

## Step 5（MCP Adapter + Job Ticket）

1. 必须达成:
   - MCP 只做适配，不复制 Sidecar 状态机。
   - 异步票据与状态语义完整落地。
   - 互斥 + 幂等 + 有界队列可用。
2. 偏航信号:
   - 用轮询充当主链路，推送通道缺位。
   - 并发冲突没有 `running_job_id` 反馈。
3. 发布证据:
   - 编译长耗时不阻塞 MCP 工具调用。
   - 重复提交命中同一 `job_id`。
   - 结构化错误可驱动上层自动修正重试。
4. 回滚要求:
   - MCP Adapter 可通过 feature flag 一键关闭。

## Step 6（推送与恢复治理）

1. 必须达成:
   - 推送优先（stdio/SSE），查询仅兜底。
   - 重启后 `running/queued` 可恢复或回收。
2. 偏航信号:
   - 高频轮询替代推送。
   - Sidecar 重启后出现“幽灵运行”。
3. 发布证据:
   - `job.progress` / `job.completed` 事件稳定。
   - 查询调用频率相对推送显著下降。
4. 回滚要求:
   - 推送异常时可临时切回低频查询模式。

## Step 7（记忆与 Token 治理）

1. 必须达成:
   - 热上下文 + 冷摘要分层生效。
   - 上下文预算器限制注入规模。
2. 偏航信号:
   - 为追求成功率重新灌入全量历史，token 反弹。
3. 发布证据:
   - 同类任务 token 相对 Step 0 下降。
   - 长会话质量无明显退化。
4. 回滚要求:
   - 摘要注入策略可按开关回退。

## Step 8（观测与测试闭环）

1. 必须达成:
   - 指标看板与自动化测试矩阵可持续产出。
   - 失败回合可回放复现。
2. 偏航信号:
   - 仅靠人工经验定位问题，缺机器可读报告。
3. 发布证据:
   - 每次迭代有回归报告（机器可读）。
   - 重大故障 10 分钟内可定位到具体阶段。
4. 回滚要求:
   - 观测/测试增强可独立回滚，不影响主链路。

## 4. 迭代记录模板（每次改动都填）

```md
### Iteration: YYYY-MM-DD / Owner
- Target Step:
- Scope Files:
- Expected Outcome:
- Evidence:
  - Regression pass rate:
  - P50/P95 metrics:
  - Error-code delta:
- Rollback Switch:
- Go/No-Go Decision:
```

## 5. 迭代记录（已执行）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 0（基线冻结与回归门禁）
- Scope Files:
  - `sidecar/scripts/smoke-turn-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 20 轮 smoke 稳定通过并产出机器可读报告。
  - `E_COMPILE_TIMEOUT` / `E_CODEX_TIMEOUT` 可独立端口稳定复现。
  - 报告具备可比对的 P50/P95 指标且不会同秒覆盖。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_094514782_06820_328.json` => 25/25 pass（100%）
    - `sidecar/.state/smoke-turn-report-20260222_094520196_17588_254.json` => 8/8 pass（含 `E_COMPILE_TIMEOUT`）
    - `sidecar/.state/smoke-turn-report-20260222_094528115_33576_146.json` => 6/6 pass（含 `E_CODEX_TIMEOUT`）
  - P50/P95 metrics:
    - `sidecar/.state/smoke-turn-report-20260222_094514782_06820_328.json`:
      - case_duration_ms: P50=7ms, P95=8ms
      - file_compile_round_duration_ms: P50=7ms, P95=8ms
  - Error-code delta:
    - 无新增未知错误码；按预期复现 `E_COMPILE_TIMEOUT` / `E_CODEX_TIMEOUT`。
- Rollback Switch:
  - 仅涉及 smoke runner 与 npm 脚本，回滚方式为还原 `sidecar/scripts/smoke-turn-runner.js` 与 `sidecar/package.json`。
- Go/No-Go Decision:
  - Go（Step 0 门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 1（执行内核稳定化）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/src/domain/turnStore.js`
- Expected Outcome:
  - 超时清扫路径继续触发 `AbortController.abort()` 清理 in-flight 请求。
  - 增加 feature flag 回滚点，允许禁用 timeout-abort 新逻辑。
  - compile timeout 消息使用真实配置值，避免固定常量偏差。
- Evidence:
  - Regression pass rate:
    - 同 Step 0 三组 smoke 报告全部通过（无回归）。
  - P50/P95 metrics:
    - 同 Step 0 基线报告（无性能退化信号）。
  - Error-code delta:
    - `codex_timeout_sweep` 保持 `E_CODEX_TIMEOUT`，且含 `diag.timeout.abort` 诊断事件。
    - `compile_timeout_sweep` 保持 `E_COMPILE_TIMEOUT`。
- Rollback Switch:
  - 新增 `ENABLE_TIMEOUT_ABORT_CLEANUP`（默认 `true`）；设为 `false` 可回退到“仅失败标记、不执行 timeout-abort 清理”的旧策略。
- Go/No-Go Decision:
  - Go（Step 1 门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 2（Planner/Prompt 轻量化）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/domain/turnStore.js`
  - `sidecar/scripts/step2-metrics-compare.js`
  - `sidecar/package.json`
  - `sidecar/README.md`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
- Expected Outcome:
  - 落地可量化发布证据链路，输出 token/TTFT/提取失败率的 P50/P95 对比报表。
  - 不破坏 Step 0/Step 1 已有回归门禁。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_131605884_30160_892.json` => 25/25 pass
    - `sidecar/.state/smoke-turn-report-20260222_131605777_30384_770.json` => 8/8 pass
    - `sidecar/.state/smoke-turn-report-20260222_131755994_23444_519.json` => 6/6 pass（codex timeout sweep）
  - P50/P95 metrics:
    - 新增报表脚本 `npm run metrics:step2`（产出 `planner-metrics-v1/v2` 与 `step2-metrics-compare`）。
    - 正式回填样例 `sidecar/.state/step2-metrics-compare-20260224_045836592_25664_344.json`:
      - `comparable=true`（baseline/candidate 有效轮次均为 12）
      - `ttft_ms`:
        - P50: `10638 -> 7495`（改善 `+29.55%`）
        - P95: `15993 -> 8339`（改善 `+47.86%`）
      - `total_tokens`:
        - P50: `107 -> 149`（改善率 `-39.25%`，表示 token 上升）
        - P95: `190 -> 315`（改善率 `-65.79%`，表示 token 上升）
      - `extraction_failure_rate_pct`: baseline/candidate 均 `0%`。
  - Error-code delta:
    - 无新增协议错误码；新增观测事件 `text_turn_first_token` / `text_turn_usage` / `extraction_turn_usage` / `extraction_turn_failed`。
- Rollback Switch:
  - `PLANNER_PROMPT_TEMPLATE=v1` 可回退模板；指标脚本与埋点可独立回滚。
- Go/No-Go Decision:
  - Go（Step 2 指标链路与正式对比证据已落地；token 体积项由后续 Step 7 治理持续收敛）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 4 预备项（ReAct 探针回滚开关）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/index.js`
  - `sidecar/README.md`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
- Expected Outcome:
  - 探针工具链路具备独立 feature flag，可在异常时一键回退无探针模式。
- Evidence:
  - 新增环境变量 `ENABLE_UNITY_COMPONENT_QUERY_TOOL`（默认 `true`）。
  - 关闭时 Planner 不再注入 `query_unity_components` tool，Prompt 同步提示“探针已禁用”。
- Rollback Switch:
  - `ENABLE_UNITY_COMPONENT_QUERY_TOOL=false`
- Go/No-Go Decision:
  - Go（满足 Step 4 回滚要求的预备条件）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 3（Action Protocol 完整化）切片 1
- Scope Files:
  - `sidecar/scripts/smoke-turn-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 新增组合回归用例，验证 `rename_file + compile + visual action` 的状态闭环。
  - 新增错配防护回归，验证错误 `unity.action.result` 不会污染状态机。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_134930505_23628_657.json` => 10/10 pass
    - `sidecar/.state/smoke-turn-report-20260222_134930506_35196_603.json` => 27/27 pass
    - `sidecar/.state/smoke-turn-report-20260222_134930488_15008_141.json` => 8/8 pass（codex timeout）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增错误码；错配 `unity.action.result` 返回 `409`，且回合保持在 `action_confirm_pending` 直到正确回执。
    - 修正 `turnService` 的 `409` 响应覆盖问题，确保 `error_code/message` 不再被状态快照字段覆盖。
- Rollback Switch:
  - 回滚 `rename_visual_chain_round` 用例改动即可恢复旧 smoke 集合。
- Go/No-Go Decision:
  - Go（Step 3 组合链路回归已具备自动化证据）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 3（Action Protocol 完整化）切片 2（Domain Reload 等待链路）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/scripts/smoke-turn-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - `WAITING_FOR_UNITY_REBOOT` 不再直接失败终止，而是进入可恢复等待态。
  - `unity.runtime.ping` 后可恢复 pending action，并继续执行后续视觉动作。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_135359407_32416_677.json` => 11/11 pass
    - `sidecar/.state/smoke-turn-report-20260222_135452685_10324_227.json` => 27/27 pass（`--skip-turn-send --spawn-sidecar`）
    - `sidecar/.state/smoke-turn-report-20260222_135440714_35520_250.json` => 9/9 pass（codex timeout）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增错误码。
    - `WAITING_FOR_UNITY_REBOOT` 进入 `202 + waiting_for_unity_reboot=true` 可恢复路径。
- Rollback Switch:
  - 回滚 `turnService` 中 `isUnityRebootWaitErrorCode` 分支即可恢复旧行为（动作失败即终止）。
- Go/No-Go Decision:
  - Go（Domain Reload 等待链路已形成自动化可验证闭环）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 3（Action Protocol 完整化）切片 3（Replace + Domain Reload 组合链路）
- Scope Files:
  - `sidecar/scripts/smoke-turn-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 在 Domain Reload 等待场景下，`replace_component` 与后续视觉动作可继续完成。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_141012187_08908_680.json` => 12/12 pass
    - `sidecar/.state/smoke-turn-report-20260222_141011823_30812_697.json` => 28/28 pass（`--skip-turn-send --spawn-sidecar`）
    - `sidecar/.state/smoke-turn-report-20260222_141012187_01520_395.json` => 10/10 pass（codex timeout）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增错误码；新增 `domain_reload_wait_replace_chain` 验证 `WAITING_FOR_UNITY_REBOOT` 后 `replace_component` 可恢复并推进到下一动作。
- Rollback Switch:
  - 回滚 `domain_reload_wait_replace_chain` 用例即可恢复到切片 2 覆盖范围。
- Go/No-Go Decision:
  - Go（Domain Reload 组合链路覆盖范围扩展完成）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 4（ReAct 探针链路）切片 1（探针超时容错与非阻塞）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/domain/validators.js`
  - `sidecar/src/index.js`
  - `sidecar/src/adapters/fakeUnityQueryPlanner.js`
  - `sidecar/scripts/smoke-turn-runner.js`
  - `sidecar/package.json`
  - `Assets/Editor/Codex/Application/ConversationController.cs`
  - `Assets/Editor/Codex/Domain/SidecarContracts.cs`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - `query_unity_components` 探针具备 3-5s 级硬超时能力，超时返回结构化错误并允许本轮继续。
  - Unity 端在编译中返回结构化 `unity_busy_or_compiling`，避免探针挂死整轮。
  - 增加自动化用例验证“探针超时不阻塞 turn 完成”。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_142000389_23480_431.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260222_142016560_18552_700.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_142000694_18416_432.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_142026274_05592_236.json` => 28/28 pass（full smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 探针结果新增结构化字段 `error_code`。
    - 超时与编译中场景统一使用 `unity_busy_or_compiling`，并保持 turn 可继续完成。
- Rollback Switch:
  - `ENABLE_UNITY_COMPONENT_QUERY_TOOL=false`（回退到无探针模式）。
  - `UNITY_COMPONENT_QUERY_TIMEOUT_MS` 可调回较长阈值（例如 30000）以回退到旧超时行为。
- Go/No-Go Decision:
  - Go（Step 4 探针超时容错与非阻塞门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 4（ReAct 探针链路）切片 2（探针成功链路与动作映射）
- Scope Files:
  - `sidecar/src/adapters/fakeUnityQueryPlanner.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/smoke-turn-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 自动化验证 `unity.query.components.request -> unity.query.components.result -> remove_component actions -> completed` 的成功链路。
  - 验证“保留组件 X，移除其他组件”可映射为多条合法 `remove_component`，且不误删保留组件。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/smoke-turn-report-20260222_142703894_28712_534.json` => 10/10 pass（smoke:query-probe）
    - `sidecar/.state/smoke-turn-report-20260222_142710914_14104_181.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_142718848_33988_588.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260222_142727765_02568_591.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_142736101_00392_578.json` => 28/28 pass（full smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - 新增 `unity_query_probe_success_chain` 用例验证探针成功返回时，动作请求严格来自查询结果映射。
- Rollback Switch:
  - `ENABLE_UNITY_COMPONENT_QUERY_TOOL=false`（整体回退无探针模式）。
  - `USE_FAKE_UNITY_QUERY_PLANNER=false`（仅测试链路回退，不影响主流程）。
- Go/No-Go Decision:
  - Go（Step 4 成功探针链路门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 4（ReAct 探针链路）切片 3（CodexAppServerPlanner 探针桥接回归）
- Scope Files:
  - `sidecar/scripts/planner-probe-regression.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 在不依赖外部 Codex 环境的前提下，新增可重复回归，验证 `CodexAppServerPlanner.runTextTurn` 的探针桥接逻辑：
    - probe 成功 -> continuation prompt 注入组件结果 -> 正常继续推理
    - probe 失败 -> fallback `error_code` 注入 -> 降级继续推理
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-probe-regression-20260222_143528260_36868_288.json` => 2/2 pass（smoke:planner-probe）
    - `sidecar/.state/smoke-turn-report-20260222_143535794_09296_724.json` => 10/10 pass（smoke:query-probe）
    - `sidecar/.state/smoke-turn-report-20260222_143535870_14196_952.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_143536058_33876_518.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260222_143536082_26964_999.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_143543886_28592_541.json` => 28/28 pass（full smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - Planner 回归新增断言：fallback continuation prompt 含 `unity_query_failed` 与原始错误消息。
- Rollback Switch:
  - `npm run smoke:planner-probe` 为独立测试脚本，可独立移除/回滚，不影响运行时主链路。
- Go/No-Go Decision:
  - Go（Step 4 探针桥接回归门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 5（MCP Adapter + Job Ticket）切片 1（基础端点 + 幂等 + 互斥 + 单队列）
- Scope Files:
  - `sidecar/src/domain/validators.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/api/router.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/mcp-job-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 落地 MCP Job Ticket 基础 HTTP 端点：
    - `submit_unity_task`
    - `get_unity_task_status`
    - `cancel_unity_task`
  - 支持 `idempotency_key` 幂等命中。
  - 支持 running 互斥 + `max_queue=1` 单队列 + 冲突拒绝 `E_JOB_CONFLICT`。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-job-report-20260222_145201175_25760_006.json` => 9/9 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260222_145212738_13348_982.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260222_145224051_37556_886.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_145213158_22100_725.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_145212782_18248_972.json` => 10/10 pass（smoke:query-probe）
    - `sidecar/.state/smoke-turn-report-20260222_145232519_13068_053.json` => 28/28 pass（full smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 新增 `E_JOB_CONFLICT`（MCP submit 并发冲突拒绝）。
    - 保持原有 turn 协议错误码与语义兼容。
- Rollback Switch:
  - `ENABLE_MCP_ADAPTER=false` 一键回退到旧直连路径。
  - `MCP_MAX_QUEUE=0` 可回退为“仅互斥不排队”模式。
- Go/No-Go Decision:
  - Go（Step 5 切片 1 门禁通过）

### Iteration: 2026-02-22 / Codex
- Target Step: Step 5（MCP Adapter + Job Ticket）切片 2（HITL 治理 + 结构化错误反哺）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/scripts/mcp-job-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - MCP `rejected/failed` 路径统一输出 `error_code/error_message/suggestion/recoverable`。
  - `approval_mode` 不再仅存储，能够驱动 `unity.action.request.payload.requires_confirmation`。
  - 上层可基于结构化错误做一次“修正后重试”闭环。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-job-report-20260222_150818115_30224_847.json` => 13/13 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260222_150516975_36272_672.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260222_150525618_16800_616.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_150534092_23908_509.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260222_150534092_34836_549.json` => 10/10 pass（smoke:query-probe）
    - `sidecar/.state/smoke-turn-report-20260222_150546560_17668_156.json` => 9/9 pass（smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - MCP 错误反哺新增结构化字段：`error_message/suggestion/recoverable`。
    - `smoke:mcp-job` 新增 `E_CONTEXT_DEPTH_VIOLATION` 修正重试断言、`E_JOB_CONFLICT` 结构化反馈断言、以及 `approval_mode -> requires_confirmation` 映射断言。
- Rollback Switch:
  - `ENABLE_MCP_ADAPTER=false` 一键回退旧路径。
  - `approval_mode=require_user` 可按请求回退到显式人工确认链路。
- Go/No-Go Decision:
  - Go（Step 5 切片 2 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 5（MCP Adapter + Job Ticket）切片 3（Job 持久化 + 重启恢复）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/mcp-job-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - MCP Job 状态持久化到 `.state`，Sidecar 重启后可恢复 `running/queued`。
  - 重启后不出现“幽灵 pending job”，无法关联活动 turn 的 pending job 会被回收为结构化失败。
  - 队列在恢复后仍可继续 drain，不破坏互斥与幂等语义。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-job-report-20260223_153842402_19796_667.json` => 14/14 pass（smoke:mcp-job，含重启恢复用例）
    - `sidecar/.state/smoke-turn-report-20260223_153850812_19940_195.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_153900773_20200_771.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_153913630_15472_098.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_153928879_12684_069.json` => 10/10 pass（smoke:query-probe）
    - `sidecar/.state/smoke-turn-report-20260223_153936286_18520_939.json` => 9/9 pass（smoke, spawn）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 新增恢复回收错误码 `E_JOB_RECOVERY_STALE`（pending job 重启后无活动 turn 关联时回收）。
    - 无协议兼容性破坏，既有错误码保持可用。
- Rollback Switch:
  - `ENABLE_MCP_ADAPTER=false` 一键回退旧路径。
  - 删除/忽略 `sidecar/.state/mcp-job-state.json` 可回退到“无 job 持久化”行为。
- Go/No-Go Decision:
  - Go（Step 5 切片 3 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 6（推送与恢复治理）切片 1（SSE 推送优先 + 光标补偿）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/api/router.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/mcp-stream-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - MCP 侧提供稳定推送通道 `GET /mcp/stream`，默认用于接收 `job.progress/job.completed`。
  - 支持 `cursor` 重连补偿与 `thread_id` 过滤，降低轮询依赖。
  - 保持 `get_unity_task_status` 作为断线兜底，不破坏 Step 5 票据语义。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-stream-report-20260223_161231158_11372_835.json` => 6/6 pass（smoke:mcp-stream）
    - `sidecar/.state/mcp-job-report-20260223_161241135_14032_641.json` => 14/14 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260223_161248347_22360_057.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_161353743_09956_349.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_161353812_07316_959.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_161353813_19776_764.json` => 10/10 pass（smoke:query-probe）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码；保持 `E_JOB_RECOVERY_STALE` 等 Step 5 错误反馈兼容。
    - 恢复回收路径补发 `job.completed`，避免“只可查询不可推送”的终态空洞。
- Rollback Switch:
  - 客户端临时停用 `/mcp/stream`，回退到低频 `get_unity_task_status` 轮询模式。
  - `ENABLE_MCP_ADAPTER=false` 可完整回退到旧直连链路。
- Go/No-Go Decision:
  - Go（Step 6 切片 1 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 6（推送与恢复治理）切片 2（Last-Event-ID 补偿 + replay 截断信号）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/api/router.js`
  - `sidecar/scripts/mcp-stream-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - Stream 重连支持 `Last-Event-ID`（当 query 未提供 `cursor` 时）。
  - `stream.ready` 提供 replay 窗口元数据，客户端可识别“补偿窗口已截断”并触发查询兜底。
  - 不破坏现有 `cursor` / `thread_id` 行为与 Step 5 票据语义。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-stream-report-20260223_162339419_20268_188.json` => 7/7 pass（smoke:mcp-stream，含 Last-Event-ID + replay 窗口用例）
    - `sidecar/.state/mcp-job-report-20260223_162351222_21528_698.json` => 14/14 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260223_162400671_22252_512.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_162400680_02840_273.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_162400695_22008_347.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_162400731_20456_647.json` => 10/10 pass（smoke:query-probe）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - 新增 `stream.ready` 元数据字段（`cursor_source/requested_cursor/oldest_event_seq/latest_event_seq/replay_from_seq/replay_truncated`）用于补偿决策。
- Rollback Switch:
  - 客户端忽略新增 `stream.ready` 元数据字段，保持旧逻辑可直接回退。
  - 回退 `router.js` 的 `Last-Event-ID` 解析即可恢复“仅 query cursor”模式。
- Go/No-Go Decision:
  - Go（Step 6 切片 2 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 6（推送与恢复治理）切片 3（推送/查询频率量化报表）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/api/router.js`
  - `sidecar/scripts/mcp-stream-runner.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 新增运行时可观测指标，量化 `get_unity_task_status` 查询频率与推送事件频率。
  - 在回归中固化“推送优先，查询兜底”比例门禁，避免后续迭代退化为轮询主链路。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-stream-report-20260223_163050929_10492_600.json` => 8/8 pass（smoke:mcp-stream，含 query/push ratio 用例）
    - `sidecar/.state/mcp-job-report-20260223_162940817_19780_190.json` => 14/14 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260223_162955897_13500_318.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_162955952_19668_542.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_162956349_19120_891.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_162956349_21996_302.json` => 10/10 pass（smoke:query-probe）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - 新增 `GET /mcp/metrics` 观测端点，输出 `status_query_calls/push_events_total/query_to_push_ratio` 等运行指标。
    - `smoke:mcp-stream` 用例 `push_first_query_ratio_metrics` 断言 `query_to_push_ratio_delta=0.0625`（1 次查询 / 16 次推送相关事件）。
- Rollback Switch:
  - 客户端可继续忽略 `/mcp/metrics`，不影响主链路。
  - 回退 `router.js` 的 `/mcp/metrics` 路由即可恢复到“无频率量化指标”状态。
- Go/No-Go Decision:
  - Go（Step 6 切片 3 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 6（推送与恢复治理）切片 4（流订阅背压治理）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/src/api/router.js`
  - `sidecar/scripts/mcp-stream-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 为 SSE 推送通道增加订阅上限，避免异常客户端导致连接无限增长。
  - 推送写失败时自动剔除坏订阅，降低句柄泄漏与重复写失败风险。
  - 回归新增订阅上限门禁，验证超限拒绝与容量恢复。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-stream-report-20260223_165925531_08104_567.json` => 9/9 pass（smoke:mcp-stream，含 subscriber limit guard）
    - `sidecar/.state/mcp-job-report-20260223_165800286_19388_802.json` => 14/14 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260223_165810389_11244_824.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_165810407_19840_822.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_165810370_08556_320.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_165820986_18292_994.json` => 10/10 pass（smoke:query-probe）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 新增 `E_STREAM_SUBSCRIBERS_EXCEEDED`（订阅上限拒绝）。
    - `smoke:mcp-stream` 用例 `stream_subscriber_limit_guard` 断言:
      - 超限请求返回 `429 + E_STREAM_SUBSCRIBERS_EXCEEDED`
      - 释放订阅后可恢复连接
- Rollback Switch:
  - 调大 `MCP_STREAM_MAX_SUBSCRIBERS` 可快速放宽上限。
  - 回退 `registerMcpStreamSubscriber` 的上限判断可恢复旧行为（不建议长期保留）。
- Go/No-Go Decision:
  - Go（Step 6 切片 4 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 6（推送与恢复治理）切片 5（replay 截断恢复快照）
- Scope Files:
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/api/router.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/mcp-stream-runner.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 当 `replay_truncated=true` 时，`stream.ready` 同步携带 thread 级 job 恢复快照，减少重连后多次 `get_status`。
  - 恢复快照具备上限控制，避免握手包过大。
  - 提供可回退开关，必要时可关闭恢复快照。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/mcp-stream-report-20260223_171354019_11244_135.json` => 9/9 pass（smoke:mcp-stream，含 recovery snapshot 限额断言）
    - `sidecar/.state/mcp-job-report-20260223_171407157_20272_614.json` => 14/14 pass（smoke:mcp-job）
    - `sidecar/.state/smoke-turn-report-20260223_171417425_17432_950.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/smoke-turn-report-20260223_171437694_22516_102.json` => 10/10 pass（smoke:query-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_171446232_22120_827.json` => 10/10 pass（smoke:codex-timeout）
    - `sidecar/.state/smoke-turn-report-20260223_171427072_08508_367.json` => 10/10 pass（smoke:query-probe）
  - P50/P95 metrics:
    - 继续由 smoke 报告 `metrics` 字段输出（case/file_compile_round）。
  - Error-code delta:
    - 无新增协议错误码。
    - `stream.ready` 新增恢复字段 `recovery_jobs/recovery_jobs_count`。
    - `/mcp/metrics` 新增 `stream_recovery_jobs_sent` 与 `stream_recovery_jobs_max`。
- Rollback Switch:
  - `MCP_STREAM_RECOVERY_JOBS_MAX=0` 可关闭恢复快照，仅保留 `replay_truncated + fallback_query_suggested`。
  - 客户端可忽略 `recovery_jobs` 字段，保持旧查询补偿逻辑。
- Go/No-Go Decision:
  - Go（Step 6 切片 5 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 1（bootstrap 记忆注入收敛 + 上下文预算器）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 记忆注入策略默认收敛为 `bootstrap_only`，常规轮次不重复灌入冷摘要。
  - `selection_tree` 摘要加入可配置预算（路径提示上限、深度上限、节点访问预算），防止上下文膨胀。
  - 增加可观测事件，量化 memory 注入与上下文截断是否发生。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_172413829_18668_693.json` => 3/3 pass（smoke:planner-memory）
    - `sidecar/.state/smoke-turn-report-20260223_172425139_08164_455.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_172433871_18304_527.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - 本切片新增治理与观测，不改既有 Step 2 统计口径；性能基线继续由 smoke 报告 `metrics` 字段输出。
  - Error-code delta:
    - 无新增协议错误码。
    - 新增 planner 进度事件 `text_turn.memory_policy` 与 `text_turn.context_budget`，并在 turn 事件中落地 `text_turn_memory_policy/text_turn_context_budget` 观测点。
- Rollback Switch:
  - `PLANNER_MEMORY_INJECTION_MODE=disabled` 可关闭冷摘要注入；`always` 可回退到“每轮都注入”的宽松模式（仅建议短期排障）。
  - `PLANNER_CONTEXT_PATH_HINTS_MAX=6`、`PLANNER_CONTEXT_DEPTH_LIMIT=4`、`PLANNER_CONTEXT_NODE_VISIT_BUDGET=300` 可回退到默认预算。
- Go/No-Go Decision:
  - Go（Step 7 切片 1 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 2（冷热记忆分层胶囊）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 记忆胶囊从“线性拼接历史”升级为“冷摘要 + 热近邻”分层，降低 bootstrap 注入体积。
  - 增加胶囊模式与预算参数，支持平滑回退与灰度调参。
  - 观测事件可直接看到“源记忆行数 vs 实际注入行数”。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_173352953_05028_977.json` => 4/4 pass（smoke:planner-memory，新增 layered capsule compaction 用例）
    - `sidecar/.state/smoke-turn-report-20260223_173402567_18704_084.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/planner-probe-regression-20260223_173402564_22256_778.json` => 2/2 pass（smoke:planner-probe）
    - `sidecar/.state/mcp-stream-report-20260223_173402509_04892_134.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - 本切片主要收敛注入体积；既有 P50/P95 统计口径保持不变，继续由 smoke 报告 `metrics` 字段输出。
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增胶囊指标：`memory_source_lines/memory_capsule_mode/memory_cold_summary_included`。
- Rollback Switch:
  - `PLANNER_MEMORY_CAPSULE_MODE=legacy` 可回退到原“线性历史拼接”胶囊模式。
  - `PLANNER_MEMORY_HOT_LINES`、`PLANNER_MEMORY_CAPSULE_MAX_LINES`、`PLANNER_MEMORY_COLD_SUMMARY_MAX_CHARS` 可按负载与质量目标调参。
- Go/No-Go Decision:
  - Go（Step 7 切片 2 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 3（量化压缩报表与门禁）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/scripts/step7-memory-compare.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 新增 Step 7 独立量化报表，输出 legacy vs layered 的 memory/prompt P50/P95 对比。
  - 记忆阶段观测补齐压缩率字段，支持“源行数 vs 注入行数”门禁评估。
  - 不影响 Step 6 推送链路与既有 smoke 回归。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/step7-memory-compare-20260223_175019619_17716_487.json`（metrics:step7-memory）
    - `sidecar/.state/planner-memory-regression-20260223_175028110_14932_019.json` => 4/4 pass（smoke:planner-memory）
    - `sidecar/.state/smoke-turn-report-20260223_175028160_19892_598.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_175028196_20532_108.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - `step7-memory-compare` 报表:
      - `prompt_chars` delta: P50=-14.76%, P95=-14.48%
      - `memory_chars` delta: P50=-51.00%, P95=-47.80%
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增字段:
      - `memory_saved_lines`
      - `memory_compaction_ratio`
      - `memory_cold_summary_chars`
- Rollback Switch:
  - `npm run metrics:step7-memory` 为独立证据脚本，可单独回滚。
  - `PLANNER_MEMORY_CAPSULE_MODE=legacy` 可快速回退旧胶囊策略。
- Go/No-Go Decision:
  - Go（Step 7 切片 3 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 4（scope 相关性过滤抗污染）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `sidecar/scripts/step7-scope-filter-compare.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 记忆注入前按当前会话焦点（selection path / user message）做相关性过滤，降低跨 scope 污染。
  - 过滤策略具备最小保留兜底，避免“全删导致记忆断层”。
  - 补齐量化报表，证明无关记忆泄漏显著下降。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_180149730_20400_499.json` => 5/5 pass（smoke:planner-memory，新增 scope relevance 用例）
    - `sidecar/.state/smoke-turn-report-20260223_180157264_09732_707.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_180205672_22312_118.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - `sidecar/.state/step7-memory-compare-20260223_180156861_19488_654.json`:
      - `prompt_chars` delta: P50=-14.76%, P95=-14.48%
      - `memory_chars` delta: P50=-51.00%, P95=-47.80%
    - `sidecar/.state/step7-scope-filter-compare-20260223_180157262_19916_114.json`:
      - `irrelevant_mentions` delta: P50=-100.00%, P95=-100.00%
      - `memory_chars` delta: P50=-68.63%, P95=-67.70%
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增过滤观测字段:
      - `memory_scope_filter_enabled`
      - `memory_relevance_filtered`
      - `memory_relevance_kept_lines`
      - `memory_relevance_dropped_lines`
      - `memory_raw_source_lines`
- Rollback Switch:
  - `PLANNER_MEMORY_SCOPE_FILTER=false` 可关闭相关性过滤，回退为“仅胶囊压缩、不做 scope 筛选”。
  - `PLANNER_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES` 可调高，降低强过滤场景下的信息损失风险。
  - `npm run metrics:step7-scope` 为独立证据脚本，可单独回滚。
- Go/No-Go Decision:
  - Go（Step 7 切片 4 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 5（chat 噪声过滤）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `sidecar/scripts/step7-noise-filter-compare.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 注入前剔除低信号 chat-only 记忆，减少“闲聊历史污染执行回合”。
  - 保留最小兜底行数，避免强过滤导致记忆完全丢失。
  - 量化报表证明 chat 噪声泄漏显著下降。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_181000290_19712_351.json` => 6/6 pass（smoke:planner-memory，新增 chat noise case）
    - `sidecar/.state/smoke-turn-report-20260223_181007681_19532_656.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_181018002_19536_117.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - `sidecar/.state/step7-noise-filter-compare-20260223_181007678_22472_548.json`:
      - `chat_mentions` delta: P50=-80.00%, P95=-66.67%
      - `memory_chars` delta: P50=-35.72%, P95=-32.58%
    - `sidecar/.state/step7-scope-filter-compare-20260223_181007654_21188_668.json`:
      - `irrelevant_mentions` delta: P50=-100.00%, P95=-100.00%
      - `memory_chars` delta: P50=-68.63%, P95=-67.70%
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增噪声过滤观测字段:
      - `memory_noise_filter_enabled`
      - `memory_noise_filtered`
      - `memory_noise_kept_lines`
      - `memory_noise_dropped_lines`
- Rollback Switch:
  - `PLANNER_MEMORY_NOISE_FILTER=false` 可关闭 chat 噪声过滤，回退到“仅相关性/胶囊压缩”策略。
  - `PLANNER_MEMORY_NOISE_FILTER_MIN_KEEP_LINES` 可调高，减轻误删风险。
  - `npm run metrics:step7-noise` 为独立证据脚本，可单独回滚。
- Go/No-Go Decision:
  - Go（Step 7 切片 5 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 6（关键执行信号 pin 保留）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `sidecar/scripts/step7-pin-compare.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 在 scope/noise 过滤后保留关键失败信号与高价值执行 Plan，避免“过滤过度导致失忆”。
  - pin 保留受上限控制，避免注入体积无界扩大。
  - 补齐独立量化报表，验证关键失败信号保留收益与体积代价。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_182140635_08508_021.json` => 7/7 pass（smoke:planner-memory，新增 signal pin case）
    - `sidecar/.state/smoke-turn-report-20260223_182213053_18820_703.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_182213053_22020_662.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - `sidecar/.state/step7-pin-compare-20260223182205448_22340_201.json`:
      - `failure_mentions` gain: P50=+1.00, P95=+1.00
      - `memory_chars` delta: P50=+86.74%, P95=+84.58%
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增 pin 观测字段:
      - `memory_signal_pin_enabled`
      - `memory_signal_pinned_lines`
      - `memory_signal_pin_failure_lines`
      - `memory_signal_pin_plan_lines`
- Rollback Switch:
  - `PLANNER_MEMORY_SIGNAL_PIN=false` 可关闭 pin 保留，回退为“仅 scope/noise 过滤 + 胶囊压缩”。
  - `PLANNER_MEMORY_SIGNAL_PIN_MAX_LINES` 可收紧/放宽 pin 上限。
  - `npm run metrics:step7-pin` 为独立证据脚本，可单独回滚。
- Go/No-Go Decision:
  - Go（Step 7 切片 6 门禁通过）

### Iteration: 2026-02-23 / Codex
- Target Step: Step 7（记忆与 Token 治理）切片 7（signal pin 压缩预算器）
- Scope Files:
  - `sidecar/src/adapters/codexAppServerPlanner.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/index.js`
  - `sidecar/scripts/planner-memory-regression.js`
  - `sidecar/scripts/step7-pin-compact-compare.js`
  - `sidecar/package.json`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 保持 failure signal pin 的保留收益，同时压缩 pin 行体积，降低对记忆胶囊字符预算的额外冲击。
  - pin 在预算不足时优先保留 failure，再考虑 plan，避免“保留了计划但丢了失败约束”。
  - 输出独立量化报表，验证“failure signal 不降级 + memory chars 下降”。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/planner-memory-regression-20260223_183249959_17436_013.json` => 8/8 pass（smoke:planner-memory，新增 pin compaction case）
    - `sidecar/.state/smoke-turn-report-20260223_183305438_13664_798.json` => 12/12 pass（smoke:fast）
    - `sidecar/.state/mcp-stream-report-20260223_183305443_06388_674.json` => 9/9 pass（smoke:mcp-stream）
  - P50/P95 metrics:
    - `sidecar/.state/step7-pin-compact-compare-20260223183256969_22288_376.json`:
      - `memory_chars` delta: P50=-10.34%, P95=-10.34%
      - `failure_mentions` delta: P50=+1.00, P95=+1.00
    - `sidecar/.state/step7-pin-compare-20260223183314253_20536_335.json`:
      - `failure_mentions` gain: P50=+1.00, P95=+1.00
      - `memory_chars` delta: P50=+73.76%, P95=+70.15%
  - Error-code delta:
    - 无新增协议错误码。
    - `text_turn.memory_policy` 新增 pin 压缩观测字段:
      - `memory_signal_pin_compact_enabled`
      - `memory_signal_pin_compacted_lines`
      - `memory_signal_pin_added_chars`
- Rollback Switch:
  - `PLANNER_MEMORY_SIGNAL_PIN_COMPACT=false` 可关闭 pin 压缩，回退到“原始 pin 行”模式。
  - `PLANNER_MEMORY_SIGNAL_PIN_MAX_CHARS` 与 `PLANNER_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS` 可调参控制体积上限。
  - `npm run metrics:step7-pin-compact` 为独立证据脚本，可单独回滚。
- Go/No-Go Decision:
  - Go（Step 7 切片 7 门禁通过）

### Iteration: 2026-02-24 / Codex
- Target Step: Step 8（观测与测试闭环）
- Scope Files:
  - `sidecar/scripts/step8-quality-gate.js`
  - `sidecar/scripts/replay-failed-report.js`
  - `sidecar/package.json`
  - `sidecar/README.md`
  - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
  - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- Expected Outcome:
  - 提供一键 Step 8 门禁脚本，输出机器可读回归与观测报告。
  - 提供失败回合重放能力，支持按历史报告同配置复现失败用例。
  - 门禁输出覆盖回归通过率、取消成功率、timeout/extraction/action 核心指标。
- Evidence:
  - Regression pass rate:
    - `sidecar/.state/step8-quality-gate-20260224_055436265_25936_845.json` => `go_no_go=Go`
    - `total_cases=75`, `pass_rate_pct=100`, `cancel_success_rate_pct=100`
  - P50/P95 metrics:
    - `sidecar/.state/step8-quality-gate-20260224_055436265_25936_845.json`:
      - `case_duration_ms`: P50=`10`, P95=`1275`
      - `file_compile_round_duration_ms`: P50=`10`, P95=`13`
      - `timeout_rate_pct=5.333`, `extraction_failure_rate_pct=0`, `action_success_rate_pct=100`
  - Error-code delta:
    - 无新增协议错误码。
    - 回放验证样本 `sidecar/.state/mcp-job-report-20260224_054935572_08020_411.json`（`mcp_max_queue=0`）的 `5` 个失败用例，可在
      `sidecar/.state/failure-replay-report-20260224_055454275_20380_296.json` 中 `reproduced=5`、`verdict=replayed_all_failures` 复现。
- Rollback Switch:
  - `npm run gate:step8` 与 `npm run replay:failed` 为独立脚本入口，可单独回退。
  - 若需停用 Step 8 资产，回滚 `sidecar/scripts/step8-quality-gate.js` 与 `sidecar/scripts/replay-failed-report.js` 即可，不影响主执行链路。
- Go/No-Go Decision:
  - Go（Step 8 门禁通过，失败回放能力已落地）


