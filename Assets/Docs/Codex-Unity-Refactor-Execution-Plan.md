# Codex Unity 重构实施方案（Execution Plan v1）

- 状态: Ready for Implementation
- 日期: 2026-02-22
- 依据文档: `Assets/Docs/Codex-Unity-Refactor-Roadmap.md`
- 门禁清单: `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`
- 适用范围: `sidecar/src/*`、`Assets/Editor/Codex/*`

## 1. 目标与边界

1. 在不破坏现有可用链路的前提下完成重构。
2. 保留 Sidecar 作为唯一执行内核，不复制状态机。
3. 先稳定，再扩展，再接入 MCP，再做 token/记忆优化。
4. 所有阶段必须可观测、可回滚、可验收。

## 2. 执行总策略

1. 采用“双轨并行”推进:
   - 稳定性轨道: 超时、取消、一致性、观测、测试。
   - 能力轨道: 协议扩展、ReAct 探针、MCP Adapter、记忆治理。
2. 每阶段均走固定门禁:
   - 设计评审 -> 开发 -> 回归 -> 压测 -> 灰度 -> 通过/回滚。
3. 每阶段输出必须落盘:
   - 变更说明、接口变更、错误码变更、回放样本、验收报告。
4. 测试左移:
   - Step 0 建立最小自动化回归脚本（CLI/Mock）。
   - Step 8 在此基础上扩展为完整测试矩阵与 CI，不从零开始。
5. 防偏航执行:
   - 每个 Step 的设计评审与发布评审必须逐项勾选 `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`。
   - 任一 No-Go 命中则禁止灰度。

## 3. 分阶段实施步骤

## Step 0: 基线冻结与回归门禁（对应 Roadmap Phase 0）

目标:

1. 冻结现有协议、错误码、默认超时参数。
2. 建立“重构前”性能与稳定性基线。

主要任务:

1. 固化回归样例集:
   - 闲聊轮次
   - 纯文件动作
   - 文件 + 视觉动作
   - 编译失败 + 自动修复
   - 取消与超时
2. 建立 smoke 压测脚本（最少 20 轮连续回合）。
3. 记录当前基线指标（P50/P95 阶段耗时、超时率、提取失败率）。
4. 建立最小自动化回归脚本（Node.js/Python CLI）:
   - 模拟 Unity 发送 `turn.send`/`turn.cancel`
   - 校验 `turn.completed/turn.error/turn.cancelled` 状态
   - 每个 Step 都可一键复跑

受影响文件:

1. `Assets/Docs/Codex-Unity-MVP-Plan.md`
2. `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
3. `sidecar/.state/sidecar-state.json`（基线样本）
4. `sidecar/scripts/*`（新增最小回归脚本）
5. `sidecar/scripts/smoke-turn-runner.js`（已落地）
6. `sidecar/package.json`（`npm run smoke` / `npm run smoke:fast`）
7. `sidecar/src/adapters/fakeTimeoutPlanner.js`（测试专用超时规划器）

验收标准:

1. 基线回归通过率 >= 95%。
2. 基线指标可复现，可用于后续对比。
3. 最小回归脚本可稳定跑完 20 轮并输出机器可读结果（JSON/CSV）。
4. 可通过独立端口短超时场景稳定复现 `E_CODEX_TIMEOUT` 与 `E_COMPILE_TIMEOUT`。

回滚点:

1. 不改主流程代码，仅新增测试与基线数据，可直接撤销。

## Step 1: 执行内核稳定化（对应 Roadmap Phase 1）

目标:

1. 消除超时误杀、僵尸请求和状态不一致。

主要任务:

1. 统一 soft/hard/compile 超时行为。
2. 超时清扫必须触发 `AbortController.abort()`。
3. 完整打点阶段耗时与最后心跳时间。
4. 清理死代码（XML 伪工具解析链路、无效 fallback）。

受影响文件:

1. `sidecar/src/application/turnService.js`
2. `sidecar/src/domain/turnStore.js`
3. `sidecar/src/api/router.js`

验收标准:

1. 超时后 in-flight 请求 100% 终止。
2. 日志可直接定位是 Text 阶段还是 Extraction 阶段卡顿。

回滚点:

1. 以 feature flag 包裹新超时逻辑，异常时回退旧策略。

## Step 2: Planner/Prompt 轻量化（对应 Roadmap Phase 2）

目标:

1. 降低提取抖动、缩短 TTFT、减少无效 token 消耗。

主要任务:

1. Phase 1 保留探索能力，但限制无关仓库深挖。
2. Phase 2 强化“翻译器职责”，严格转换 Phase 1 意图。
3. 保留 Few-shot 输出样例，删除冲突规则。
4. 本地 validators 作为最终安全真相。

受影响文件:

1. `sidecar/src/adapters/codexAppServerPlanner.js`
2. `sidecar/src/domain/validators.js`

验收标准:

1. JSON 提取失败率显著下降。
2. TTFT 与单轮 token 下降（按 P50/P95 对比 Step 0 基线）。

回滚点:

1. Prompt 改动可回滚到上一个稳定模板版本。

## Step 3: Action Protocol 完整化（对应 Roadmap Phase 3）

目标:

1. 文件与视觉动作能力形成完整闭环。

主要任务:

1. 文件动作全量支持并严格校验:
   - `create_file/update_file/rename_file/delete_file`
2. 视觉动作全量支持并保持编译门禁:
   - `add_component/remove_component/replace_component/create_gameobject`
3. Missing Script 探测/清理与模糊匹配容错落地。
4. 增加 Domain Reload 联动回归用例:
   - 重命名一个“当前正被挂载”的脚本
   - 紧接着对另一对象执行组件替换/移除
   - 验证 `WAITING_FOR_UNITY_REBOOT` 能覆盖整个组合动作

受影响文件:

1. `sidecar/src/adapters/fileActionExecutor.js`
2. `sidecar/src/domain/validators.js`
3. `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
4. `Assets/Editor/Codex/Domain/SidecarContracts.cs`

验收标准:

1. 动作全集可以通过自动化与手工回归。
2. 重命名 + 替换组件场景无 Missing 残骸误失败。
3. Domain Reload 组合用例稳定通过，不出现状态机断裂或动作丢失。

回滚点:

1. 视觉动作按 type 受 flag 控制，可逐类关闭。

## Step 4: ReAct 探针链路（对应 Roadmap Phase 4）

目标:

1. 解决“组件名猜测”问题，改为运行时查询驱动。

主要任务:

1. 注入 `query_unity_components` 到 Phase 1 工具集。
2. 建立 Sidecar <-> Unity 探针请求/回包桥接。
3. 查询结果作为 tool result 回填并继续推理。
4. Unity 查询逻辑强制在主线程执行。
5. 增加探针防挂死机制:
   - 查询硬超时 3-5 秒
   - 超时/Unity 忙碌时返回结构化错误（如 `unity_busy_or_compiling`）
   - 允许 LLM 基于已有上下文继续，不阻塞整轮会话

受影响文件:

1. `sidecar/src/adapters/codexAppServerPlanner.js`
2. `sidecar/src/application/turnService.js`
3. `sidecar/src/api/router.js`
4. `Assets/Editor/Codex/Application/ConversationController.cs`
5. `Assets/Editor/Codex/Domain/SidecarContracts.cs`

验收标准:

1. “移除除 X 外组件”任务稳定输出多条合法 `remove_component`。
2. 不再出现凭空组件名导致的 `E_ACTION_COMPONENT_NOT_FOUND`。
3. Unity 忙碌/编译中时，探针在超时阈值内失败返回，不触发整轮死锁。

回滚点:

1. 工具开关可回退为“无探针模式”，保留旧流程。

## Step 5: MCP Adapter + Job Ticket（对应 Roadmap Phase 5）

目标:

1. 在不改执行内核的前提下接入 Cursor/MCP。

主要任务:

1. 实现 MCP 工具:
   - `submit_unity_task`
   - `get_unity_task_status`（兜底）
   - `cancel_unity_task`
2. 状态语义落地:
   - `accepted/rejected/queued/pending/succeeded/failed/cancelled`
3. 落地并发治理:
   - workspace 级全局互斥
   - `idempotency_key`
   - 有界队列（建议 `max_queue=1`）
4. 落地 HITL 治理:
   - `approval_mode: auto | require_user`
   - MCP 默认 `auto`，避免 `ACTION_CONFIRM_PENDING` 死锁。
5. 落地错误反哺机制:
   - MCP `rejected/failed` 必须透传 `error_code/error_message/suggestion/recoverable`
   - 对本地硬校验错误（如 `E_FILE_PATH_FORBIDDEN`）返回可执行修复建议
   - 支持上层模型基于错误反馈自动修正并重发

受影响文件:

1. `sidecar/src/api/router.js`
2. `sidecar/src/application/turnService.js`
3. `sidecar/src/domain/turnStore.js`
4. `Assets/Editor/Codex/Domain/SidecarContracts.cs`（若需共享 DTO）

验收标准:

1. 编译长耗时不再阻塞 MCP 工具调用链路。
2. 并发提交可拒绝且返回 `running_job_id`。
3. 重复提交不重复执行（幂等命中返回同一 `job_id`）。
4. 上层模型可收到结构化错误反馈并完成一次自动修正重试。

回滚点:

1. MCP Adapter 独立开关，可随时回退本地直连路径。

## Step 6: 推送通道与恢复治理（对应 Roadmap Phase 5 补强）

目标:

1. 实现“推送优先、查询兜底”的稳定通信。

主要任务:

1. 本地模式优先 `stdio`，远程模式使用 `SSE/streamable HTTP`。
2. 推送事件标准化:
   - `job.progress`
   - `job.completed`
3. 断线重连补偿:
   - 客户端可通过 `get_unity_task_status` 补偿查询。
4. 重启恢复:
   - 持久化 `running/queued` job 并恢复或回收。

受影响文件:

1. `sidecar/src/api/router.js`
2. `sidecar/src/domain/turnStore.js`
3. `sidecar/.state/*`（状态结构升级）

验收标准:

1. 主链路推送可稳定运行，查询调用频率显著下降。
2. Sidecar 重启后任务状态可恢复，且无“幽灵运行”。

回滚点:

1. 推送通道异常时可临时切回查询模式（低频）。

## Step 7: 记忆与 Token 治理（对应 Roadmap Phase 6）

目标:

1. 在保持上下文质量的前提下降低 token 消耗。

主要任务:

1. 建立热上下文 + 冷摘要双层记忆。
2. 注入策略收敛:
   - 首轮/恢复注入摘要
   - 常规轮次避免重复注入历史
3. 上下文预算器:
   - 代码上下文按相关度截断
   - `selection_tree` 深度与节点数量限额

受影响文件:

1. `sidecar/src/adapters/codexAppServerPlanner.js`
2. `sidecar/src/application/turnService.js`
3. `sidecar/.state/codex-session-map.json`

验收标准:

1. 同类任务 token 消耗相对 Step 0 基线下降。
2. 长会话质量无明显退化。

回滚点:

1. 摘要注入策略可按开关回退到旧模式。

## Step 8: 可观测性与测试闭环（对应 Roadmap Phase 7）

目标:

1. 将“可调试”升级为“可度量、可回归、可预测”。

主要任务:

1. 指标面板:
   - 阶段耗时 P50/P95
   - 超时率
   - 取消成功率
   - 提取失败率
   - 动作成功率
2. 自动化测试补齐:
   - 在 Step 0 最小脚本基础上扩展为 Sidecar 集成测试
   - Unity 编辑器测试并入统一回归入口
3. 失败回合回放机制落地。

受影响文件:

1. `sidecar/src/*`（测试与埋点）
2. `Assets/Editor/Codex/*`（编辑器测试）
3. `Assets/Docs/Codex-Unity-Panel-Status-Report.md`（指标基线更新）

验收标准:

1. 每次迭代都有机器可读的回归报告。
2. 重大故障可在 10 分钟内定位到具体阶段。

回滚点:

1. 测试与观测增强不影响主链路，可独立回滚。

## Step 9: Embodied Agent 对齐落地（对应 Roadmap Phase 5A-5E）

目标:

1. 把“可控执行”升级为“先读后写 + 可验证闭环”的具身代理流程。

主要任务:

1. Eyes:
   - 新增 MCP 公开读工具:
     - `get_current_selection`
     - `get_hierarchy_subtree`
     - `get_gameobject_components`
     - `get_prefab_info`
     - `get_compile_state`
     - `get_console_errors`
   - 实现 `resources/list` 与 `resources/read`
   - `get_hierarchy_subtree` 强制预算参数:
     - `depth`（默认 1，最大 3）
     - `node_budget`
     - `char_budget`
2. Safety:
   - 读接口返回 `read_token`（含 `scene_revision`、`object_id`、`hard_max_age_ms`）
   - 写接口强制 `based_on_read_token`
   - 支持 `E_READ_REQUIRED` / `E_STALE_SNAPSHOT` / `E_PRECONDITION_FAILED`
3. Hands:
   - 拆分写工具:
     - `apply_script_actions`
     - `apply_visual_actions`
   - 支持 `dry_run` 与 `preconditions`
   - 对象定位升级为 `object_id + path` 双锚点
4. Brain:
   - 固化流程 `read -> plan -> confirm -> execute -> verify`
   - 将内部桥接查询能力外显为公开读能力
5. Feedback:
   - 执行后强制二次读取
   - 输出结构化 `expected/actual/diff`
   - 采用“两级验证”: 目标级精准 Diff + 轻量全局哨兵

受影响文件:

1. `sidecar/src/mcp/mcpServer.js`
2. `sidecar/src/api/router.js`
3. `sidecar/src/application/turnService.js`
4. `sidecar/src/domain/validators.js`
5. `Assets/Editor/Codex/Application/ConversationController.cs`
6. `Assets/Editor/Codex/Infrastructure/*`（Unity 读能力与版本事件）

验收标准:

1. Cursor 可独立调用读工具，不依赖 `submit_unity_task`。
2. 无 token 写请求必然失败（`E_READ_REQUIRED`）。
3. `scene_revision` 不一致写请求必然失败（`E_STALE_SNAPSHOT`）。
4. `dry_run` 不产生实际写入。
5. 每个写任务都返回结构化验证 diff。

回滚点:

1. `ENABLE_MCP_EYES`
2. `ENABLE_STRICT_READ_TOKEN`
3. `ENABLE_SPLIT_WRITE_TOOLS`
4. `ENABLE_VERIFY_DIFF_REPORT`

## 4. 里程碑与排期建议

1. 里程碑 A（1 周）:
   - 完成 Step 0-2
   - 目标: 稳定性与提取质量可量化提升
2. 里程碑 B（第 2 周）:
   - 完成 Step 3-4
   - 目标: 动作协议完整 + 探针链路稳定
3. 里程碑 C（第 3-4 周）:
   - 完成 Step 5-6
   - 目标: MCP 最小可用 + 推送/恢复可运行
4. 里程碑 D（第 5 周+）:
   - 完成 Step 7-8
   - 目标: token 治理与工程闭环
5. 里程碑 E（追加，1-2 周）:
   - 完成 Step 9
   - 目标: Eyes/Safety/Hands/Feedback 闭环可灰度上线

## 5. 阶段门禁（Go/No-Go）

每个 Step 发布前必须同时满足:

1. 回归通过率 >= 95%。
2. 关键错误码无新增未知类别。
3. 无僵尸请求、无未清理 active job。
4. 文档同步更新:
   - `Assets/Docs/Codex-Unity-MVP-Plan.md`
   - `Assets/Docs/Codex-Unity-Panel-Status-Report.md`
   - `Assets/Docs/Codex-Unity-Refactor-Guardrail-Checklist.md`（含当次迭代记录）
5. Step 9 增量门禁:
   - 读工具必须返回 `read_token`
   - 写工具必须校验 token 新鲜度
   - 写后必须返回结构化验证 diff

## 6. 实施顺序（必须遵守）

1. 不允许跳过 Step 0 直接做 MCP。
2. 不允许在 Step 1 未稳定前扩展大规模新动作类型。
3. 不允许在无互斥/幂等保障下开启 MCP submit。
4. 不允许在无观测与回归报告下推进灰度。
5. 不允许在未开启 token 新鲜度校验时放量写工具。

## 7. 执行结论

1. 本方案是对 Roadmap 的工程化拆解，能直接转成迭代任务。
2. 核心策略是“保内核、加适配、推送优先、幂等互斥、可恢复”。
3. 按此步骤推进可同时控制风险、降低超时与 token 消耗，并为 Cursor/MCP 接入打下稳定底座。


