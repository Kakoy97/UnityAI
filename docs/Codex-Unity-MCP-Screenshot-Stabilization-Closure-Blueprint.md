# Codex-Unity MCP 截图能力稳定化收口蓝图（R11-CLOSE）
## 0. 目标与边界

### 0.1 收口目标
1. 先止血：避免 `final_pixels` 误截桌面前台窗口（如 Cursor）和黑图。
2. 最小破坏：对上游协议与工具调用方尽量兼容，不做断崖式 schema 删除。
3. 保留地基：为后续“离屏/非桌面采样”的新截图方案保留字段与诊断框架。

### 0.2 本轮不做
1. 不在本轮重做新的截图技术方案（offscreen final pixels / editor final capture）。
2. 不在本轮引入新的 Unity 原生渲染管线适配（URP/HDRP 特化）。
3. 不在本轮新增复杂视觉工具，只做禁用、收口、删除冗余。

### 0.3 强制约束
1. 对外 MCP 协议尽量稳定：保留 `capture_mode` 入参，不直接删字段。
2. 禁用优先于删除：先返回明确错误码，再逐步清理实现。
3. 错误反馈统一：新禁用态必须走 LLM 友好错误模板（`suggestion + recoverable`）。
4. 回归不退化：`render_output` 主链路与 `get_ui_tree` 必须持续可用。

---

## 1. 收口策略总览

### 1.1 核心原则
1. 接口层先收口：保留字段，禁用风险模式（`final_pixels/editor_view`）。
2. 实现层后收口：移除桌面坐标采样路径和强耦合功能。
3. 资产层最后收口：脚本、文档、测试同步到新基线。

### 1.2 新基线定义（临时稳定版）
1. `capture_scene_screenshot` 仅允许稳定执行语义：`render_output`。
2. `final_pixels/editor_view` 请求统一失败并返回 `E_CAPTURE_MODE_DISABLED`。
3. `hit_test_ui_at_screen_point` 暂时禁用（保留 stub 或隐藏工具二选一，优先 stub）。
4. `get_ui_tree` 保持可用，作为 UI 理解的主要读能力。

---

## 2. Commit-by-Commit 执行方案

## 2.1 Commit 1：接口收口（禁用优先，不删协议）

### 目标
1. 立即阻断不稳定模式调用。
2. 保留协议字段和响应骨架，降低上游改造成本。

### 文件级改动清单
1. `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js`
2. `sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`
3. `sidecar/src/application/turnPolicies.js`
4. `sidecar/src/mcp/commands/index.js`
5. `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`（仅分支禁用逻辑，暂不大删）

### 具体动作
1. `capture_mode` 字段保留，枚举值保留（`render_output|final_pixels|editor_view`）。
2. 当请求 `final_pixels/editor_view` 时，直接返回：
   - `error_code = E_CAPTURE_MODE_DISABLED`
   - `recoverable = true`
   - suggestion 指向 `render_output` 与 `get_ui_tree`。
3. 保留响应骨架字段：`requested_mode/effective_mode/fallback_reason/diagnosis_tags/pixel_sanity`。
4. `effective_mode` 固定回传 `render_output`（仅成功路径）。

### 验收标准
1. 上游传 `final_pixels/editor_view` 不再进入高风险实现路径。
2. 不出现 schema 级断崖报错（保持输入字段兼容）。
3. 错误反馈模板可被 LLM 直接用于恢复重试。

---

## 2.2 Commit 2：实现收口（删除高风险链路）

### 目标
1. 从 L3 彻底移除桌面读屏路径，避免误截外部窗口。
2. `CaptureSceneScreenshot` 仅保留相机渲染路径（`render_output`）。

### 文件级改动清单
1. `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`
2. `Assets/Editor/Codex/Application/ConversationController.cs`（若有相关分支清理）
3. `Assets/Editor/Codex/Domain/SidecarContracts.cs`（谨慎：优先保留字段，后续再精简）

### 具体动作
1. 删除或停用以下函数及调用链：
   - `TryCaptureFinalPixels`
   - `TryReadGameViewScreenPixels`
   - `TryResolveGameViewCaptureRects`
   - `MapReferencePointToReadRect`
   - `TryCaptureEditorViewPixels`
   - `BuildWindowRect`
2. `CaptureSceneScreenshot` 只走 `TryCaptureViaCamera`。
3. artifact 自动清理逻辑保留（不动）。
4. 诊断框架保留，但来源仅来自 `render_output` 路径。

### 验收标准
1. 代码中不再存在桌面像素读取主流程。
2. 不再出现 “Cursor 窗口被截入” 的结构性来源。
3. `render_output` 成功率稳定，不引入写链路回归。

---

## 2.3 Commit 3：命令收口（hit_test 禁用/隐藏）

### 目标
1. 解除 `hit_test_ui_at_screen_point` 对旧屏幕坐标链路依赖。
2. 保持路由与工具治理可控，不一次性破坏太多契约。

### 方案优先级
1. 优先方案：保留命令入口但返回 `E_COMMAND_DISABLED`（stub）。
2. 次优方案：从 tools/list 隐藏命令，但内部代码暂保留一版。
3. 最后方案：物理删除命令（仅当确认短期不会恢复）。

### 文件级改动清单
1. `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/*`
2. `sidecar/src/mcp/commands/index.js`
3. `sidecar/src/ports/contracts.js`
4. `sidecar/src/mcp/mcpServer.js`
5. `sidecar/src/application/turnPolicies.js`
6. `Assets/Editor/Codex/Application/ConversationController.cs`（如完全下线）
7. `Assets/Editor/Codex/Domain/SidecarContracts.cs`（如完全下线）

### 验收标准
1. 调用 hit-test 时返回明确禁用错误，不再进入不稳定逻辑。
2. 冻结契约测试与工具列表测试通过。
3. 不影响 `capture_scene_screenshot(render_output)` 与 `get_ui_tree`。

---

## 2.4 Commit 4：脚本、测试、文档收口

### 目标
1. 删除失效/误导资产，保留高价值诊断入口。
2. 将测试与文档统一到“render_output 稳定基线”。

### 文件级改动清单
1. `sidecar/scripts/verify-final-pixels-mode.ps1`（删除）
2. `sidecar/scripts/diagnose-capture.js`（保留并改造）
3. `sidecar/scripts/README.md`
4. `sidecar/tests/application/*screenshot*.test.js`
5. `sidecar/tests/domain/validators.capture-scene-screenshot.test.js`
6. `sidecar/tests/domain/validators.hit-test-ui-at-screen-point.test.js`（按禁用策略调整）
7. `Assets/Editor/Codex/Tests/EditMode/*Screenshot*.cs`
8. `Assets/Docs/Phase9-*.md`
9. `docs/Codex-Unity-MCP-Command-Development-Optimization-Blueprint.md`

### 具体动作
1. 删除损坏编码脚本 `verify-final-pixels-mode.ps1`。
2. `diagnose-capture.js` 改为仅编排：
   - `capture_scene_screenshot(render_output)`
   - `get_ui_tree`
3. 测试改造策略：
   - `final_pixels/editor_view` case 改为断言 `E_CAPTURE_MODE_DISABLED`
   - hit-test case 改为断言 disabled（或隐藏后移除测试）
   - 保留并增强 `render_output` 基线测试
4. 文档全部改为当前支持矩阵，不再宣称 final_pixels/editor_view 可用。

### 验收标准
1. 脚本入口清晰且可执行，无乱码/误导参数。
2. 测试覆盖稳定基线，禁用行为有明确断言。
3. 文档与实际实现一致。

---

## 3. 错误码与反馈策略

### 3.1 新增/调整错误码
1. `E_CAPTURE_MODE_DISABLED`
2. `E_COMMAND_DISABLED`（用于 hit-test stub）

### 3.2 错误反馈模板要求
1. `recoverable = true`
2. suggestion 必须提供可执行替代路径：
   - 使用 `capture_scene_screenshot` + `capture_mode=render_output`
   - 结合 `get_ui_tree` 做结构化验证

---

## 4. 风险与回滚

### 4.1 主要风险
1. 直接删除过多代码导致冻结契约测试大面积失败。
2. tools/list 变更导致上层缓存工具信息与实际不一致。
3. 文档未同步造成团队误用旧参数。

### 4.2 回滚策略
1. 每个 commit 独立可回滚，不做大合并提交。
2. 先上线“禁用态”再做“物理删除”，确保中间态稳定。
3. 保留 `diagnosis_tags/pixel_sanity` 框架，降低后续重构成本。

---

## 5. 最终验收标准（收口完成判定）

1. `capture_scene_screenshot` 仅 `render_output` 可执行，其他模式 fail-closed。
2. 不再出现由桌面前台窗口导致的截图混入问题来源。
3. `get_ui_tree` 正常可用，作为 UI 读能力主路径。
4. hit-test 处于明确禁用或隐藏状态，无隐式半可用分支。
5. 相关脚本、测试、文档全部与新基线一致。
6. sidecar 全量测试通过，Unity 侧关键 EditMode 测试通过。

---

## 6. 后续重建建议（下一阶段）

1. 新方案再启用 `final_pixels` 前，必须改为非桌面读屏路径（离屏渲染或可控帧缓冲采样）。
2. 先定义“可验证契约”再恢复功能：模式能力探测、禁用态、诊断字段一致性。
3. hit-test 重建应基于稳定坐标体系，不再依赖不可信窗口屏幕坐标映射。

---

## 7. 执行顺序与任务矩阵（R11-CLOSE）

### 7.1 执行顺序（按依赖）
1. `Phase A / 接口收口`：R11-CLOSE-L2-01、R11-CLOSE-L2-02、R11-CLOSE-L2-03  
2. `Phase B / Unity 实现收口`：R11-CLOSE-L3-01、R11-CLOSE-L3-02、R11-CLOSE-L3-03  
3. `Phase C / 资产与验证收口`：R11-CLOSE-ASSET-01、R11-CLOSE-QA-01、R11-CLOSE-QA-02、R11-CLOSE-E2E-01

### 7.2 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R11-CLOSE-L2-01 | Phase A | capture 接口收口 | `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js` | `final_pixels/editor_view` 统一返回 `E_CAPTURE_MODE_DISABLED` | 禁用模式请求不再进入 Unity 高风险截图路径 |
| R11-CLOSE-L2-02 | Phase A | 错误反馈收口 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 新增禁用错误码建议模板 | LLM 反馈包含明确恢复建议（改用 `render_output`） |
| R11-CLOSE-L2-03 | Phase A | hit_test 收口 | `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`、`sidecar/src/mcp/commands/index.js`、`sidecar/src/mcp/mcpServer.js`（可选） | hit_test 变为 disabled stub（或 tools 隐藏） | 不再出现误导性命中失败结果 |
| R11-CLOSE-L3-01 | Phase B | 截图主路径固化 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | `capture_scene_screenshot` 强制 render_output-only | 截图来源稳定，不再依赖桌面前台窗口 |
| R11-CLOSE-L3-02 | Phase B | 高风险实现清理 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Application/ConversationController.cs`（必要时） | 移除/停用窗口坐标映射与读屏代码链 | 代码中无活跃 `final_pixels/editor_view` 读屏实现 |
| R11-CLOSE-L3-03 | Phase B | 协议骨架保留 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`（仅必要改动） | 保留 `requested/effective/fallback/diagnosis_tags` 回包语义 | 收口不破坏外部诊断契约 |
| R11-CLOSE-ASSET-01 | Phase C | 脚本收口 | `sidecar/scripts/verify-final-pixels-mode.ps1`、`sidecar/scripts/diagnose-capture.js`、`sidecar/scripts/README.md` | 删除失效脚本，保留并改造基线诊断脚本 | 脚本能力描述与当前实现一致 |
| R11-CLOSE-QA-01 | Phase C | Sidecar 回归收口 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | 禁用模式断言、错误模板断言、render_output 基线断言 | CI 全绿，且禁用路径有明确覆盖 |
| R11-CLOSE-QA-02 | Phase C | Unity 回归收口 | `Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceScreenshotTests.cs`、`Assets/Editor/Codex/Tests/EditMode/UnityVisualReadChainTests.cs` | EditMode 测试从“可 fallback”调整为“禁用模式必失败” | 编译 + EditMode 全绿 |
| R11-CLOSE-E2E-01 | Phase C | 验收文档收口 | `Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md` | 固化 render_output + get_ui_tree 的验收流程 | Cursor 按文档可重复完成验收 |

---

## 8. R12-L3 解耦专项计划（R11-CLOSE 完成后）
### 8.1 目标
1. 让 L3 新增 read command 时，不再默认修改 `ConversationController.cs` 的 query_type 分支。
2. 将 `UnityRagReadService.cs` 的集中实现拆为按命令职责分离的 Handler 模块。
3. 建立可注册、可测试、可灰度迁移的 Unity Query Registry，统一错误回执与主线程执行约束。

### 8.2 范围边界
1. 本专项仅处理 L3 读命令分发与执行解耦，不改写链路（OCC/双锚点/Action Registry）。
2. 不在本专项恢复 `final_pixels` 与 `hit_test` 生产能力，仍遵循 R11-CLOSE 禁用基线。
3. 维持对外 query/report 协议稳定，避免 L2 合同震荡。

### 8.3 目标架构（L3）
1. `IUnityQueryHandler`
   - 统一接口：`CanHandle(queryType)`、`Execute(request, context)`。
   - 统一输出：标准 `ok/error_code/error_message/data/captured_at` 结构。
2. `UnityQueryRegistry`
   - 显式注册：`Register("capture_scene_screenshot", handler)`。
   - 查找执行：`TryDispatch(queryType, request, context)`。
3. `UnityQueryExecutionContext`
   - 注入统一依赖：`UnityRagReadService`（迁移期）、日志器、时间源、主线程调度器。
4. `ConversationController`
   - 从 if/switch 分发迁移为 registry 查字典。
   - 仅保留“拉取 query -> 调度 -> 回执上报”的编排职责。

### 8.4 执行顺序
1. `Phase D / 注册中心落地（L3主线 + L2配套）`：R12-L3-01、R12-L3-02、R12-L2-01  
2. `Phase E / 处理器迁移（L3主线 + L2配套）`：R12-L3-03、R12-L3-04、R12-L3-05、R12-L2-02  
3. `Phase F / 收口与验证（L3主线 + L2配套）`：R12-L3-06、R12-QA-01、R12-L2-03、R12-E2E-01

### 8.5 任务矩阵（R12）

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R12-L3-01 | Phase D | Query Handler 抽象 | `Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`（新增） | 统一处理器接口与标准回执模型 | 新增命令可按接口扩展，不依赖控制器分支 |
| R12-L3-02 | Phase D | Query Registry | `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistry.cs`（新增）、`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`（新增） | 显式注册中心与启动装配 | 控制器可通过 registry 分发命令 |
| R12-L2-01 | Phase D | MCP Tool 描述同步 | `sidecar/src/mcp/commands/index.js` | 当 L3 handler 迁移导致命令可用性或描述变更时，同步 tools/list 描述 | tools/list 描述与实际行为一致，不出现“文档可用但运行禁用” |
| R12-L3-03 | Phase E | capture handler 迁移 | `Assets/Editor/Codex/Infrastructure/Queries/Handlers/CaptureSceneScreenshotQueryHandler.cs`（新增）、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | `capture_scene_screenshot` 从控制器分支迁移到独立 handler | 新增截图相关改动不触碰控制器业务分支 |
| R12-L3-04 | Phase E | get_ui_tree handler 迁移 | `Assets/Editor/Codex/Infrastructure/Queries/Handlers/GetUiTreeQueryHandler.cs`（新增）、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | `get_ui_tree` 独立 handler 化 | UI 树读能力变更不改控制器分发结构 |
| R12-L3-05 | Phase E | hit_test 禁用 handler 迁移 | `Assets/Editor/Codex/Infrastructure/Queries/Handlers/HitTestUiAtScreenPointDisabledHandler.cs`（新增） | 命令禁用语义以 handler 承载 | 禁用策略统一，避免散落在控制器分支 |
| R12-L2-02 | Phase E | 合同与可见性冻结同步 | `sidecar/src/ports/contracts.js`、`sidecar/src/mcp/mcpServer.js`（必要时） | 若工具暴露策略变化（如隐藏/禁用）则同步合同冻结与 server 可见性 | 合同快照与工具列表快照测试通过 |
| R12-L3-06 | Phase F | 控制器分发收口 | `Assets/Editor/Codex/Application/ConversationController.cs` | 删除 query_type if/switch 业务分支，保留编排骨架 | 新增 read command 默认不改控制器业务逻辑 |
| R12-QA-01 | Phase F | L3 回归测试 | `Assets/Editor/Codex/Tests/EditMode/UnityQueryRegistryDispatchTests.cs`（新增）、`Assets/Editor/Codex/Tests/EditMode/*` | 注册分发、错误语义、主线程执行回归 | 编译 + EditMode 全绿，分发链路稳定 |
| R12-L2-03 | Phase F | L2 回归配套 | `sidecar/tests/application/*command*`、`sidecar/tests/application/*schema*` | 增补/更新注册中心快照与工具映射断言，覆盖 R12 后的实际工具状态 | L2 测试全绿，且无新增 command 的手写分支回退 |
| R12-E2E-01 | Phase F | 端到端验收文档 | `Assets/Docs/Phase10-L3-Query-Registry-Acceptance.md`（新增） | 固化“新增 read command 不改核心入口”验收路径 | 新增示例命令可按单路径接入并通过验收 |

### 8.6 专项验收标准
1. `ConversationController.cs` 不再包含按 query_type 逐条扩展的业务分支。
2. 新增一个 read command 时，L3 默认改动文件数 <= 3（handler + 注册 + 测试）。
3. `capture_scene_screenshot` 与 `get_ui_tree` 处理逻辑可独立演进，不互相污染。
4. 禁用命令（如 `hit_test`）由独立 handler 统一返回标准错误码。
5. R11-CLOSE 的收口行为不回退（`final_pixels/editor_view` 仍禁用）。

### 8.7 L2 前置与最小改动清单（避免“只改一半”）
1. 结论：R12 以 L3 为主，但 **L2 不是零改动**。
2. R11-CLOSE 阶段的 L2 必改（执行期）：
   - `sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`
   - `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js`
   - `sidecar/src/application/turnPolicies.js`
   - `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`
   - `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`
   - `sidecar/src/mcp/commands/index.js`
3. R12-L3 阶段的 L2 仅允许最小配套改动（非业务重构）：
   - `sidecar/src/mcp/commands/index.js`：仅在命令开关/描述同步时调整。
   - `sidecar/src/ports/contracts.js`：仅在工具暴露策略变化时同步冻结合同。
   - `sidecar/src/mcp/mcpServer.js`：仅在 tools/list 可见性策略调整时修改。
4. 强制原则：
   - R12 不新增 L2 业务逻辑分支，不重开 `final_pixels/editor_view`。
   - L2 若需改动，必须与对应 R11/R12 任务ID绑定并记录验收依据。

### 8.8 R12-L2 配套任务说明（已并入 8.5）
1. `R12-L2-01`、`R12-L2-02`、`R12-L2-03` 已并入 `8.5 任务矩阵（R12）`，不再单独维护第二张矩阵。
2. 执行时以 `8.4 执行顺序` 和 `8.5 统一矩阵` 为唯一来源，避免“主线与配套分离”导致遗漏。

### 8.9 R12 执行门禁（L2+L3）
1. R12-L3 任务可独立推进，但每次里程碑提交前必须完成对应的 R12-L2 配套检查。
2. 若 R12-L2-01/02 任何一项未完成，则禁止进入 R12-E2E-01。
3. 若 R12 期间出现 L2 业务逻辑新增分支，则视为架构回退，必须回滚并重新评审。

### 8.10 Cursor 评审建议采纳矩阵（强制/可选）

| 建议项 | 结论 | 任务映射 | 执行要求 |
|---|---|---|---|
| tools/list 与实际能力一致（避免继续暴露 final/editor） | 强制采纳 | `R11-CLOSE-L2-01`、`R11-CLOSE-L2-03`、`R11-CLOSE-QA-01` | LLM 暴露描述必须明确 render_output-only；兼容输入仍可接收并返回 `E_CAPTURE_MODE_DISABLED` |
| 禁用态返回避免误导（错误回包不混入 success 语义） | 强制采纳 | `R11-CLOSE-L2-01`、`R11-CLOSE-L2-02` | 仅 success 回包提供 `effective_mode`；错误回包不提供成功态字段 |
| 双层门禁（L2 fail-closed + L3 物理清理） | 强制采纳 | `R11-CLOSE-L2-01`、`R11-CLOSE-L3-01`、`R11-CLOSE-L3-02` | 任何一层未完成不得标记收口完成 |
| hit_test 先 stub，避免合同与测试断崖 | 强制采纳 | `R11-CLOSE-L2-03`、`R11-CLOSE-QA-01`、`R11-CLOSE-E2E-01` | 优先 `E_COMMAND_DISABLED`；若隐藏工具需同步 contracts + snapshot |
| queryType 常量集中、重复注册检测 | 强制采纳 | `R12-L3-01`、`R12-L3-02`、`R12-QA-01` | 禁止散落字符串；registry 注册重复直接失败 |
| 统一 Parse/校验入口，避免 handler 各自 try/catch 解析 | 建议采纳 | `R12-L3-01`、`R12-L3-02`、`R12-L3-03/04/05` | 先落轻量 parse helper，再演进泛型框架 |
| 主线程 gate 统一收口 | 强制采纳 | `R12-L3-02`、`R12-L3-06`、`R12-QA-01` | handler 执行统一走 main-thread gate，不允许各自散装处理 |
| registry 全局错误包装与统一回执 shape | 强制采纳 | `R12-L3-02`、`R12-L3-06`、`R12-QA-01` | 任意异常统一映射标准错误码与结构 |
| 渐进迁移 + golden test（旧新输出一致性） | 强制采纳 | `R12-L3-03/04/05`、`R12-QA-01` | 每迁一个 handler 必须补字段级金标回归 |
| CI 工具可用性一致性门禁 | 强制采纳 | `R11-CLOSE-QA-01`、`R12-L2-03` | tools/list 暴露项必须可用；禁用项必须显式 disabled 或不展示 |

### 8.11 CI 一致性门禁（新增）
1. 新增 `tools-list-capability-consistency` 检查脚本（sidecar 测试层）：
   - `tools/list` 暴露的命令与模式必须可执行或明确 disabled。
   - 禁用能力必须有标准错误码与 suggestion（`E_CAPTURE_MODE_DISABLED` / `E_COMMAND_DISABLED`）。
2. 若出现“工具描述可用但运行禁用且未声明”或“contracts 快照与 tools/list 不一致”，CI 直接失败。
3. 本门禁作为 `R11-CLOSE-QA-01` 与 `R12-L2-03` 的必过项，不可跳过。
