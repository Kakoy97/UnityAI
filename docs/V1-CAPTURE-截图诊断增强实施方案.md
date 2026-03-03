# V1-CAPTURE 截图诊断增强实施方案

版本：v1.1  
更新时间：2026-03-03  
适用范围：`sidecar`（L2）+ `Assets/Editor/Codex`（L3）+ 验收文档/脚本资产

---

## 0. 目标与边界

### 0.1 阶段目标
- 将截图能力从“仅 render_output 基线”升级到“结构化诊断 + 受控像素补充”的双轨模式。
- 在不依赖桌面前台读屏的前提下，补齐 Overlay UI 诊断能力。
- 保持读链路稳态：默认零副作用、可熔断、可回退、可审计。

### 0.2 非目标
- 不恢复 `final_pixels` 与 `editor_view` 旧语义，不承诺“最终屏幕像素”等价。
- 不引入 OS 桌面前台读屏（包括窗口坐标映射截图链路）。
- 不在本阶段承诺 SceneView Gizmos/选中框像素级稳定捕获。
- 不在默认路径引入 live scene 临时写操作（Undo 回滚式劫持不作为主方案）。

---

## 1. 执行顺序（按依赖）

1. `Phase A / Overlay 结构化基线（α）`：`R18-CAPTURE-E2E-00`、`R18-CAPTURE-A-01`、`R18-CAPTURE-A-02`、`R18-CAPTURE-A-03`  
2. `Phase B / 组合诊断 + 操作回执 + 证据融合（β）`：`R18-CAPTURE-B-01`、`R18-CAPTURE-B-02`、`R18-CAPTURE-B-03`、`R18-CAPTURE-B-04`、`R18-CAPTURE-B-05`、`R18-CAPTURE-B-06`、`R18-CAPTURE-B-07`  
3. `Phase C / composite 低风险路径（γ-1）`：`R18-CAPTURE-C-00`、`R18-CAPTURE-C-01`、`R18-CAPTURE-C-02`、`R18-CAPTURE-C-03`、`R18-CAPTURE-C-04`  
4. `Phase D / composite 高风险路径（γ-2）`：`R18-CAPTURE-D-01`、`R18-CAPTURE-D-02`、`R18-CAPTURE-D-03`  
5. `Phase E / QA 与验收收口`：`R18-CAPTURE-QA-01`、`R18-CAPTURE-QA-02`、`R18-CAPTURE-E2E-01`

---

## 2. 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R18-CAPTURE-E2E-00 | Phase A | 验收大纲左移 | `docs/Phase18-V1-Capture-Acceptance.md`（先创建大纲） | 冻结 Case 列表（overlay report / render_output 组合 / composite flag / 熔断）与证据模板 | 后续任务可映射到 Case ID，且证据目录规范固定 |
| R18-CAPTURE-A-01 | Phase A | 新增 Query 契约（overlay report） | `sidecar/src/mcp/commands/get_ui_overlay_report/validator.js`（新增）、`sidecar/src/mcp/commands/get_ui_overlay_report/handler.js`（新增）、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.UiVision.cs`、相关 tests | MCP 工具 `get_ui_overlay_report` 对外可用（纯读），并固化 `recommended_capture_mode` 枚举（`render_output/composite/structural_only`） | tools/list 与 schema parity 一致；非法 payload 在 L2 fail-closed；值域稳定 |
| R18-CAPTURE-A-02 | Phase A | L3 Overlay 结构化读取 | `Assets/Editor/Codex/Infrastructure/Read/UiOverlayReportReadService.cs`（新增）、`Assets/Editor/Codex/Infrastructure/Queries/Handlers/GetUiOverlayReportQueryHandler.cs`（新增）、`Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`（最小接线）、相关 tests | 返回 `overlay_canvases/coverage/interactable_count/diagnosis_codes/recommended_capture_mode` | Overlay 诊断可稳定输出；执行后 scene 不脏、不写入任何对象 |
| R18-CAPTURE-A-03 | Phase A | 反馈语义收口 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、相关 tests | 为“render_output 不含 Overlay UI”提供稳定建议模板 | LLM 收到明确建议：先查 `get_ui_overlay_report`，再决定是否启用 composite |
| R18-CAPTURE-B-01 | Phase B | 联合诊断脚本 | `sidecar/scripts/diagnose-capture.js`、`sidecar/scripts/README.md`、`Assets/Docs/Codex-Unity-MCP-Main-Index.md`（必要时） | 统一输出 `get_ui_tree + render_output + get_ui_overlay_report + validate_ui_layout` 报告 | 一条脚本命令可复现诊断；报告含 Overlay 覆盖与结构化摘要 |
| R18-CAPTURE-B-02 | Phase B | visual_evidence 协议字段 | `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.UiVision.cs`、`Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、相关 tests | 在 `capture_scene_screenshot.data` 中新增 `visual_evidence`（`artifact_uri/pixel_hash/diff_summary`，可空） | MCP 响应可直接消费视觉证据摘要；无脚本依赖 |
| R18-CAPTURE-B-03 | Phase B | L3 操作回执收集 | `Assets/Editor/Codex/Infrastructure/Write/WriteReceiptService.cs`（新增）、`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`、相关 tests | 写操作成功回包附带 `write_receipt`（scene diff/属性摘要） | LLM 可直接判断“操作是否生效”；失败场景也有最小回执 |
| R18-CAPTURE-B-04 | Phase B | L2 回执透传与格式化 | `sidecar/src/application/turnService.js`、`sidecar/src/application/unityDispatcher/reportBuilder.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、相关 tests | 将 `write_receipt` 统一透传 MCP 回包并压缩摘要格式 | MCP write 工具回包结构稳定；不破坏既有字段 |
| R18-CAPTURE-B-05 | Phase B | Console 日志快照集成 | `Assets/Editor/Codex/Infrastructure/Write/WriteReceiptService.cs`、`Assets/Editor/Codex/Application/*`（必要时）、相关 tests | 在回执中附带操作窗口期 `console_snapshot` | 可定位写后错误；日志窗口有边界且可配置 |
| R18-CAPTURE-B-06 | Phase B | 截图体积控制策略 | `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、`Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`、相关 tests | 默认 1280x720；`inline_base64` 优先 JPEG（默认质量 75）；新增 `max_base64_bytes` 超限自动切 `artifact_uri` | Base64 体积可控；超限稳定降级且回包语义清晰 |
| R18-CAPTURE-B-07 | Phase B | 基线契约冻结 | `sidecar/src/mcp/commands/capture_scene_screenshot/*`、`sidecar/tests/application/*capture*.test.js`、`Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceScreenshotTests.cs` | 在 composite 未启用前，`capture_scene_screenshot` 仍 `render_output-only` | 不发生“隐式解禁”；`final_pixels/editor_view` 仍返回禁用错误 |
| R18-CAPTURE-C-00 | Phase C | composite mini-design | `docs/V1-CAPTURE-Composite-Mode-Mini-Design.md`（新增） | 固化 `capture_mode=composite` 语义、标签、开关、熔断策略、兼容矩阵（Unity 版本/渲染管线） | 评审通过后进入 C-01 ~ C-04；熔断阈值量化 |
| R18-CAPTURE-C-01 | Phase C | L2 composite 双开关接线 | `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、`sidecar/src/mcp/commands/legacyCommandManifest.js`、`sidecar/src/index.js`（或配置入口）、相关 tests | `composite` 仅在 flag 开启时允许进入 Unity；关闭时返回 `E_CAPTURE_MODE_DISABLED` | L2 开关行为稳定；manifest 文案诚实标注“诊断合成语义” |
| R18-CAPTURE-C-02 | Phase C | L3 PlayMode composite 路径 | `Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`、`Assets/Editor/Codex/Infrastructure/Read/UnityRagReadService.ScreenshotHelpers.cs`（或新增 helper）、`Assets/Editor/Codex/Domain/Contracts/SidecarContracts.UiVision.cs`、相关 tests | Play Mode 下优先走 `ScreenCapture.CaptureScreenshotAsTexture()` | Play Mode composite 出图成功；诊断标签含 `COMPOSITE_RENDER/PLAYMODE_CAPTURE` |
| R18-CAPTURE-C-03 | Phase C | composite 熔断与观测 | `sidecar/src/application/mcpGateway/metricsView.js`、`sidecar/src/application/*`（capture 指标聚合）、相关 tests | 连续 3 次黑图/异常触发熔断，60 秒后自动探测恢复；降级打 `COMPOSITE_FUSED` 标签 | 熔断可触发、可恢复、可观测；不影响主读链路可用性 |
| R18-CAPTURE-C-04 | Phase C | 并发与重入保护 | `Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、相关 tests | composite 请求互斥执行，重入返回 `E_COMPOSITE_BUSY` | 并发场景不出现资源冲突或临时场景干扰 |
| R18-CAPTURE-D-01 | Phase D | EditMode TempScene Clone 合成 | `Assets/Editor/Codex/Infrastructure/Read/OverlayCompositeCaptureService.cs`（新增）、`Assets/Editor/Codex/Infrastructure/Read/ScreenshotReadService.cs`、`Assets/Editor/Codex/Application/*`（启动清理钩子，必要时）、相关 tests | Edit Mode 下 `composite` 走 Additive TempScene clone 渲染，并在异常中断后清理残留临时场景 | 标准场景出图成功，active scene `isDirty` 不变化，且无残留 temp scene |
| R18-CAPTURE-D-02 | Phase D | ExecuteAlways/组件防线 | `OverlayCompositeCaptureService.cs`、`SidecarContracts.UiVision.cs`（必要时返回策略字段）、相关 tests | clone 后仅保留/启用安全 UI 渲染组件，危险脚本默认禁用 | 不触发项目脚本副作用；失败时返回稳定受限错误码 |
| R18-CAPTURE-D-03 | Phase D | 诚实回包与降级语义 | `ScreenshotReadService.cs`、`sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、相关 tests | composite 回包显式包含策略标签与 fallback 信息 | LLM 可区分“合成诊断图”与“真实屏幕像素” |
| R18-CAPTURE-QA-01 | Phase E | Sidecar 回归 | `sidecar/tests/application/*capture*.test.js`、`sidecar/tests/domain/*` | 新增/改造 case 全绿（overlay report、flag、熔断、错误反馈） | Node CI 全绿；capture 相关契约快照稳定 |
| R18-CAPTURE-QA-02 | Phase E | Unity 回归 | `Assets/Editor/Codex/Tests/EditMode/*Screenshot*.cs`、`*Ui*Report*.cs`（新增） | EditMode +（可用时）PlayMode 关键路径回归 | 编译 + 关键测试全绿；无读链路污染 |
| R18-CAPTURE-E2E-01 | Phase E | 验收文档收口 | `docs/Phase18-V1-Capture-Acceptance.md`、`Assets/Docs/evidence/phase18/*` | 固化端到端验收：overlay report → render_output → composite（按 flag） | 按文档可重复完成验收，且证据可审计 |

---

## 3. 阶段入口与退出条件

### 3.1 Phase A 入口条件
- `R17-POLISH` 已完成收口，`docs/Phase17-V1-Polish-Acceptance.md` sign-off 全勾选。
- 当前分支可稳定运行 `npm --prefix sidecar test`。
- `capture_scene_screenshot(render_output)` 基线可用且禁用模式行为稳定。

### 3.2 Phase A 退出条件
- `get_ui_overlay_report` 工具可用，schema/validator/handler 三方一致。
- overlay 报告可输出覆盖率、关键节点摘要、诊断建议。
- 读链路不引入 scene 脏标记。

### 3.3 Phase B/C 退出条件
- 联合诊断脚本可稳定复现并落盘证据。
- `write_receipt` 与 `visual_evidence` 在 MCP 常规回包可读可审计。
- 截图体积控制策略生效，inline 超限自动降级 artifact。
- `composite` 在 L2/L3 双开关下受控可用；关停时 fail-closed。
- Play Mode composite 可用，异常可自动熔断降级。

### 3.4 Phase D/E 退出条件
- Edit Mode TempScene clone 合成在基准场景可用且无 live scene 污染。
- `test:r18:qa`（待新增）与全量回归通过。
- Phase18 验收文档完成并附证据清单。

---

## 4. 技术约束与统一规范

- `final_pixels` 与 `editor_view` 继续禁用；新增能力使用 `capture_mode=composite`，语义为“诊断合成图”。
- 禁止 OS 桌面前台读屏；截图来源仅允许 Unity 引擎内路径。
- 读链路默认零写操作：Phase A/B/C 不允许修改 live scene 对象状态。
- 操作回执（ROADMAP 4.2）为独立交付，不依赖 composite 开关状态。
- `capture_scene_screenshot` 回包需包含 `visual_evidence` 字段（允许为 null，但字段语义固定）。
- composite EditMode 实现必须走 TempScene clone 隔离，不允许 live canvas 劫持 + Undo 回滚作为主路径。
- `composite` 必须 L2/L3 双开关独立校验，任何一侧关闭都返回禁用错误。
- `composite` 必须具备互斥保护；并发请求返回 `E_COMPOSITE_BUSY`。
- 所有降级/熔断都必须在回包提供 `capture_mode_effective/fallback_reason/diagnosis_tags`。
- `inline_base64` 必须受体积预算控制（默认 JPEG + `max_base64_bytes`，超限切 artifact）。
- 错误码需接入 `mcpErrorFeedback`，并给出可恢复建议（例如回退 `render_output + get_ui_overlay_report`）。
- 读链路新增字段不得破坏既有 `read_token` 与 `captured_at` 契约语义。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| Overlay 报告与真实视觉存在差距 | LLM 误判可见性 | 返回结构化 `diagnosis_codes` + `recommended_capture_mode`，禁止仅返回自由文本 |
| 操作回执日志窗口过大 | 回包膨胀/信息噪声 | 固定日志窗口（时间 + 条数 + 字节）并支持摘要压缩 |
| Play Mode composite 受运行状态影响 | 可用性波动 | flag + 明确错误码，失败自动回退 `render_output` |
| TempScene clone 触发脚本副作用 | 编辑器污染/稳定性下降 | 组件白名单 + 危险脚本禁用 + `HideFlags` + 独立测试场景回归 |
| TempScene 异常中断残留 | 下次启动污染与提示弹窗 | `finally` 关闭 + 启动清理钩子双保险 |
| composite 连续失败拖慢链路 | 诊断体验下降 | 熔断阈值 + 冷却恢复 + metrics 可观测 |
| 大分辨率截图导致卡顿 | 时延超标 | 默认 1280x720、上限约束、artifact 优先输出 |

---

## 6. 阶段映射与状态跟踪（R18-CAPTURE）

| 阶段 | 阶段ID 范围 | 目标 | 状态 |
|---|---|---|---|
| Phase A | `R18-CAPTURE-E2E-00 ~ A-03` | Overlay 结构化基线 | ✅ 已完成 |
| Phase B | `R18-CAPTURE-B-01 ~ B-07` | 组合诊断 + 操作回执 + visual_evidence + 体积控制 | ✅ 已完成 |
| Phase C | `R18-CAPTURE-C-00 ~ C-04` | composite PlayMode 路径 + 双开关 + 熔断 + 互斥 | ✅ 已完成 |
| Phase D | `R18-CAPTURE-D-01 ~ D-03` | composite EditMode TempScene 路径 | ✅ 已完成 |
| Phase E | `R18-CAPTURE-QA-01 ~ E2E-01` | QA 与验收收口 | ✅ 已完成（`docs/Phase18-V1-Capture-Acceptance.md` 收口） |

---

## 7. 评审与推进机制（给 Cursor 方案评审员）

每一阶段提交时，PR 说明必须包含：
1. 对应 `任务ID` 列表（仅允许同阶段 ID）。  
2. 变更文件清单与风险说明。  
3. 自动化测试结果（Sidecar / Unity 分开列）。  
4. 开关状态与熔断状态说明（若涉及 composite）。  
5. 未完成项与下一阶段切换条件。  

推荐节奏：  
- 优先完成 `Phase A/B`（零风险可上线），再推进 `Phase C/D`（风险递增）。  
- `Phase C/D` 每个任务必须包含显式回退方案（flag 关停路径）。  
- 阶段通过后，在 `ROADMAP.md` 更新状态，再进入下阶段。  

---

## 8. 当前建议起步任务

建议从 `Phase A` 开始，顺序固定：
1. `R18-CAPTURE-E2E-00`（先冻结验收大纲，已完成）
2. `R18-CAPTURE-A-01`（`get_ui_overlay_report` 契约）
3. `R18-CAPTURE-A-02`（L3 overlay 报告读取实现）
4. `R18-CAPTURE-A-03`（错误反馈与提示模板收口）

完成 `Phase A` 后，再开启 `Phase B`。  
