# Codex-Unity MCP 截图能力收口与最小破坏清理蓝图（R11-CLOSE）
## 0. 目标与边界

### 0.1 本轮目标
1. 先止血：下线高风险截图链路（`final_pixels`、`editor_view`）的可执行能力，避免继续产出“黑图/截到非 Unity 窗口”。
2. 保兼容：尽量不破坏上层协议骨架与已接入流程，采用“接口保留 + 能力禁用”的 fail-closed 策略。
3. 可回开：保留诊断字段与模式语义框架，为后续重做离屏 final pixels 方案预留稳定契约。

### 0.2 本轮不做
1. 不在本轮重做跨窗口/跨显示器坐标映射。
2. 不在本轮实现真正可用的 `final_pixels`（离屏合成或 Editor 内最终像素管线）。
3. 不在本轮新增协议级 `diagnose_capture` 命令（仅通过 sidecar 脚本编排）。

### 0.3 不可退让约束
1. 写链路硬防线不受影响（OCC、双锚点、错误模板）。
2. 读链路仍需返回有效 `read_token`。
3. `capture_scene_screenshot` 诊断骨架字段不删除：`requested_mode`、`effective_mode`、`fallback_reason`、`diagnosis_tags`。

---

## 1. 收口策略（最小破坏）

### 1.1 核心决策
1. `capture_mode` 字段保留，不从协议中删掉。
2. `render_output` 保留为唯一可执行模式。
3. 请求 `final_pixels`/`editor_view` 时统一显式失败：`E_CAPTURE_MODE_DISABLED`（而不是静默 fallback）。
4. `hit_test_ui_at_screen_point` 先禁用（返回 `E_COMMAND_DISABLED`），保留最小 stub 与错误模板，避免后续重启时从零接线。
5. `diagnose-capture.js` 保留并改造为“基线诊断脚本”：只验证 `render_output + get_ui_tree`。

### 1.2 为什么不用“直接删字段/删命令”
1. 直接删 `capture_mode` 会导致上层 schema 断裂、历史脚本立刻报错。
2. 直接删除 `hit_test` 命令会损失可观测入口，后续恢复成本高。
3. 本轮目标是稳态收口，不是彻底废案。

---

## 2. 目标状态（收口后）

### 2.1 工具行为
1. `capture_scene_screenshot`
   - 支持：`capture_mode=render_output`
   - 禁用：`capture_mode=final_pixels|editor_view` -> `E_CAPTURE_MODE_DISABLED`
   - 仍返回：`requested_mode/effective_mode/fallback_reason/diagnosis_tags/pixel_sanity/camera_used`
2. `hit_test_ui_at_screen_point`
   - 统一返回 `E_COMMAND_DISABLED`
   - suggestion 指向 `get_ui_tree + render_output` 验证路径

### 2.2 实现约束
1. Unity 侧截图执行路径只允许 `Camera.Render -> RenderTexture`。
2. 屏幕读像素、窗口坐标映射、EditorView 读屏路径全部关停或删除。
3. 仍保留 artifact 写盘和自动清理机制。

---

## 3. 文件级删改清单（执行前清点）

| 分类 | 操作 | 文件 | 说明 |
|---|---|---|---|
| L2 | 改 | `sidecar/src/mcp/commands/capture_scene_screenshot/validator.js` | 保留 `capture_mode` 字段校验；允许传值但不在此处吞掉禁用语义 |
| L2 | 改 | `sidecar/src/mcp/commands/capture_scene_screenshot/handler.js` | 对 `final_pixels/editor_view` 返回 `E_CAPTURE_MODE_DISABLED`；保留诊断字段透传 |
| L2 | 改 | `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js` | 改为统一 disabled stub |
| L2 | 改 | `sidecar/src/mcp/commands/index.js` | tool 描述更新为“render_output-only（其余模式已禁用）” |
| L2 | 改 | `sidecar/src/application/turnPolicies.js` | 新增 `E_CAPTURE_MODE_DISABLED`、`E_COMMAND_DISABLED` 建议模板 |
| L2 | 改 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 同步错误码模板映射，确保 LLM 反馈友好 |
| L2 | 改（可选） | `sidecar/src/mcp/mcpServer.js` | 可选择隐藏 `hit_test` 工具；若不隐藏则走 disabled stub |
| L2 | 改（可选） | `sidecar/src/ports/contracts.js` | 若隐藏 `hit_test`，同步合同清单；否则保持不变 |
| L3 | 改 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | 关停 `final_pixels/editor_view` 分支与屏幕坐标映射链路 |
| L3 | 改 | `Assets/Editor/Codex/Application/ConversationController.cs` | `hit_test_ui_at_screen_point` 入口改为 disabled 回执或路由到 stub |
| L3 | 改（若字段变更） | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 仅在回包字段必要调整时改动；默认保持稳定 |
| Script | 删 | `sidecar/scripts/verify-final-pixels-mode.ps1` | 当前语义已失效，删除防误用 |
| Script | 改 | `sidecar/scripts/diagnose-capture.js` | 改为 render_output 基线诊断，移除 final_pixels/hit_test 依赖 |
| Test | 改 | `sidecar/tests/application/*capture*` | final/editor 期望改为 disabled |
| Test | 改 | `Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceScreenshotTests.cs` | 禁用模式测试改为断言 `E_CAPTURE_MODE_DISABLED` |
| Test | 改 | `Assets/Editor/Codex/Tests/EditMode/UnityVisualReadChainTests.cs` | 从“可fallback”改为“禁用模式必失败、render_output必可用” |
| Doc | 改 | `Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md` | 以 render_output 基线为验收标准，移除 final_pixels 成功前提 |

---

## 4. 分阶段任务矩阵（R11-CLOSE）

### 4.1 执行顺序
1. Phase A：接口收口（先禁用）
2. Phase B：实现清理（再删除高风险路径）
3. Phase C：脚本/测试/文档收口（最后固化）

### 4.2 任务矩阵

| 任务ID | 阶段 | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|---|
| R11-CLOSE-L2-01 | Phase A | capture 接口收口 | `sidecar/src/mcp/commands/capture_scene_screenshot/handler.js`、`.../validator.js` | 非 `render_output` 统一返回 `E_CAPTURE_MODE_DISABLED` | 请求 `final_pixels/editor_view` 不再进入 Unity 高风险实现 |
| R11-CLOSE-L2-02 | Phase A | 错误反馈收口 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 新增禁用错误码与恢复建议 | LLM 收到可执行建议而非未知错误 |
| R11-CLOSE-L2-03 | Phase A | hit_test 收口 | `sidecar/src/mcp/commands/hit_test_ui_at_screen_point/handler.js`、`sidecar/src/mcp/commands/index.js` | 命令禁用 stub（或隐藏） | hit_test 不再产生误导性“命中失败” |
| R11-CLOSE-L3-01 | Phase B | Unity 截图主路径固化 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | `CaptureSceneScreenshot` 强制 render_output-only | 不会再截到 Cursor/桌面窗口 |
| R11-CLOSE-L3-02 | Phase B | Unity 高风险实现清理 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | 删除/停用屏幕像素与窗口 rect 映射实现 | 代码中无活跃 `final_pixels/editor_view` 读屏逻辑 |
| R11-CLOSE-L3-03 | Phase B | 诊断骨架保留 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`（必要时） | 保留 `requested/effective/fallback/diagnosis_tags` 字段稳定性 | 上层协议不因收口破坏 |
| R11-CLOSE-ASSET-01 | Phase C | 脚本收口 | `sidecar/scripts/verify-final-pixels-mode.ps1`、`sidecar/scripts/diagnose-capture.js` | 删除失效脚本，改造基线诊断脚本 | 脚本输出与当前能力一致 |
| R11-CLOSE-QA-01 | Phase C | Sidecar 测试收口 | `sidecar/tests/application/*` | 更新模式断言与错误码断言 | CI 不再对禁用能力做错误成功预期 |
| R11-CLOSE-QA-02 | Phase C | Unity 测试收口 | `Assets/Editor/Codex/Tests/EditMode/*Screenshot*`、`*VisualReadChain*` | 调整 EditMode 断言 | 编译 + EditMode 全绿 |
| R11-CLOSE-E2E-01 | Phase C | 验收文档收口 | `Assets/Docs/Phase9-MCP-Command-Decoupling-Acceptance.md` | 固化“render_output + ui_tree”验收路径 | Cursor 测试按文档可重复通过 |

---

## 5. 验收标准（收口完成定义）

1. `capture_scene_screenshot` 的 `render_output` 稳定可用，返回有效图片与 `read_token`。
2. `final_pixels` 与 `editor_view` 均返回 `E_CAPTURE_MODE_DISABLED`，不存在静默降级。
3. `diagnosis_tags` 与 `fallback_reason` 语义仍可读，方便后续排障。
4. `hit_test_ui_at_screen_point` 不再作为有效生产能力对外宣称（禁用或隐藏一致）。
5. `verify-final-pixels-mode.ps1` 已删除，`diagnose-capture.js` 已改为基线脚本。
6. Phase9 验收文档已同步，避免“能力说明与实现不一致”。

---

## 6. 风险与缓解

### 6.1 主要风险
1. 上层仍传 `final_pixels`，短期失败率上升。
2. 旧测试脚本仍假设 final_pixels 可用，导致误报失败。
3. 运营/文档未同步会造成“用户以为可用但实际禁用”。

### 6.2 缓解措施
1. 在错误 suggestion 中明确“当前仅支持 render_output”。
2. 同步更新 tool 描述与 Phase9 验收手册。
3. 在 CI 增加“禁用模式断言”防止回退。

---

## 7. 回开计划（下一轮重建，不在本轮实现）

1. 基于离屏渲染重建 `final_pixels`，禁止依赖前台窗口读屏。
2. `hit_test` 改为与截图分辨率无关的统一坐标语义后再恢复。
3. 恢复前必须新增 E2E：Overlay UI 白块硬验收（可见 + 可命中 + 非黑图）。

