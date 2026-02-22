# Codex Unity 面板功能与模块完成度盘点（v2.1）

- 文档版本: v2.1
- 更新时间: 2026-02-22
- 适用代码范围: `Assets/Editor/Codex/*`, `sidecar/src/*`
- 目标: 对齐当前真实实现，明确已完成能力、可观测性、剩余风险与下一步

## 1. 总体结论

1. 主链路已从“结构化表单生成器”升级到“自然对话 + 结构化提取”双阶段架构。
2. Sidecar 与 Unity 的职责边界清晰：脚本层在 Sidecar 执行，视觉层在 Unity 原生执行。
3. 超时治理、取消治理、状态持久化、域重载恢复均已形成闭环。
4. 当前最关键的工程重点从“功能打通”转为“稳定性与可观测性持续优化”。

## 2. 当前架构状态

### 2.1 Unity 端

1. UI 层: `CodexChatWindow` 承担输入、日志、按钮状态切换。
2. 应用层: `ConversationController` 负责回合编排、轮询、状态切换。
3. 领域/契约层: `SidecarContracts` 定义 DTO 与事件载荷。
4. 基础设施层: `HttpSidecarGateway`、`SidecarProcessManager`、`UnityVisualActionExecutor`。

### 2.2 Sidecar 端

1. API 层: `router.js` 暴露健康、会话、回合、编译与动作结果接口。
2. 应用层: `turnService.js` 负责主状态机编排与阶段推进。
3. 领域层: `turnStore.js` + `validators.js` 管理状态、超时、安全校验。
4. 适配层: `codexAppServerPlanner.js` 与 `fileActionExecutor.js` 负责模型与执行接入。

## 3. 已完成能力（与当前代码一致）

### 3.1 Planner 双阶段

1. Phase 1 Reasoning: `runTextTurn` 输出自然语言对话与计划。
2. Phase 2 Extraction: `runExtractionTurn` 输出结构化 `task_allocation`。
3. 提取阶段与推理阶段权限隔离:
   - Reasoning 阶段可注入探索工具（`read_file/search_code`）。
   - Extraction 阶段使用 `tool_choice="none"`，并要求 JSON 输出。

### 3.2 流式体验

1. 已使用真实 `chat.delta`/`chat.message` 透传，不再本地模板伪流。
2. Unity 面板可看到连续 token 增量与最终完整消息。

### 3.3 协议与动作能力

1. 文件动作支持: `create_file`、`update_file`、`rename_file`、`delete_file`。
2. 视觉动作支持: `add_component`、`remove_component`、`replace_component`、`create_gameobject`。
3. Extraction 输出已引入 Thought-Before-Action:
   - 可执行轮次 `task_allocation` 必须包含 `reasoning_and_plan`。

### 3.4 本地安全与防越权

1. 文件路径白名单: 仅允许 `Assets/Scripts/AIGenerated/`。
2. 禁止直接操作 Unity 序列化文件: `.unity/.prefab/.asset`。
3. MCP 越权字段拦截: 检测到相关字段直接规划失败。
4. `validators` 与 planner guard 双层校验，执行前拦截非法结构。

### 3.5 Unity 视觉执行容错

1. 组件解析策略升级为“精确优先 + 模糊兜底”。
2. `remove_component`/`replace_component(source)` 支持目标对象上模糊匹配。
3. `add_component`/`replace_component(target)` 支持类型级模糊候选，歧义时拒绝执行。

### 3.6 超时、取消与一致性

1. Codex 超时模型:
   - 软超时: 60s（无进展）
   - 硬超时: 200s（总时长上限）
2. 编译超时: 120s。
3. 超时发生时会触发 AbortController 终止 in-flight 规划请求，避免僵尸请求。
4. `turn.cancel` 会中断当前回合并清理挂起任务。

### 3.7 静默阶段保活

1. Extraction/Finalize 等静默阶段已接入 Keepalive 机制。
2. 通过进度回调触发 `touchCodexHeartbeat`，防止软超时误杀。

### 3.8 可观测性增强

已新增阶段埋点事件:

1. `text_turn_started`
2. `text_turn_completed`（消息含耗时）
3. `extraction_started`
4. `extraction_completed`（消息含耗时）

说明: 下一次超时时，可直接判断卡在第一阶段还是第二阶段。

### 3.9 持久化与跨重启恢复

1. `sidecar/.state/sidecar-state.json` 保存回合状态与事件。
2. `sidecar/.state/codex-session-map.json` 保存会话线程映射与对话记忆胶囊。
3. Unity 重载后通过 `unity.runtime.ping` 参与恢复流程。

### 3.10 MCP 接入设计已对齐（未落地）

1. 已确认采用 `L1 Brain -> MCP Adapter -> Sidecar Kernel -> Unity Executor` 架构，不推翻现有内核。
2. 已确认 Job Ticket 模式：`submit_unity_task/get_unity_task_status/cancel_unity_task`。
3. 已确认传输策略：MCP 主链路使用 `stdio/SSE` 推送，查询仅做断线补偿兜底。
4. 已确认 HITL 策略：新增 `approval_mode`，MCP 默认 `auto`，避免跨端确认死锁。
5. 已确认并发治理：workspace 级全局互斥 + `idempotency_key` 幂等去重 + 有界队列。
6. 已确认恢复策略：`running/queued` job 持久化，Sidecar 重启后恢复或回收。

## 4. 当前默认参数（代码基线）

1. `CODEX_SOFT_TIMEOUT_MS`: 60000
2. `CODEX_HARD_TIMEOUT_MS`: 200000
3. `COMPILE_TIMEOUT_MS`: 120000
4. `MAX_AUTO_FIX_ATTEMPTS`: 1

## 5. 端到端链路（简化）

1. `turn.send` -> `codex_pending(planning)`
2. Phase 1 产生自然语言 + 流式输出
3. Phase 2 结构化提取 `task_allocation`
4. Sidecar 执行 `file_actions`
5. 触发编译门禁，等待 `unity.compile.result`
6. 编译成功后进入视觉动作确认与执行
7. 进入 finalize，输出最终 `turn.completed(phase=final)` 或 `turn.error`

## 6. 已知风险与边界

1. `ConversationController` 与 `turnService` 仍偏大，维护成本高。
2. 提取阶段虽已增强，但复杂任务仍可能出现模型抖动，需要继续优化 Prompt 与监控。
3. 自动修复仍是 MVP 上限（1 次），复杂错误链路恢复能力有限。
4. MCP 接入后若仅使用轮询，存在 token 浪费与工具调用抖动风险。
5. MCP 接入后若不显式控制审批模式，存在 `ACTION_CONFIRM_PENDING` 死锁风险。
6. MCP 接入后若无全局互斥与幂等，存在并发改代码导致编译链路冲突风险。
7. Sidecar 异常重启时，若 job 恢复策略不完整，存在状态不一致风险。

## 7. 下一步建议（按优先级）

1. 启动 Phase 8（MCP Adapter + Job Ticket）：
   - 落地 `submit/get_status/cancel`
   - 增加 `approval_mode`、`idempotency_key`、全局互斥与有界队列
2. 启动 Phase 9（推送与恢复）：
   - 打通 `stdio/SSE` 推送事件
   - 完成断线补偿与 job 持久化恢复
3. 将阶段埋点结果做结构化统计（P50/P95 耗时、超时前最后阶段）。
4. 拆分大控制器：
   - Unity: `ConversationController` -> 编排/状态/执行协调模块化
   - Sidecar: `turnService` -> orchestration + policy + reporting
5. 增加自动化测试:
   - Sidecar 集成测试（schema、超时、取消、回放、互斥/幂等）
   - Unity 编辑器测试（编译门禁、动作执行、重载恢复）

## 8. 重构 Step 门禁审计（2026-02-22）

### 8.1 Step 0（基线冻结）结论

1. 结论: 通过（Go）。
2. 核心证据:
   - `sidecar/.state/smoke-turn-report-20260222_094514782_06820_328.json`
     - 20 轮回归 + 其他基础用例，`25/25 pass`（100%）。
   - `sidecar/.state/smoke-turn-report-20260222_094520196_17588_254.json`
     - 独立端口短超时复现 `E_COMPILE_TIMEOUT`，`8/8 pass`。
   - `sidecar/.state/smoke-turn-report-20260222_094528115_33576_146.json`
     - 独立端口假 planner 复现 `E_CODEX_TIMEOUT`，`6/6 pass`。
3. 新增基线能力:
   - smoke 报告新增 `metrics` 字段（case/file_compile_round 的 P50/P95）。
   - `run_id` 改为“时间+毫秒+pid+随机”，避免报告文件覆盖。
   - timeout 复现场景改为“隔离端口自动拉起 sidecar”，避免因端口占用被误跳过。
4. 当前保留项:
   - 已有 P50/P95 为回归 case 级别；`text/extraction` 阶段级聚合仍待在后续观测项中补齐。

### 8.2 Step 1（执行内核稳定化）结论

1. 结论: 通过（Go）。
2. 核心证据:
   - timeout 清扫路径仍触发 `diag.timeout.abort` + `AbortController.abort()` 清理。
   - `codex_timeout_sweep` 保持 `E_CODEX_TIMEOUT` 且 `has_abort_diagnostic=true`。
   - compile timeout 错误消息改为使用真实 `COMPILE_TIMEOUT_MS` 配置值。
3. 回滚点补齐:
   - 新增环境开关 `ENABLE_TIMEOUT_ABORT_CLEANUP`（默认 `true`）。
   - 设为 `false` 可回退为“仅超时失败，不执行 timeout-abort 清理”。

### 8.3 Step 2 进入条件评估

1. 评估结论: 可进入 Step 2（Planner/Prompt 轻量化）。
2. 前置约束:
   - Step 2 改动必须绑定 token/TTFT 与提取失败率指标。
   - 保持 validators 为最终安全真相，不将安全边界迁移到 Prompt。

## 附录 A: 关键文件索引

1. Unity UI: `Assets/Editor/Codex/UI/CodexChatWindow.cs`
2. Unity 编排: `Assets/Editor/Codex/Application/ConversationController.cs`
3. Unity 视觉执行器: `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
4. 协议 DTO: `Assets/Editor/Codex/Domain/SidecarContracts.cs`
5. Sidecar 编排: `sidecar/src/application/turnService.js`
6. Sidecar 状态机: `sidecar/src/domain/turnStore.js`
7. Sidecar 校验: `sidecar/src/domain/validators.js`
8. Planner 适配: `sidecar/src/adapters/codexAppServerPlanner.js`
9. 文件执行器: `sidecar/src/adapters/fileActionExecutor.js`
10. 运行状态: `sidecar/.state/sidecar-state.json`, `sidecar/.state/codex-session-map.json`

