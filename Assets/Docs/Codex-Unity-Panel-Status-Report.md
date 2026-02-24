# Codex Unity 面板功能与模块完成度盘点（v2.2）

- 文档版本: v2.2
- 更新时间: 2026-02-24
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

### 3.10 MCP 接入能力已落地（进行中）

1. Job Ticket 端点已落地：`submit_unity_task/get_unity_task_status/cancel_unity_task`。
2. 并发治理已落地：workspace 级互斥 + `idempotency_key` 幂等 + 有界队列。
3. 恢复治理已落地：`running/queued` job 持久化与重启恢复/回收。
4. 推送通道已落地：`GET /mcp/stream`（SSE，支持 `cursor` 重连补偿与 `thread_id` 过滤）。
5. 查询路径继续保留为兜底：`get_unity_task_status` 用于断线补偿与调试。

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

### 8.4 Step 2（Planner/Prompt 轻量化）首轮落地进展

1. 当前结论: 阶段完成（Completed），已补齐 Step 2 的正式量化对比并回填发布证据。
2. 已落地改动:
   - Planner Prompt 模板版本化:
     - 新增 `PLANNER_PROMPT_TEMPLATE` 环境变量（默认 `v2`，可回滚 `v1`）。
     - `v2` 强化 Phase 1 范围收敛与 Phase 2 翻译器职责。
   - Extraction 结构稳健性增强:
     - 提取阶段允许解析“直接 allocation 对象”与“包裹 task_allocation 对象”两种形态。
     - 输出标准化保留 `reasoning_and_plan`，避免信息丢失。
   - Validator 与 Planner Guard 对齐:
     - `task_allocation` 对象要求 `reasoning_and_plan` 非空。
     - 本地校验仍作为最终安全真相，未迁移安全边界到 Prompt。
3. 回滚点:
   - 设置 `PLANNER_PROMPT_TEMPLATE=v1` 可一键回退到旧模板。
   - 新增 `ENABLE_UNITY_COMPONENT_QUERY_TOOL=false` 可一键关闭 `query_unity_components` 探针工具（预备 Step 4 回滚开关）。
4. 回归证据:
   - `sidecar/.state/smoke-turn-report-20260222_125602047_20864_966.json`:
     - `smoke` 结果 `25/25 pass`，Step 0/1 既有回归未受 Step 2 改动影响。
   - `sidecar/.state/smoke-turn-report-20260222_125443562_22484_375.json`:
     - `smoke:fast` 结果 `8/8 pass`，无新增回归失败。
5. 指标报表能力（本轮新增）:
   - 新增 `sidecar/scripts/step2-metrics-compare.js`，可输出 `v1 vs v2` 的量化对比报表。
   - 新增 `npm run metrics:step2` 命令，自动生成:
     - `sidecar/.state/planner-metrics-v1-*.json`
     - `sidecar/.state/planner-metrics-v2-*.json`
     - `sidecar/.state/step2-metrics-compare-*.json`
   - 报表字段覆盖:
     - `TTFT`（P50/P95）
     - `total_tokens`（P50/P95）
     - `extraction_failure_indicator_pct`（P50/P95）与整体失败率
6. 发布证据回填（已完成）:
   - `sidecar/.state/step2-metrics-compare-20260224_045836592_25664_344.json`:
     - `comparable=true`（baseline/candidate 有效轮次均为 `12`）
     - `TTFT`:
       - P50: `10638ms -> 7495ms`（`+29.55%` 改善）
       - P95: `15993ms -> 8339ms`（`+47.86%` 改善）
     - `total_tokens`:
       - P50: `107 -> 149`（`-39.25%` 改善率，表示 token 上升）
       - P95: `190 -> 315`（`-65.79%` 改善率，表示 token 上升）
     - `extraction_failure_rate_pct`:
       - baseline=`0%`, candidate=`0%`（无回归）
   - 结论补充:
     - Step 2 的“正式对比证据链路”已闭环。
     - 当前样本集下 TTFT 改善、提取失败率持平，token 体积上升；后续继续由 Step 7 的记忆与注入治理约束 token 反弹。

### 8.5 Step 3（Action Protocol 完整化）切片进展

1. 当前结论: 进行中（In Progress），已补齐两类组合链路回归（常规链路 + Domain Reload 等待链路）。
2. 本轮新增能力:
   - smoke runner 新增 `rename_visual_chain_round` 用例，覆盖:
     - `rename_file`
     - `compile_pending -> action_confirm_pending`
     - `unity.action.result -> completed`
   - smoke runner 新增 `action_result_mismatch_guard` 用例，覆盖:
     - 错误 `unity.action.result` 被 `409` 拒绝
     - 状态保持在 `action_confirm_pending`
     - 修正回执后可继续完成回合
   - Sidecar 新增 `WAITING_FOR_UNITY_REBOOT` 动作失败语义:
     - 不终止回合，保持 `action_confirm_pending`
     - 标记 `waiting_for_unity_reboot=true`
     - 等待 `unity.runtime.ping` 恢复后继续执行 pending action
   - smoke runner 新增 `domain_reload_wait_chain` 用例，覆盖:
     - `rename_file` 后第一条视觉动作返回 `WAITING_FOR_UNITY_REBOOT`
     - `unity.runtime.ping` 恢复 pending action
     - 后续视觉动作可继续并最终完成
   - smoke runner 新增 `domain_reload_wait_replace_chain` 用例，覆盖:
     - 第一条 `replace_component` 返回 `WAITING_FOR_UNITY_REBOOT`
     - `unity.runtime.ping` 恢复 `replace_component` pending action
     - 第一条替换成功后，第二条 `remove_component` 继续执行并最终完成
3. 回归证据:
   - `sidecar/.state/smoke-turn-report-20260222_141012187_08908_680.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_141011823_30812_697.json`:
     - `smoke`（`--skip-turn-send --spawn-sidecar`）=> `28/28 pass`
   - `sidecar/.state/smoke-turn-report-20260222_141012187_01520_395.json`:
     - `smoke:codex-timeout` => `10/10 pass`
4. 作用:
   - 在进入 MCP 适配前，先保证“文件动作 + 编译门禁 + 视觉动作确认”闭环可自动回归，降低后续接入并发与状态漂移风险。

### 8.6 Step 4（ReAct 探针链路）切片进展

1. 当前结论: 进行中（In Progress），已完成“探针超时容错 + 非阻塞继续”闭环。
2. 本轮新增能力:
   - Sidecar 探针超时改为可配置短超时（默认 `UNITY_COMPONENT_QUERY_TIMEOUT_MS=5000`）。
   - 探针超时时不再抛错终止规划，改为返回结构化结果:
     - `error_code=unity_busy_or_compiling`
     - `error_message=<timeout detail>`
     - `components=[]`
   - Planner 在 `query_unity_components` 失败/超时时继续推理，不阻塞整轮 turn。
   - Unity 查询回包新增 `error_code`，并在编译中返回 `unity_busy_or_compiling`。
   - 新增测试专用 `FakeUnityQueryPlanner` 与回归命令 `npm run smoke:query-timeout`。
3. 回归证据:
   - `sidecar/.state/smoke-turn-report-20260222_142000694_18416_432.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142000389_23480_431.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142016560_18552_700.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142026274_05592_236.json`:
     - `smoke`（`--skip-turn-send --spawn-sidecar`）=> `28/28 pass`
4. 作用:
   - 探针链路从“可能卡死整轮”升级为“短超时可降级继续”，为后续 MCP 推送/票据模式降低阻塞风险。

### 8.7 Step 4（ReAct 探针链路）切片进展（成功探针链路）

1. 当前结论: 进行中（In Progress），已补齐探针成功路径的自动化证据。
2. 本轮新增能力:
   - `FakeUnityQueryPlanner` 新增 `remove_except_keep` 模式，可将查询结果映射为多条 `remove_component`。
   - smoke runner 新增 `unity_query_probe_success_chain` 用例，覆盖:
     - `turn.send`
     - `unity.query.components.request`
     - Unity 回传组件清单
     - Sidecar 产出两条 `remove_component`
     - `unity.action.result` 两次成功后 `completed`
   - 新增回归命令 `npm run smoke:query-probe`。
3. 回归证据:
   - `sidecar/.state/smoke-turn-report-20260222_142703894_28712_534.json`:
     - `smoke:query-probe` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142710914_14104_181.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142718848_33988_588.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142727765_02568_591.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_142736101_00392_578.json`:
     - `smoke`（`--skip-turn-send --spawn-sidecar`）=> `28/28 pass`
4. 作用:
   - 将 Step 4 证据从“只验证失败降级”扩展到“验证成功映射动作”，确保后续接入 MCP 时既能容错也能可靠产生可执行动作。

### 8.8 Step 4（ReAct 探针链路）切片进展（CodexAppServerPlanner 桥接回归）

1. 当前结论: 进行中（In Progress），已补齐 `CodexAppServerPlanner.runTextTurn` 级别探针桥接回归。
2. 本轮新增能力:
   - 新增 `planner-probe-regression` 脚本（`npm run smoke:planner-probe`），不依赖外部 Codex 可用性。
   - 用脚本化 JSON-RPC runner 驱动真实 `CodexAppServerPlanner` 文本阶段，验证两类关键路径:
     - probe 成功时：continuation prompt 注入组件结果并继续推理。
     - probe 失败时：continuation prompt 注入 fallback `error_code` 与错误信息并继续推理。
3. 回归证据:
   - `sidecar/.state/planner-probe-regression-20260222_143528260_36868_288.json`:
     - `smoke:planner-probe` => `2/2 pass`
   - `sidecar/.state/smoke-turn-report-20260222_143535794_09296_724.json`:
     - `smoke:query-probe` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_143535870_14196_952.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_143536058_33876_518.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_143536082_26964_999.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_143543886_28592_541.json`:
     - `smoke`（`--skip-turn-send --spawn-sidecar`）=> `28/28 pass`
4. 作用:
   - 在进入 MCP Adapter 前，把 Step4 的“探针桥接逻辑正确性”从黑盒行为提升为可重复、可断言的自动化资产，降低后续协议演进时的回归风险。

### 8.9 Step 5（MCP Adapter + Job Ticket）切片进展（基础端点）

1. 当前结论: 进行中（In Progress），已落地 MCP Job Ticket 基础端点与并发治理最小闭环。
2. 本轮新增能力:
   - Sidecar 新增 MCP 端点:
     - `POST /mcp/submit_unity_task`
     - `GET /mcp/get_unity_task_status`
     - `POST /mcp/cancel_unity_task`
   - 新增 `idempotency_key` 幂等命中能力（重复提交返回同一 `job_id`）。
   - 新增 running 互斥 + 单队列（`MCP_MAX_QUEUE`，默认 `1`）+ 冲突拒绝 `E_JOB_CONFLICT`。
   - 新增回滚开关 `ENABLE_MCP_ADAPTER`（默认关闭），保证可随时回退旧路径。
   - 新增 `smoke:mcp-job` 自动化脚本，验证 accepted/queued/rejected/cancelled 与队列排空。
3. 回归证据:
   - `sidecar/.state/mcp-job-report-20260222_145201175_25760_006.json`:
     - `smoke:mcp-job` => `9/9 pass`
   - `sidecar/.state/smoke-turn-report-20260222_145212738_13348_982.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_145224051_37556_886.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_145213158_22100_725.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_145212782_18248_972.json`:
     - `smoke:query-probe` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_145232519_13068_053.json`:
     - `smoke`（`--skip-turn-send --spawn-sidecar`）=> `28/28 pass`
4. 作用:
   - 将“Step5 抽象方案”变成可调用接口与可回归资产，为后续推送通道（Step6）和恢复治理提供稳定入口。

### 8.10 Step 5（MCP Adapter + Job Ticket）切片进展（HITL + 结构化错误反哺）

1. 当前结论: 进行中（In Progress），已补齐 Step5 切片 2 的错误反馈与审批治理最小闭环。
2. 本轮新增能力:
   - MCP `submit/get_status/cancel` 的 `rejected/failed` 返回统一结构化字段:
     - `error_code`
     - `error_message`
     - `suggestion`
     - `recoverable`
   - `approval_mode` 从“仅记录”升级为“可执行策略”:
     - `auto` -> `unity.action.request.payload.requires_confirmation=false`
     - `require_user` -> `unity.action.request.payload.requires_confirmation=true`
   - `smoke:mcp-job` 新增两类回归断言:
     - 错误修正重试链路: `E_CONTEXT_DEPTH_VIOLATION`（`max_depth` 修正后可重发）
     - 并发冲突结构化反馈: `E_JOB_CONFLICT`（含 `suggestion/recoverable`）
     - 审批模式映射: `approval_mode=auto/require_user` 对应 `requires_confirmation=false/true`
3. 回归证据:
   - `sidecar/.state/mcp-job-report-20260222_150818115_30224_847.json`:
     - `smoke:mcp-job` => `13/13 pass`
   - `sidecar/.state/smoke-turn-report-20260222_150516975_36272_672.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260222_150525618_16800_616.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_150534092_23908_509.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260222_150534092_34836_549.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: Sidecar 把失败原因规范化为机器可读反馈（错误码 + 可修复性 + 建议），并把审批模式显式映射到执行确认位。
   - 有该步骤: 上层模型能据此自动修正 payload 并重试，且可避免 MCP 默认流程卡死在 `ACTION_CONFIRM_PENDING`。
   - 没该步骤: 失败只能看字符串日志，无法自动闭环重试；审批语义不落地，跨端更容易出现确认死锁。

### 8.11 Step 5（MCP Adapter + Job Ticket）切片进展（Job 持久化 + 重启恢复）

1. 当前结论: 进行中（In Progress），已补齐 MCP Job 的持久化与重启恢复最小闭环。
2. 本轮新增能力:
   - 新增 MCP Job 快照持久化文件:
     - `sidecar/.state/mcp-job-state.json`
   - Sidecar 启动时自动恢复 job 快照:
     - 恢复 `running_job_id`
     - 恢复 `queued_job_ids`
     - 恢复 `idempotency_key -> job_id` 映射
   - 恢复一致性治理:
     - pending job 若无法关联当前活动 turn，回收为 `failed`，错误码 `E_JOB_RECOVERY_STALE`
     - 避免重启后长期“伪 pending / 幽灵运行”状态
   - `smoke:mcp-job` 新增真实重启回归:
     - 构造 `pending + queued`
     - 重启 sidecar
     - 校验两者状态恢复为 `pending/queued`
3. 回归证据:
   - `sidecar/.state/mcp-job-report-20260223_153842402_19796_667.json`:
     - `smoke:mcp-job` => `14/14 pass`（含重启恢复用例）
   - `sidecar/.state/smoke-turn-report-20260223_153850812_19940_195.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_153900773_20200_771.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_153913630_15472_098.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_153928879_12684_069.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: MCP Adapter 将 job 队列与运行锁做快照持久化，重启后按快照恢复并与 Sidecar 真相状态机对账。
   - 有该步骤: 重启后提交方可继续查询同一 `job_id`，队列可续跑，不会丢失并发治理语义。
   - 没该步骤: 重启后 job 视图丢失，客户端只能重提任务，容易造成重复执行与状态漂移。

### 8.12 Step 6（推送与恢复治理）切片进展（SSE 推送优先 + 光标补偿）

1. 当前结论: 进行中（In Progress），已落地推送优先通道并补齐断线补偿回归。
2. 本轮新增能力:
   - 新增 MCP SSE 端点:
     - `GET /mcp/stream`
   - 推送事件类型稳定化:
     - `stream.ready`
     - `job.progress`
     - `job.completed`
   - 支持重连补偿:
     - `cursor` 参数用于只回放增量事件
     - `thread_id` 参数用于单线程事件过滤
   - `TurnService` 内新增推送事件环形缓冲（`MCP_STREAM_MAX_EVENTS`）与订阅管理。
   - 恢复回收路径补齐推送:
     - pending job 被恢复回收为 `E_JOB_RECOVERY_STALE` 时，会同步推送 `job.completed`。
   - 新增回归命令:
     - `npm run smoke:mcp-stream`
3. 回归证据:
   - `sidecar/.state/mcp-stream-report-20260223_161231158_11372_835.json`:
     - `smoke:mcp-stream` => `6/6 pass`
   - `sidecar/.state/mcp-job-report-20260223_161241135_14032_641.json`:
     - `smoke:mcp-job` => `14/14 pass`
   - `sidecar/.state/smoke-turn-report-20260223_161248347_22360_057.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_161353743_09956_349.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_161353812_07316_959.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_161353813_19776_764.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: Sidecar 把 job 状态变化主动推送给上层（SSE），并用 `cursor` 做断线后增量补发；查询只做兜底。
   - 有该步骤: 上层无需高频轮询，延迟更低、token 更省，断线重连后可快速补齐状态。
   - 没该步骤: 只能靠轮询追状态，调用抖动与无效请求明显增加，重连时更容易丢阶段事件。

### 8.13 Step 6（推送与恢复治理）切片进展（Last-Event-ID + replay 截断信号）

1. 当前结论: 进行中（In Progress），已补齐 SSE 重连补偿的协议细节，客户端可识别“补偿窗口不足”场景。
2. 本轮新增能力:
   - `GET /mcp/stream` 支持 `Last-Event-ID`：
     - 当 query 未提供 `cursor` 时，使用 `Last-Event-ID` 作为重连游标。
   - `stream.ready` 新增补偿元数据：
     - `cursor_source`
     - `requested_cursor`
     - `oldest_event_seq`
     - `latest_event_seq`
     - `replay_from_seq`
     - `replay_truncated`
     - `fallback_query_suggested`
   - `TurnService.registerMcpStreamSubscriber` 新增 replay 窗口计算逻辑，能够标记“请求游标早于当前缓存窗口”的截断情况。
   - `smoke:mcp-stream` 新增用例：
     - `reconnect_last_event_id_header_with_window_meta`
3. 回归证据:
   - `sidecar/.state/mcp-stream-report-20260223_162339419_20268_188.json`:
     - `smoke:mcp-stream` => `7/7 pass`
   - `sidecar/.state/mcp-job-report-20260223_162351222_21528_698.json`:
     - `smoke:mcp-job` => `14/14 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162400671_22252_512.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162400680_02840_273.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162400695_22008_347.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162400731_20456_647.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: 服务端在握手时告诉客户端“你请求的游标、当前缓存起止、是否截断”，客户端据此决定“继续靠推送”还是“补一次查询”。
   - 有该步骤: 断线重连更稳，客户端不会误以为拿到了完整 replay；可自动触发补偿查询，降低状态丢失风险。
   - 没该步骤: 即使 replay 已截断，客户端也难以感知，可能在缺失中间事件的情况下继续执行，导致状态判断偏差。

### 8.14 Step 6（推送与恢复治理）切片进展（推送/查询频率量化门禁）

1. 当前结论: 进行中（In Progress），已补齐 Step 6 门禁中的“查询频率相对推送显著下降”量化证据。
2. 本轮新增能力:
   - Sidecar 新增观测端点:
     - `GET /mcp/metrics`
   - 指标字段:
     - `status_query_calls`
     - `stream_connect_calls`
     - `stream_events_published`
     - `stream_events_delivered`
     - `stream_replay_events_sent`
     - `push_events_total`
     - `query_to_push_ratio`
   - `smoke:mcp-stream` 新增用例:
     - `push_first_query_ratio_metrics`
     - 在同一回归里做 1 次 fallback 查询，校验查询/推送比值低于阈值（< 0.35）。
3. 回归证据:
   - `sidecar/.state/mcp-stream-report-20260223_163050929_10492_600.json`:
     - `smoke:mcp-stream` => `8/8 pass`
     - `push_first_query_ratio_metrics`:
       - `status_query_calls_delta=1`
       - `push_events_total_delta=16`
       - `query_to_push_ratio_delta=0.0625`
   - `sidecar/.state/mcp-job-report-20260223_162940817_19780_190.json`:
     - `smoke:mcp-job` => `14/14 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162955897_13500_318.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162955952_19668_542.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162956349_19120_891.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_162956349_21996_302.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: 通过运行时计数器统计“状态查询调用次数”与“推送事件发送次数”，并在回归中固定比值门禁，防止策略退化。
   - 有该步骤: 推送优先策略可持续被量化验证，后续改动若引入轮询回潮会第一时间在回归中暴露。
   - 没该步骤: 即使功能看起来可用，也无法证明是否已经回退成“轮询主导”，风险会累积到线上才暴露。

### 8.15 Step 6（推送与恢复治理）切片进展（流订阅背压治理）

1. 当前结论: 进行中（In Progress），已补齐 SSE 通道的订阅背压与坏订阅清理机制。
2. 本轮新增能力:
   - 新增流订阅上限配置:
     - `MCP_STREAM_MAX_SUBSCRIBERS`（默认 `32`）
   - 超限拒绝语义:
     - `429 + E_STREAM_SUBSCRIBERS_EXCEEDED`
   - 推送写失败治理:
     - 对 `onEvent` 写失败的订阅自动 `delete`，避免坏连接长期驻留。
   - `/mcp/metrics` 新增流稳定性字段:
     - `stream_subscriber_rejects`
     - `stream_subscriber_drops`
     - `stream_max_subscribers`
   - `smoke:mcp-stream` 新增用例:
     - `stream_subscriber_limit_guard`
3. 回归证据:
   - `sidecar/.state/mcp-stream-report-20260223_165925531_08104_567.json`:
     - `smoke:mcp-stream` => `9/9 pass`
     - `stream_subscriber_limit_guard`:
       - 超限返回 `E_STREAM_SUBSCRIBERS_EXCEEDED`
       - 释放订阅后恢复连接成功
   - `sidecar/.state/mcp-job-report-20260223_165800286_19388_802.json`:
     - `smoke:mcp-job` => `14/14 pass`
   - `sidecar/.state/smoke-turn-report-20260223_165810389_11244_824.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_165810407_19840_822.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_165810370_08556_320.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_165820986_18292_994.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: 在注册流订阅时施加硬上限，并在推送失败时清理失效订阅，防止推送层资源被慢客户端或僵尸连接耗尽。
   - 有该步骤: 推送链路在高并发/异常网络下更稳定，拒绝策略可预期且可观测。
   - 没该步骤: 订阅数量可能无界增长，长时间运行后会出现推送抖动、资源泄漏甚至服务不稳定。

### 8.16 Step 6（推送与恢复治理）切片进展（replay 截断恢复快照）

1. 当前结论: 进行中（In Progress），已补齐 replay 截断场景的“推送内恢复快照”，降低重连后查询压力。
2. 本轮新增能力:
   - `stream.ready` 在 `replay_truncated=true` 时附带:
     - `recovery_jobs_count`
     - `recovery_jobs`（thread 级状态快照）
   - 恢复快照上限:
     - `MCP_STREAM_RECOVERY_JOBS_MAX`（默认 `20`）
     - `0` 表示关闭恢复快照（仅保留 query 兜底提示）
   - `/mcp/metrics` 新增:
     - `stream_recovery_jobs_sent`
     - `stream_recovery_jobs_max`
   - `smoke:mcp-stream` 更新断言:
     - replay 截断时 `recovery_jobs_count > 0`
     - `recovery_jobs_count <= mcp_stream_recovery_jobs_max`
3. 回归证据:
   - `sidecar/.state/mcp-stream-report-20260223_171354019_11244_135.json`:
     - `smoke:mcp-stream` => `9/9 pass`
     - `reconnect_last_event_id_header_with_window_meta`:
       - `replay_truncated=true`
       - `recovery_jobs_count=2`（受上限控制）
   - `sidecar/.state/mcp-job-report-20260223_171407157_20272_614.json`:
     - `smoke:mcp-job` => `14/14 pass`
   - `sidecar/.state/smoke-turn-report-20260223_171417425_17432_950.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/smoke-turn-report-20260223_171437694_22516_102.json`:
     - `smoke:query-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_171446232_22120_827.json`:
     - `smoke:codex-timeout` => `10/10 pass`
   - `sidecar/.state/smoke-turn-report-20260223_171427072_08508_367.json`:
     - `smoke:query-probe` => `10/10 pass`
4. 作用:
   - 原理: 当缓存窗口不足以完整 replay 时，服务端在握手阶段主动给出 thread 当前 job 快照，客户端可直接恢复主要状态，再做少量补偿查询。
   - 有该步骤: 重连恢复速度更快，减少“每个 job 都单独 get_status”的额外流量。
   - 没该步骤: replay 截断后只能全量依赖查询补偿，重连成本更高，状态恢复更慢。

### 8.17 Step 7（记忆与 Token 治理）切片进展（bootstrap 注入收敛 + 上下文预算器）

1. 当前结论: 进行中（In Progress），已完成 Step 7 切片 1 的最小闭环，先把“注入时机与上下文规模”纳入可控区间。
2. 本轮新增能力:
   - 记忆注入策略参数化（Planner）:
     - `PLANNER_MEMORY_INJECTION_MODE=bootstrap_only|always|disabled`
     - 默认 `bootstrap_only`：仅在 bootstrap/线程恢复时注入冷摘要，常规轮次不重复注入。
   - 上下文预算器参数化（`selection_tree` 摘要）:
     - `PLANNER_CONTEXT_PATH_HINTS_MAX`（路径提示上限）
     - `PLANNER_CONTEXT_DEPTH_LIMIT`（深度上限）
     - `PLANNER_CONTEXT_NODE_VISIT_BUDGET`（节点访问预算）
   - 新增可观测阶段事件:
     - planner 进度: `text_turn.memory_policy`、`text_turn.context_budget`
     - turn 事件: `text_turn_memory_policy`、`text_turn_context_budget`
   - 新增独立回归脚本:
     - `smoke:planner-memory`
     - 覆盖 bootstrap 注入一次性、禁用注入、上下文截断信号与上限断言。
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_172413829_18668_693.json`:
     - `smoke:planner-memory` => `3/3 pass`
     - 验证点:
       - `bootstrap_memory_injection_once`: 首轮注入、次轮不注入
       - `memory_injection_disabled`: 即使有冷摘要也不注入
       - `context_budget_truncation_signal`: 超大树场景下 `path_hints/max_depth` 受限且 `context_truncated=true`
   - `sidecar/.state/smoke-turn-report-20260223_172425139_08164_455.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_172433871_18304_527.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 把会话上下文拆成“热状态（同线程内自然延续）+ 冷摘要（仅在 bootstrap 兜底注入）”，并在进入 Prompt 前对 `selection_tree` 做深度/节点/路径提示预算裁剪。
   - 有该步骤: token 成本更可控，长会话更不容易被历史噪声污染；线程重建时仍有必要记忆兜底，不丢关键上下文。
   - 没该步骤: 常规轮次容易重复灌入冷摘要导致 token 反弹；`selection_tree` 规模放大时 Prompt 体积不可控，后续稳定性和延迟都会被拉高。

### 8.18 Step 7（记忆与 Token 治理）切片进展（冷热记忆分层胶囊）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 切片 2，把 bootstrap 冷摘要从“线性历史”升级为“冷摘要 + 热近邻”。
2. 本轮新增能力:
   - 记忆胶囊模式参数化:
     - `PLANNER_MEMORY_CAPSULE_MODE=layered|legacy`
     - 默认 `layered`，支持回退 `legacy`。
   - 分层胶囊预算参数:
     - `PLANNER_MEMORY_HOT_LINES`（保留最近热记忆行数）
     - `PLANNER_MEMORY_CAPSULE_MAX_LINES`（胶囊总行数上限）
     - `PLANNER_MEMORY_COLD_SUMMARY_MAX_CHARS`（冷摘要最大字符数）
   - 新增胶囊观测字段:
     - `memory_source_lines`（记忆源行数）
     - `memory_capsule_mode`（当前胶囊模式）
     - `memory_cold_summary_included`（是否包含冷摘要）
   - `smoke:planner-memory` 新增用例:
     - `layered_memory_capsule_compaction`
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_173352953_05028_977.json`:
     - `smoke:planner-memory` => `4/4 pass`
     - `layered_memory_capsule_compaction`:
       - `memory_source_lines=6`
       - `memory_lines=3`
       - `memory_cold_summary_included=true`
   - `sidecar/.state/smoke-turn-report-20260223_173402567_18704_084.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/planner-probe-regression-20260223_173402564_22256_778.json`:
     - `smoke:planner-probe` => `2/2 pass`
   - `sidecar/.state/mcp-stream-report-20260223_173402509_04892_134.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 将较早历史压缩成一条冷摘要（统计 plans/finals/failures 与关键 scope/outcome），再拼接少量最近热记忆，形成固定上限胶囊注入。
   - 有该步骤: bootstrap 恢复时仍保留“历史脉络 + 最近状态”，但注入体积显著收敛，长期会话 token 更稳定。
   - 没该步骤: 冷摘要仍按线性历史拼接，随着会话增长会持续挤占 prompt 预算，导致 token/延迟上升并提高上下文污染风险。

### 8.19 Step 7（记忆与 Token 治理）切片进展（量化压缩报表与门禁）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 的量化证据报表，支持用 P50/P95 对比验证记忆治理收益。
2. 本轮新增能力:
   - 新增量化脚本:
     - `metrics:step7-memory`（`sidecar/scripts/step7-memory-compare.js`）
     - 输出 legacy vs layered 两套数据:
       - `memory_chars`（胶囊字符数）P50/P95
       - `prompt_chars`（Prompt 总字符数）P50/P95
       - 压缩 delta 百分比
   - 记忆观测增强:
     - `text_turn.memory_policy` 新增指标:
       - `memory_saved_lines`
       - `memory_compaction_ratio`
       - `memory_cold_summary_chars`
   - npm 入口:
     - `npm run metrics:step7-memory`
3. 回归证据:
   - `sidecar/.state/step7-memory-compare-20260223_175019619_17716_487.json`:
     - `improved=true`
     - `prompt_chars` delta:
       - P50=`-14.76%`
       - P95=`-14.48%`
     - `memory_chars` delta:
       - P50=`-51.00%`
       - P95=`-47.80%`
   - `sidecar/.state/planner-memory-regression-20260223_175028110_14932_019.json`:
     - `smoke:planner-memory` => `4/4 pass`
   - `sidecar/.state/smoke-turn-report-20260223_175028160_19892_598.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_175028196_20532_108.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 用统一输入样本分别跑 legacy/layered 胶囊构建，统计 memory 与 prompt 体积分布，并给出 P50/P95 差异，作为发布门禁。
   - 有该步骤: Step 7 不再停留在“感觉更省 token”，而是每次迭代都能直接看压缩收益是否保持。
   - 没该步骤: 后续改动可能悄悄放大注入体积，直到线上出现 token/延迟回升才被动发现。

### 8.20 Step 7（记忆与 Token 治理）切片进展（scope 相关性过滤抗污染）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 切片 4，把“记忆压缩”扩展到“记忆相关性筛选”，降低跨对象历史污染。
2. 本轮新增能力:
   - 注入前相关性过滤（Planner）:
     - 基于 `selected_object_path/selected_object_name/scene_path` 与 user message 的 path 提示提取焦点。
     - 仅保留焦点相关记忆行，并保留最小兜底行数（防止全删）。
   - 新增参数:
     - `PLANNER_MEMORY_SCOPE_FILTER=true|false`（默认 `true`）
     - `PLANNER_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES`（默认 `2`）
   - 观测增强:
     - `memory_scope_filter_enabled`
     - `memory_relevance_filtered`
     - `memory_relevance_kept_lines`
     - `memory_relevance_dropped_lines`
     - `memory_raw_source_lines`
   - 新增量化脚本:
     - `metrics:step7-scope`（`sidecar/scripts/step7-scope-filter-compare.js`）
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_180149730_20400_499.json`:
     - `smoke:planner-memory` => `5/5 pass`
     - 新增 `scope_relevance_filter_prefers_current_scope` 用例通过。
   - `sidecar/.state/step7-scope-filter-compare-20260223_180157262_19916_114.json`:
     - `improved=true`
     - `irrelevant_mentions` delta:
       - P50=`-100.00%`
       - P95=`-100.00%`
     - `memory_chars` delta:
       - P50=`-68.63%`
       - P95=`-67.70%`
   - `sidecar/.state/step7-memory-compare-20260223_180156861_19488_654.json`:
     - `improved=true`
     - `prompt_chars` delta P50=`-14.76%`, P95=`-14.48%`
     - `memory_chars` delta P50=`-51.00%`, P95=`-47.80%`
   - `sidecar/.state/smoke-turn-report-20260223_180157264_09732_707.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_180205672_22312_118.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 先按当前焦点做记忆行筛选，再做冷热胶囊压缩，形成“相关性优先 + 体积受控”的双门禁。
   - 有该步骤: 长会话里旧对象/旧场景历史不再频繁污染当前决策，恢复时更聚焦当前目标。
   - 没该步骤: 即使做了胶囊压缩，无关历史仍可能被压缩后带入，导致执行方向偏移和理解噪声。

### 8.21 Step 7（记忆与 Token 治理）切片进展（chat 噪声过滤）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 切片 5，在记忆注入链路新增 chat-only 噪声抑制。
2. 本轮新增能力:
   - 注入前噪声过滤:
     - 识别并剔除 `Plan + Actions=chat` 的低信号记忆行。
     - 保留最小兜底行数，避免强过滤导致“记忆全空”。
   - 新增参数:
     - `PLANNER_MEMORY_NOISE_FILTER=true|false`（默认 `true`）
     - `PLANNER_MEMORY_NOISE_FILTER_MIN_KEEP_LINES`（默认 `2`）
   - 观测增强:
     - `memory_noise_filter_enabled`
     - `memory_noise_filtered`
     - `memory_noise_kept_lines`
     - `memory_noise_dropped_lines`
   - 新增量化脚本:
     - `metrics:step7-noise`（`sidecar/scripts/step7-noise-filter-compare.js`）
   - `smoke:planner-memory` 新增用例:
     - `chat_noise_filter_drops_chat_lines`
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_181000290_19712_351.json`:
     - `smoke:planner-memory` => `6/6 pass`
     - 新增 `chat_noise_filter_drops_chat_lines` 用例通过。
   - `sidecar/.state/step7-noise-filter-compare-20260223_181007678_22472_548.json`:
     - `improved=true`
     - `chat_mentions` delta:
       - P50=`-80.00%`
       - P95=`-66.67%`
     - `memory_chars` delta:
       - P50=`-35.72%`
       - P95=`-32.58%`
   - `sidecar/.state/step7-scope-filter-compare-20260223_181007654_21188_668.json`:
     - `improved=true`
     - `irrelevant_mentions` delta P50/P95=`-100.00%/-100.00%`
   - `sidecar/.state/smoke-turn-report-20260223_181007681_19532_656.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_181018002_19536_117.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 先用噪声规则去掉 chat-only 历史，再进入相关性过滤和胶囊压缩，减少“闲聊历史挤占执行记忆”。
   - 有该步骤: 执行回合更少受聊天内容干扰，记忆预算更多留给高信号执行上下文。
   - 没该步骤: 即使做了压缩与相关性筛选，chat 行仍可能进入胶囊，导致执行场景下理解噪声增加。

### 8.22 Step 7（记忆与 Token 治理）切片进展（关键执行信号 pin 保留）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 切片 6，在强过滤链路下保留关键失败/执行信号，避免“过滤过度导致失忆”。
2. 本轮新增能力:
   - 注入前执行信号 pin（Planner）:
     - 在 chat 噪声过滤 + scope 相关性过滤后，回补关键 `Final` 失败行与可执行 `Plan` 行。
     - pin 过程受上限控制，避免无界膨胀。
   - 新增参数:
     - `PLANNER_MEMORY_SIGNAL_PIN=true|false`（默认 `true`）
     - `PLANNER_MEMORY_SIGNAL_PIN_MAX_LINES`（默认 `2`）
   - 观测增强:
     - `memory_signal_pin_enabled`
     - `memory_signal_pinned_lines`
     - `memory_signal_pin_failure_lines`
     - `memory_signal_pin_plan_lines`
   - 新增量化脚本:
     - `metrics:step7-pin`（`sidecar/scripts/step7-pin-compare.js`）
   - `smoke:planner-memory` 新增用例:
     - `signal_pin_keeps_failure_line_under_scope_filter`
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_182140635_08508_021.json`:
     - `smoke:planner-memory` => `7/7 pass`
     - 新增 `signal_pin_keeps_failure_line_under_scope_filter` 用例通过。
   - `sidecar/.state/step7-pin-compare-20260223182205448_22340_201.json`:
     - `improved=true`
     - `failure_mentions` gain:
       - P50=`+1.00`
       - P95=`+1.00`
     - `memory_chars` delta:
       - P50=`+86.74%`
       - P95=`+84.58%`
   - `sidecar/.state/smoke-turn-report-20260223_182213053_18820_703.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_182213053_22020_662.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 先做噪声与相关性收敛，再以小上限回补关键失败/执行信号，保持“压缩优先 + 关键信息不丢”的双目标。
   - 有该步骤: 当前焦点切换时仍能保留上一轮关键失败线索，减少重复踩坑与错误重试。
   - 没该步骤: 过滤命中较强时可能把关键 `Error/Fail` 历史一起删掉，导致后续规划缺少失败约束、回归风险上升。

### 8.23 Step 7（记忆与 Token 治理）切片进展（signal pin 压缩预算器）

1. 当前结论: 进行中（In Progress），已补齐 Step 7 切片 7，在保留关键失败信号的同时收敛 pin 增量体积。
2. 本轮新增能力:
   - signal pin 压缩预算器（Planner）:
     - failure 信号优先于 plan 信号 pin，避免预算耗尽时丢失失败线索。
     - 支持将长 pin 行压缩为 `PinnedFailure/PinnedPlan` 摘要行，并保留关键字段（如 `Error=...`）。
     - 新增 pin 增量字符预算，限制额外注入体积。
   - 新增参数:
     - `PLANNER_MEMORY_SIGNAL_PIN_COMPACT=true|false`（默认 `true`）
     - `PLANNER_MEMORY_SIGNAL_PIN_MAX_CHARS`（默认 `120`）
     - `PLANNER_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS`（默认 `240`）
   - 观测增强:
     - `memory_signal_pin_compact_enabled`
     - `memory_signal_pin_compacted_lines`
     - `memory_signal_pin_added_chars`
   - 新增量化脚本:
     - `metrics:step7-pin-compact`（`sidecar/scripts/step7-pin-compact-compare.js`）
   - `smoke:planner-memory` 新增用例:
     - `signal_pin_compacts_under_char_budget`
3. 回归证据:
   - `sidecar/.state/planner-memory-regression-20260223_183249959_17436_013.json`:
     - `smoke:planner-memory` => `8/8 pass`
     - 新增 `signal_pin_compacts_under_char_budget` 用例通过。
   - `sidecar/.state/step7-pin-compact-compare-20260223183256969_22288_376.json`:
     - `improved=true`
     - `memory_chars` delta:
       - P50=`-10.34%`
       - P95=`-10.34%`
     - `failure_mentions` delta:
       - P50=`+1.00`
       - P95=`+1.00`
   - `sidecar/.state/step7-pin-compare-20260223183314253_20536_335.json`:
     - `improved=true`
     - `failure_mentions` gain P50/P95=`+1.00/+1.00`
     - `memory_chars` delta P50/P95=`+73.76%/+70.15%`
   - `sidecar/.state/smoke-turn-report-20260223_183305438_13664_798.json`:
     - `smoke:fast` => `12/12 pass`
   - `sidecar/.state/mcp-stream-report-20260223_183305443_06388_674.json`:
     - `smoke:mcp-stream` => `9/9 pass`
4. 作用:
   - 原理: 先保证失败信号 pin，再对长行做摘要压缩并施加字符预算，把“信号保留”与“体积收敛”同时纳入门禁。
   - 有该步骤: 关键失败约束不易丢失，同时降低 pin 对 prompt 体积的副作用。
   - 没该步骤: 仅靠行数上限可能导致长失败行挤占预算，或者在加大 pin 后带来明显 token 回弹。

### 8.24 Step 8（观测与测试闭环）落地进展（质量门禁 + 失败回放）

1. 当前结论: 已完成（Go），Step 8 最小闭环已落地并具备机器可读门禁报告。
2. 本轮新增能力:
   - 新增 Step 8 门禁脚本:
     - `sidecar/scripts/step8-quality-gate.js`
     - 一键执行 smoke/mcp/planner 回归矩阵并输出门禁报告。
   - 新增失败回放脚本:
     - `sidecar/scripts/replay-failed-report.js`
     - 基于历史报告按同配置重放，校验失败用例是否可复现。
   - npm 脚本入口:
     - `npm run gate:step8`
     - `npm run metrics:step8`
     - `npm run replay:failed -- --report <report.json>`
   - 产出指标:
     - 回归通过率（总/通过/失败）
     - 取消成功率（基于回归 cancel 用例）
     - timeout rate / extraction failure rate / action success rate
     - 阶段耗时 P50/P95（优先读取阶段事件，缺失时回退 smoke 报表指标）
3. 回归证据:
   - `sidecar/.state/step8-quality-gate-20260224_055436265_25936_845.json`:
     - `go_no_go=Go`
     - `report_count=8`
     - `total_cases=75`
     - `pass_rate_pct=100`
     - `cancel_success_rate_pct=100`
     - `timeout_rate_pct=5.333`
     - `extraction_failure_rate_pct=0`
     - `action_success_rate_pct=100`
   - `sidecar/.state/mcp-job-report-20260224_054935572_08020_411.json`:
     - 构造 `mcp_max_queue=0` 的失败样本，`5` 个失败用例可用于回放验证。
   - `sidecar/.state/failure-replay-report-20260224_055454275_20380_296.json`:
     - `source_failed=5`
     - `reproduced=5`
     - `verdict=replayed_all_failures`
4. 作用:
   - 原理: 以“矩阵回归 + 机器可读门禁 + 失败回放”构成持续迭代闭环，避免仅靠人工日志排障。
   - 有该步骤: 每次迭代都能用统一报告判断是否可灰度，且关键失败可快速复现。
   - 没该步骤: 故障定位和回归验证高度依赖人工经验，发布风险不可量化。

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






