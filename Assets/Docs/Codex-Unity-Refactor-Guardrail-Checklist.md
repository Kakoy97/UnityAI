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
