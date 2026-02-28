# Codex Unity 全链路重构流程（Roadmap v1）

- 状态: Draft for Execution
- 日期: 2026-02-22
- 适用范围: `Assets/Editor/Codex/*` + `sidecar/src/*` + 未来 MCP 适配层
- 目标: 在不破坏现有 MVP 可用性的前提下，完成从“本地 Sidecar 驱动”到“MCP 可扩展智能系统”的渐进式升级

## 1. 目标定义

1. 保持当前可用链路稳定: 用户输入 -> 规划 -> 文件动作 -> 编译门禁 -> 视觉动作 -> 最终总结。
2. 解决高频问题: 超时误杀、状态不一致、组件解析幻觉、Prompt 过重导致 token 损耗。
3. 引入可演进架构: 为 Cursor/MCP 接入预留标准入口，不推翻现有执行内核。
4. 建立工程化闭环: 观测、测试、回滚、灰度发布、错误码一致性。

## 2. 当前基线（已具备）

1. 双阶段 Planner 已落地: Phase 1 Reasoning + Phase 2 Extraction。
2. Extraction 阶段已做工具隔离并强制 JSON 输出。
3. 文件/视觉动作已扩展并有本地校验和路径白名单。
4. 超时治理已有软硬超时、Keepalive、AbortController 清理。
5. 关键阶段埋点已可见: `text_turn_started/completed`、`extraction_started/completed`。
6. 状态可跨重启恢复: `sidecar/.state/sidecar-state.json`、`sidecar/.state/codex-session-map.json`。

## 3. 目标架构（分层）

```text
L1 Brain (Cursor/Codex)
  -> MCP Adapter Layer (tool schema + job ticket + context APIs)
    -> L2 Sidecar Execution Kernel (state machine + safety + compile gate)
      -> L3 Unity Native Executor (Editor API + scene/component actions)
```

1. L1 负责推理与决策，不直接承载长时执行状态。
2. MCP Adapter 负责协议整形、异步任务票据、状态推送桥接（stdio/SSE 为主，查询为辅）。
3. L2 Sidecar 保留为“强状态执行内核”。
4. L3 Unity 保留为唯一视觉动作执行者，不允许文本改 `.unity/.prefab/.asset`。

## 4. 重构原则（硬约束）

1. 不破坏现有 `turn.error` 与 `turn.completed` 协议兼容性。
2. 所有长耗时链路必须可取消、可超时、可恢复。
3. Prompt 只做能力引导，安全与权限必须由本地代码硬校验兜底。
4. 新能力先加观测再加自动化测试，再进入默认主链路。
5. 不在执行链路引入“黑盒不可解释”分支。

## 5. 分阶段实施计划

## Phase 0: 基线冻结与验收门禁（1-2 天）

1. 冻结当前接口契约与错误码表。
2. 固化回归用例: 闲聊、仅文件、文件+组件、编译失败修复、取消、超时。
3. 建立最小可用压测脚本: 连续 20 轮短指令，统计超时率与平均耗时。

完成标准:

1. 现有主链路回归通过率 >= 95%。
2. 超时场景无僵尸请求。

## Phase 1: 执行内核稳定化（3-5 天）

1. 统一超时策略:
   - Soft timeout: 60s（可按阶段触发心跳续租）
   - Hard timeout: 200s
   - Compile timeout: 120s
2. 所有超时清扫路径强制 `AbortController.abort()`。
3. 完善阶段埋点，记录每阶段耗时与最后心跳时间。
4. 清理死代码: XML 伪工具解析链路、无效兜底分支、冗余调试日志。

完成标准:

1. 超时后后台请求 100% 终止。
2. 日志可明确定位卡在 Text 还是 Extraction 阶段。

## Phase 2: Planner 与 Prompt 轻量化（3-5 天）

1. Phase 1 Prompt 保持“可讨论+可探索”，但限制无关仓库深挖。
2. Phase 2 Prompt 强化“翻译器角色”，只把 Phase 1 意图转成合法 JSON。
3. 保留 Few-shot 输出样例，删除互相冲突的旧 `only ...` 约束。
4. 保持本地 validators 为最终真相来源。

完成标准:

1. 提取 JSON 失败率明显下降。
2. 单轮 token 消耗与 TTFT 明显改善（建议记录 P50/P95）。

## Phase 3: Action Protocol 完整化（4-7 天）

1. 文件动作协议完整支持:
   - `create_file`
   - `update_file`
   - `rename_file`
   - `delete_file`
2. 视觉动作协议完整支持:
   - `add_component`
   - `remove_component`
   - `replace_component`
   - `create_gameobject`
3. Unity 执行层增强:
   - 精确匹配优先，模糊匹配兜底，歧义拒绝执行。
   - Missing Script 可探测、可清理（`UnityEditor.MissingScript` 特殊标识）。

完成标准:

1. 协议动作全集可跑通。
2. 典型重命名/替换组件场景不再因 Missing 残骸误失败。

## Phase 4: ReAct 探针链路（5-8 天）

1. 新增 Reasoning 阶段工具: `query_unity_components`。
2. Sidecar 处理工具调用时:
   - 向 Unity 发 `unity.query.components.request`
   - 等待 `unity.query.components.result`
   - 作为 tool result 回填同一轮上下文并继续推理
3. 关键约束:
   - 仅 Phase 1 允许该工具
   - Phase 2 继续 `tool_choice=none`
4. Unity 查询执行必须调度主线程，避免跨线程访问 Unity API。

完成标准:

1. “删除除 X 外所有脚本”类任务可稳定输出合法多条 `remove_component`。
2. 不再依赖猜测组件名。

## Phase 5: MCP Adapter + Job Ticket（7-12 天）

1. 新增 MCP 入口层，不改动 Sidecar 内核状态机。
2. MCP 传输采用“推送优先”:
   - 优先 `stdio`（本地）或 `SSE/streamable HTTP`（远程）
   - `get_unity_task_status` 仅作兜底，不作为主轮询路径
3. 工具改为异步票据模式:
   - `submit_unity_task`
   - `get_unity_task_status`
   - `cancel_unity_task`
4. 状态语义:
   - `accepted`
   - `rejected`
   - `queued`
   - `pending`
   - `succeeded`
   - `failed`
   - `cancelled`
5. 并发与幂等控制:
   - 全局互斥锁（workspace 级）保证同一时刻仅一个 running job
   - 新请求需带 `idempotency_key`，重复提交直接返回已有 `job_id`
   - 若互斥锁占用且不入队，立即 `rejected` 并返回 `running_job_id`
6. HITL 策略显式化:
   - `approval_mode: "auto" | "require_user"`
   - MCP 默认 `auto`，避免 Cursor 与 Unity 双端确认死锁
7. 恢复与背压:
   - Sidecar 重启后恢复 `running/queued` 任务状态
   - 队列上限可配置（建议 `max_queue=1`），超限立即拒绝
8. Sidecar 继续管理编译门禁、视觉动作执行、自动修复、最终报告。

完成标准:

1. MCP 工具调用不被 Unity 编译长耗时阻塞。
2. Cursor/Codex 侧可稳定收到推送进度，兜底查询仅低频触发。
3. 并发提交不会破坏 Unity 编译链路，重复提交不会重复执行。
4. MCP 模式下不出现 ACTION_CONFIRM_PENDING 死锁。

## Phase 6: 记忆与 Token 治理（4-7 天）

1. 会话记忆分层:
   - 热上下文: 最近 N 轮
   - 冷摘要: 历史回合摘要胶囊
2. 严格注入策略:
   - 仅首轮或跨重启恢复时注入必要摘要
   - 常规轮次不重复灌入全量历史
3. 上下文预算器:
   - 代码上下文按相关度截断
   - selection_tree 深度与节点数量受控

完成标准:

1. 同类任务 token 消耗下降可量化。
2. 长会话无明显上下文污染。

## Phase 7: 可观测性与自动化测试闭环（持续）

1. 指标看板:
   - 每阶段耗时 P50/P95
   - 超时率
   - 取消成功率
   - 提取失败率
   - 动作执行成功率
2. 自动化测试矩阵:
   - Sidecar: schema/validator/timeout/cancel/recovery
   - Unity: compile gate/action executor/missing script/query probe
3. 回放机制: 关键失败回合可重放复现。

完成标准:

1. 故障定位从“猜原因”变为“看阶段指标直达根因”。
2. 每次迭代有可复用回归资产。

## 6. 关键协议草案（MCP 阶段）

### 6.1 submit_unity_task

请求:

```json
{
  "thread_id": "t_001",
  "idempotency_key": "idem_9f5f4c5e",
  "approval_mode": "auto",
  "user_intent": "把 Hello2026 挂到 Scene/Canvas/Image",
  "task_allocation": {
    "reasoning_and_plan": "..."
  }
}
```

响应:

```json
{
  "status": "accepted",
  "job_id": "job_20260222_001",
  "message": "Task accepted. Progress will be pushed through MCP stream."
}
```

并发拒绝示例:

```json
{
  "status": "rejected",
  "reason_code": "E_JOB_CONFLICT",
  "running_job_id": "job_20260222_0009",
  "message": "Another Unity compilation/action is in progress."
}
```

幂等命中示例:

```json
{
  "status": "accepted",
  "job_id": "job_20260222_001",
  "idempotent_replay": true
}
```

### 6.2 get_unity_task_status

响应示例:

```json
{
  "status": "pending",
  "stage": "compile_pending",
  "progress_message": "Waiting for Unity compile result",
  "running_job_id": "job_20260222_001"
}
```

```json
{
  "status": "succeeded",
  "execution_report": {
    "files": ["Assets/Scripts/AIGenerated/Hello2026.cs"],
    "compile_success": true,
    "visual_actions_success": true
  }
}
```

### 6.3 cancel_unity_task

响应示例:

```json
{
  "status": "cancelled",
  "job_id": "job_20260222_001"
}
```

### 6.4 推送事件（stdio/SSE）

事件示例:

```json
{
  "event": "job.progress",
  "job_id": "job_20260222_001",
  "status": "pending",
  "stage": "script_executing",
  "message": "Writing files to Assets/Scripts/AIGenerated"
}
```

```json
{
  "event": "job.completed",
  "job_id": "job_20260222_001",
  "status": "succeeded",
  "execution_report": {
    "compile_success": true,
    "visual_actions_success": true
  }
}
```

说明:

1. MCP 主链路采用推送事件，减少 token 消耗和轮询抖动。
2. `get_unity_task_status` 仅用于客户端重连、补偿查询和调试。

## 7. 风险与对策

1. 风险: MCP 接入后出现双状态机竞争。
   - 对策: MCP 仅做适配，不复制执行状态机，单一真相仍在 Sidecar。
2. 风险: Token 爆炸。
   - 对策: 摘要分层、按需注入、阶段化提示词瘦身。
3. 风险: 长耗时导致体验断裂。
   - 对策: Job Ticket + 推送进度（stdio/SSE）+ 兜底查询。
4. 风险: HITL 死锁（Cursor 发起但 Unity 等待确认）。
   - 对策: `approval_mode` 显式化，MCP 默认 `auto`。
5. 风险: 并发提交破坏编译链路。
   - 对策: workspace 级全局互斥 + 幂等键 + 有界队列。
6. 风险: Sidecar 重启导致任务状态丢失。
   - 对策: 持久化 job 状态并在启动后恢复/回收。
7. 风险: 工具自进化失控。
   - 对策: 建立“提案 -> 测试 -> 人审 -> 发布”的工具治理流程。

## 8. 发布策略

1. 先灰度: `feature_flag` 控制 MCP Adapter 开关。
2. 保留旧路径: Sidecar 本地直连流程作为回滚通道。
3. 分批放量:
   - 10% 内部
   - 50% 团队
   - 100% 全量
4. 触发回滚条件:
   - 超时率连续 30 分钟超阈值
   - 执行成功率低于基线 10% 以上

## 9. 里程碑建议（可调整）

1. M1（本周）: 完成 Phase 0-2，稳定现有链路并降低超时。
2. M2（下周）: 完成 Phase 3-4，动作协议与 ReAct 探针稳定。
3. M3（第 3-4 周）: 完成 Phase 5，MCP Job Ticket 最小可用。
4. M4（第 5 周+）: 完成 Phase 6-7，进入可持续演进模式。

## 10. 执行结论

1. 你的目标架构可行，但必须采用“渐进式替换”，不能一次性推翻当前执行内核。
2. 最优路径不是“二选一”（继续现架构 vs 全量 Cursor），而是“保留 Sidecar 内核 + 上层增加 MCP 大脑接入”。
3. 本文路线能同时保住稳定性与上限能力，且具备可回滚、可观测、可持续扩展的工程属性。

## 11. v1.1 对齐补充（Embodied Agent）

说明:
1. 本节用于对齐 `Assets/Docs/Codex-Unity-Embodied-Agent-Refactor-Plan.md`（v1.1）。
2. 不推翻现有 Phase 0-7，只对 Phase 5 做细化并新增发布门禁。

### 11.1 新增硬约束（必须纳入）

1. 感知层输出预算化:
   - `get_hierarchy_subtree` 强制 `depth`（默认 1，最大 3）
   - 强制 `node_budget` 与 `char_budget`
   - 响应必须包含 `truncated` 与 `truncated_reason`
2. 读取 token 失效机制:
   - 主判据: `scene_revision`
   - 辅判据: `hard_max_age_ms` 兜底
   - 事件触发失效: `HierarchyChanged` / `UndoRedo` / `CompileStarted`
3. 验证层采用“两级验证”:
   - Level A: 目标对象/目标组件精准 Diff
   - Level B: 轻量全局哨兵（路径存在、组件计数、关键状态）
4. 对象定位升级:
   - 从纯 `path` 升级为 `object_id + path` 双锚点
5. 编译与域重载窗口治理:
   - read->execute 间出现世界状态变化时，进入可恢复错误路径（如 `WAITING_FOR_UNITY_RELOAD`）

### 11.2 Phase 5 细化（v1.1）

在现有 `Phase 5: MCP Adapter + Job Ticket` 下拆分子阶段:

1. Phase 5A（Eyes）:
   - 上线公开读工具: selection / hierarchy / components / prefab / compile_state / console_errors
   - 同步上线 `resources/list` 与 `resources/read`
2. Phase 5B（Safety）:
   - 强制 `based_on_read_token`
   - 无读不写（`E_READ_REQUIRED`）
   - stale snapshot 拒绝执行（`E_STALE_SNAPSHOT`）
3. Phase 5C（Hands）:
   - 拆分 `apply_script_actions` / `apply_visual_actions`
   - 支持 `dry_run` + `preconditions`
4. Phase 5D（Brain）:
   - 固化 `read -> plan -> confirm -> execute -> verify`
   - 将内部组件查询桥接能力外显为公开读能力
5. Phase 5E（Feedback）:
   - 执行后强制二次读取
   - 输出结构化 `expected/actual/diff`

### 11.3 里程碑与门禁增量

1. 里程碑调整:
   - M3 从“Phase 5 最小可用”升级为“Phase 5A-5C 可用”
   - M4 加入“Phase 5D-5E 闭环达标”
2. Go/No-Go 增量:
   - 未返回 `read_token` 的读链路不得灰度
   - 未执行 token 新鲜度校验的写链路不得灰度
   - 未产出结构化验证 Diff 的写链路不得灰度


