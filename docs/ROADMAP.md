# UnityAI 产品路线图

版本：v1.0  
更新时间：2026-03-02  
定位：全局视角的阶段规划与优先级排序，后续每个阶段单独产出详细设计文档

---

## 0. 愿景与分层目标

### 核心愿景

让 Cursor 通过 MCP 协议安全、高效地驱动 Unity Editor，覆盖 80%+ 的原生编辑操作，并提供可扩展的插件化能力让第三方项目接入。

### 产品分层

| 层级 | 名称 | 目标 | 状态 |
|------|------|------|------|
| V1-BASE | 三层混合底座 | 原语 + 泛化 + 专科三层能力栈，覆盖场景编辑核心操作 | ⚠️ 主体完成，有缺口 |
| V1-VISION | 结构化视觉 | UI 树/命中/验证/写入闭环，不依赖截图 | ✅ 已完成主体 |
| V1-POLISH | 泛化层打磨 | 补齐缺失类型、效率优化、LLM 友好度提升 | 🔜 下一阶段 |
| V1-CAPTURE | 截图诊断能力 | 离屏截图 + 操作回执，辅助运行时问题定位 | 🔜 下一阶段 |
| V2-SELFUPGRADE | Cursor 自升级 | Cursor 自主生成/注册 Action Handler 补全缺失能力 | 📋 规划中 |
| V2-PLUGIN | 第三方工具接入 SDK | 项目方通过极简 API 注册 Editor 工具为 MCP Action | 📋 规划中 |
| V2-KNOWLEDGE | 项目知识库 | 项目级配置/组件目录/LLM Hint，减少运行时查询 | 📋 规划中 |

---

## 1. 当前基线（已完成清单）

以下是截至 2026-03-02 已完成并通过验证的能力面。

### 1.1 三层混合架构底座（V1-BASE）

**Phase 0 — 基础设施护航** ⚠️ 主体完成，原子覆盖有缺口
- ✅ 外部协议收口：`action_data_json` / `action_data_marshaled` 对 LLM 完全隐藏
- ✅ L2→L3 线缆升级：`action_data_marshaled`（base64url）主链路 + `action_data_json` 回退双栈
- ✅ 原子测试基座：`AtomicActionTestBase` 覆盖成功/回滚/fail-closed 三类断言
- ✅ 门禁脚本：`r16-wire-guard.js` 可检查线缆外泄 + 原子覆盖缺口
- ⚠️ 原子覆盖缺口：`gate:r16-wire` 当前报告 atomic coverage ≈ 24/41，需在 V1-POLISH 中补齐

**Phase 1 — 泛化层** ⚠️ 主体完成，缺失 `bool` 类型与数组操作增强
- ✅ 泛化写 `set_serialized_property`：支持 integer/float/string/enum/vector2/vector3/color/array/object_reference
- ❌ 缺失 `bool` kind 写入分支（`SerializedPropertyActionHandler.TryApplyPatch` 无 boolean 分支）
- ✅ 泛化读 `get_serialized_property_tree`：支持 depth/page/budget 懒加载 + truncated/next_cursor 分页
- ✅ ObjectReference 双路径解析：scene_anchor + asset_guid/asset_path/sub_asset_name

**Phase 2 — 高频原语层** ✅
- 20 个核心原语全部注册：create_object / destroy_object / rename_object / set_active / set_parent / set_sibling_index / duplicate_object / set_local_position / set_local_rotation / set_local_scale / set_world_position / set_world_rotation / reset_transform / set_rect_anchored_position / set_rect_size_delta / set_rect_pivot / set_rect_anchors / add_component / remove_component / replace_component
- 旧命名保留为 deprecated alias（create_gameobject → create_object 等）
- UI 写入原语：set_ui_image_color / set_ui_image_raycast_target / set_ui_text_content / set_ui_text_color / set_ui_text_font_size / set_layout_element / set_canvas_group_alpha

**Phase 3 — 专科层首批** ✅
- `validate_ui_layout`：支持专科增强模式（include_repair_plan / specialist_summary / repair_plan）
- L3 UiLayoutReadService 输出问题列表 + 修复建议，L2 fallback 兜底

### 1.2 结构化视觉闭环（V1-VISION）

- `get_ui_tree`：结构化 UI 树（含 rect_screen_px / interaction / text_metrics / runtime_resolution）
- `hit_test_ui_at_viewport_point`：viewport 坐标命中栈（含 scope-canvas 绑定 / clamp / approximate 标记）
- `validate_ui_layout`：多分辨率布局验证（OUT_OF_BOUNDS / OVERLAP / NOT_CLICKABLE / TEXT_OVERFLOW + budget 截断）
- `set_ui_properties`：字段级 UI 写入接口（映射到现有 action 链，支持 atomic / dry_run）

### 1.3 基础截图能力

- `capture_scene_screenshot`：Camera 离屏渲染截图（render_output 模式），支持 Game/Scene 视角
- 诊断字段：pixel_sanity / camera_used / diagnosis_tags

### 1.4 基础设施

- OCC 乐观并发控制（read_token + scene_revision + TTL）
- 双锚点定位（write_anchor + target_anchor / parent_anchor）
- Job 状态机（queued → pending → succeeded/failed，含 domain reload 恢复）
- 复合动作（composite_visual_action，含 alias 引用 + 原子回滚）
- 统一错误反馈（MCP_ERROR_FEEDBACK_TEMPLATES + suggestion + recoverable）

---

## 2. 🚨 立即修复清单（Release Blocker）

以下问题为**发布阻断条件**，必须在开始任何新功能开发之前修复。

| # | 问题 | 影响 | 定位文件 | 状态 |
|---|------|------|---------|------|
| HOT-001 | `bool` kind 缺失 | `set_serialized_property` 无法写入 boolean 字段（如 `enabled`、`raycastTarget` 等高频属性） | `SerializedPropertyActionHandler.cs` L146-L347 + `sidecar validator ALLOWED_VALUE_KINDS` | ❌ 待修复 |
| HOT-002 | `CloneAction` 遗漏 `action_data_marshaled` | `composite_visual_action` 步骤克隆时丢失 marshaled 数据，导致 L3 回退到 `action_data_json` 解析路径，线缆升级形同虚设 | `BuiltInVisualActionHandlers.cs` L15-L28 | ❌ 待修复 |
| HOT-003 | `max_patches_per_action` 无硬限制 | 恶意或失控的 LLM 可发送超大 patch 数组，导致 L3 长时间阻塞 | `SerializedPropertyActionHandler.cs` + `sidecar validator` | ❌ 待修复 |

---

## 3. 近期阶段：V1-POLISH（泛化层打磨）

**目标**：让泛化层从"能用"变成"好用"，降低 LLM 使用泛化层的调用次数和出错率。

**优先级**：🔴 高（直接影响 LLM 操作效率，是后续所有能力的根基）

### 3.1 补齐缺失类型支持（Release Blocker 级别）

| 缺失项 | 说明 | 优先级 |
|--------|------|--------|
| `bool` kind | `SerializedPropertyActionHandler` 中缺少 boolean 写入分支（见 HOT-001） | 🚨 Release Blocker |
| `Quaternion` / `Vector4` | Unity 常用类型，rotation 底层为 Quaternion | P1 |
| `Rect` | RectOffset 等 Unity 内建结构体 | P2 |
| `AnimationCurve` | 受限只读策略，至少返回 `E_PROPERTY_TYPE_UNSUPPORTED` | P2 |

### 3.2 数组操作增强

当前数组只支持 `arraySize` 设置。需要补齐：
- `insert`：在指定 index 插入元素
- `remove`：删除指定 index 元素（先高索引后低索引策略）
- `clear`：清空数组

### 3.3 dry_run 能力升级

**当前行为**：`dry_run` 仅在 Sidecar 层（L2）做短路式跳过——若 `dry_run=true`，Sidecar 不向 Unity 提交 task，仅返回 `planned_actions_count + mapped_actions`。L3 侧 `SerializedPropertyActionHandler` 无任何 dry_run 感知。

**目标行为**：升级为 **L3 per-patch 验证回执**：
- `dry_run=true` 时，L3 实际执行全部校验流程（`FindProperty` → 类型匹配 → 可写性检查），但不调用 `ApplyModifiedProperties`
- 返回每个 patch 的验证结果摘要（`patch_index` / `status` / `error_code`）
- LLM 可用此机制在正式写入前"试探"操作是否可行，减少回滚概率

### 3.4 Patch 数量与安全限制

- 增加 `max_patches_per_action` 限制（建议 64）（见 HOT-003）
- 高风险类型受限策略：`ManagedReference` 只读不写

### 3.5 原子覆盖补齐

当前 `gate:r16-wire` 报告 atomic coverage ≈ 24/41，需补齐缺失的 ~17 个 action 的 `AtomicActionTestBase` 子类。

### 3.6 LLM 友好度提升（property tree hint）

在 `get_serialized_property_tree` 返回中增加 hint 字段：
- `common_use`：标记常用字段（如 m_Color / m_FontSize / m_Text）
- `llm_hint`：根据组件类型和字段路径自动生成的自然语言提示
- 减少 LLM 查看 property tree 后的理解成本和试错次数

---

## 4. 近期阶段：V1-CAPTURE（截图诊断增强）

**目标**：让 Cursor 能通过截图理解运行时状态，辅助问题定位和操作验证。明确定位：**不是让 Cursor 设计 UI**，而是结合运行时的报错、状态来诊断问题。

**优先级**：🟡 中（V1-POLISH 之后，或可与 V1-POLISH 并行）

### 4.1 截图能力稳定化

- 当前 Camera 离屏渲染路径已可用，需进一步稳定化
- 补齐 UI Overlay 截图能力（Canvas ScreenSpaceOverlay 在 Camera 渲染中不可见的问题）
- 优化截图分辨率与 base64 体积控制

### 4.2 操作回执机制

在 Cursor 执行操作后，自动生成一份"操作回执"供 Cursor 自我验证：
- 操作前后的 Hierarchy 结构差异（Scene Diff）
- 关键属性变化摘要
- Console 错误日志快照
- 可选：操作前后截图对比

### 4.3 截图 + 结构化数据融合

- 截图标注：在截图上叠加 anchor / bounding box 信息
- `visual_evidence` 字段：artifact_uri / pixel_hash / diff_summary
- 组合策略：先结构化定位（get_ui_tree / hit_test / validate）→ 再截图确认

---

## 5. 中期阶段：V2-SELFUPGRADE（Cursor 自升级模块）

**目标**：当 Cursor 遇到现有 Action/Query 无法覆盖的操作时，能自主生成新的 Handler 代码来补全能力。

**优先级**：🟢 中（V1 稳定后启动）

### 5.1 设计原则

- **代码生成 + 人工确认**，而非全自动：安全第一
- 新 Handler 代码写入待审区 → 用户确认 → 编译注册 → 域重载 → 可用
- 生成的代码必须继承标准基类，遵循现有 Action Handler 模式

### 5.2 核心能力

| 能力 | 说明 |
|------|------|
| 缺失检测 | Cursor 调用 `get_action_catalog` 发现目标操作不在已注册列表中 |
| 模板生成 | 基于标准 Handler 模板 + 目标 API 签名，自动生成 C# Handler 代码 |
| 沙箱验证 | 生成的代码在写入正式目录前，先做语法检查和基本测试生成 |
| 审批流程 | 弹窗或日志提示用户确认，用户可修改后再接受 |
| 编译监控 | 监控域重载过程，编译失败则自动回退（删除生成的文件） |
| 能力缓存 | 成功注册的 Handler 持久化到项目中，下次打开项目自动可用 |

### 5.3 关键风险与对策

| 风险 | 对策 |
|------|------|
| 生成的代码编译失败 | 自动删除 + 通知 Cursor 重试或放弃 |
| 域重载中断工作流 | 批量生成（减少重载次数）+ 重载进度感知 |
| 生成的代码有安全隐患 | 限制可调用的 API 白名单 + 代码模板约束 |
| 多次试错导致体验差 | 限制单次会话的自升级重试次数 |

### 5.4 待定设计问题

- 生成的 Handler 代码放在哪个目录？（`Assets/Editor/Codex/Generated/` vs 用户可配置）
- 是否需要一个"临时能力"机制（不持久化，仅本次会话有效）？
- Sidecar 侧是否也需要自动生成 validator/handler？

---

## 6. 中期阶段：V2-PLUGIN（第三方 Editor 工具接入 SDK）

**目标**：让不同项目方能将自己的 Editor 工具/模块以最小成本注册为 MCP Action，赋予 Cursor 更大的操作能力。

**优先级**：🟢 中（与 V2-SELFUPGRADE 可并行设计）

### 6.1 设计原则

- **极简注册**：项目方不需要理解三层架构的内部细节
- **自动发现**：标注 Attribute 即可被自动扫描和注册
- **Schema 自动生成**：从方法签名和 Attribute 参数自动生成 MCP tool schema
- **安全隔离**：第三方代码运行在受限上下文中

### 6.2 目标注册形态（概念示例）

```csharp
[CodexAction("bake_lightmap", Description = "Bake lightmap for current scene")]
[CodexActionParam("quality", "string", "Bake quality: low/medium/high")]
public static CodexActionResult BakeLightmap(CodexActionContext ctx)
{
    var quality = ctx.GetParam<string>("quality", "medium");
    // ... 执行业务逻辑 ...
    Lightmapping.Bake();
    return ctx.Success("Lightmap baked with quality: " + quality);
}
```

### 6.3 核心能力

| 能力 | 说明 |
|------|------|
| Attribute 注册 | `[CodexAction]` + `[CodexActionParam]` 声明即注册 |
| 自动扫描 | `[InitializeOnLoad]` 启动时扫描所有程序集中的标注方法 |
| Schema 生成 | 从 Attribute 自动生成 `inputSchema` 供 LLM 使用 |
| Undo 集成 | 提供 `ctx.BeginUndo()` / `ctx.CommitUndo()` 简化 Undo 注册 |
| 错误规范 | 提供 `ctx.Fail("E_CUSTOM_ERROR", "message")` 标准化错误输出 |
| 能力上报 | 第三方 Action 自动出现在 `get_action_catalog` 结果中 |

### 6.4 待定设计问题

- 第三方 Action 是否要和内建 Action 在同一 Registry 中？还是独立 Registry？
- 如何处理第三方 Action 的 Undo 原子性？（强制 atomic 还是允许 non-atomic？）
- 如何处理版本兼容？（项目升级 Unity 版本后第三方 Action 可能失效）
- 是否需要提供一个测试框架让项目方验证自己的 Action？

---

## 7. 远期阶段：V2-KNOWLEDGE（项目知识库）

**目标**：减少 Cursor 每次操作前的探查成本，通过项目级知识库提供"预加载的上下文"。

**优先级**：🔵 低（可分两段推进，A 段不依赖 V2-PLUGIN）

### 7.1 Knowledge-A：内建能力知识（可先于 V2-PLUGIN 上线）

不依赖第三方插件，基于现有内建 Action/Query 能力：

| 类别 | 内容 | 来源 |
|------|------|------|
| 组件目录 | 项目中使用的自定义 MonoBehaviour 列表及其可编辑属性 | 自动扫描 |
| UI 规范 | 项目的 UI 设计规范（字体/颜色/间距/分辨率） | 手动配置 |
| Prefab 模板 | 常用 Prefab 的结构和用途说明 | 手动标注 / 自动提取 |
| 命名约定 | 项目的 GameObject / Component / 资源命名规范 | 手动配置 |
| 常见操作模式 | 项目中高频的操作模式（如"创建一个标准弹窗"） | 使用数据分析 |
| 错误模式库 | 已知的常见错误和修复方式 | 积累沉淀 |

### 7.2 Knowledge-B：第三方能力索引（依赖 V2-PLUGIN）

需要在 V2-PLUGIN 上线后才能推进：

| 类别 | 内容 | 来源 |
|------|------|------|
| 第三方 Action 目录 | 项目注册的自定义 MCP Action 列表及其 schema | V2-PLUGIN 自动发现 |
| 插件能力图谱 | 哪些 Editor 工具已接入、覆盖哪些操作域 | V2-PLUGIN registry |
| 跨插件工作流 | 组合多个插件 Action 完成复杂任务的模式 | 使用数据分析 |

### 7.3 加载策略

- 对话开始时加载一次项目知识库 → 作为 System Prompt 或 MCP Resource 注入
- 减少 Cursor 在每次操作前的 `get_scene_roots` / `get_serialized_property_tree` 调用次数
- 知识库可以是简单的 JSON 配置文件，放在项目根目录

---

## 8. 效率优化专题：泛化层调用链路优化

这是一个跨阶段的持续优化方向，直接影响用户体验。

### 8.1 问题本质

泛化层（`get_serialized_property_tree` → `set_serialized_property`）每次操作至少 2 次工具调用，复杂场景可能 5-10 次。相比原语层的 1 次调用，效率差距明显。

### 8.2 优化策略

| 策略 | 说明 | 阶段 |
|------|------|------|
| **频率驱动的原语提升** | 统计泛化层最常被使用的 property_path，高频的提升为原语 | V1-POLISH |
| **批量读取** | 一次 `get_serialized_property_tree` 调用支持多组件查询 | V1-POLISH |
| **LLM Hint** | property tree 返回中增加自然语言提示，减少 LLM 理解成本 | V1-POLISH |
| **操作回执** | 写操作返回变更摘要，减少写后验证读的需要 | V1-CAPTURE |
| **知识库预加载** | 项目级上下文减少探查调用 | V2-KNOWLEDGE |
| **意图推理** | LLM 表达高层意图 → 系统自动分解为操作序列 | 远期 |

### 8.3 指标体系与 SLO 目标

建议在 V1-POLISH 阶段引入以下指标（在 Sidecar 侧采集），**统计窗口默认 7 天滑窗**：

| 指标 | 说明 | SLO 目标 |
|------|------|---------|
| `generalized_write_total` / `primitive_write_total` | 泛化 vs 原语调用量对比 | 原语占比 ≥ 60%（热路径应走原语） |
| `property_path_frequency` | property_path 使用频率分布（用于指导原语提升） | Top-10 路径覆盖 ≥ 80% 调用量 |
| `avg_tool_calls_per_task` | 每个用户任务的平均工具调用次数 | ≤ 5 次/任务（简单任务 ≤ 3 次） |
| `write_rollback_rate` | 写操作回滚率（衡量 LLM 调用准确度） | ≤ 10%（M1 目标），≤ 5%（M2 目标） |
| `read_token_expiry_rate` | read_token 过期率（衡量操作链路是否太长） | ≤ 5% |
| `dry_run_usage_rate` | dry_run 被使用的比例（L3 升级后） | 观测即可，无硬目标 |
| `atomic_coverage_ratio` | `gate:r16-wire` 原子覆盖率 | 100%（Release Blocker） |

---

## 9. 推进顺序总览

```
已完成                    近期                         中期                      远期
──────────────────────────────────────────────────────────────────────────────────────
V1-BASE       ⚠️ ──┐
V1-VISION     ✅ ──┤
                   ├──▶ HOT-FIX ──▶ V1-POLISH  ──┐
                   │    (立即修复)    (泛化打磨)    ├──▶ V2-SELFUPGRADE ──┐
                   │                              │    (Cursor 自升级)    │
                   └──▶ V1-CAPTURE ───────────────┤                      ├──▶ Knowledge-B
                        (截图诊断)                │                      │    (第三方能力索引)
                                                  └──▶ V2-PLUGIN ────────┘
                                                  │    (第三方接入 SDK)
                                                  └──▶ Knowledge-A
                                                       (内建能力知识)
```

### 阶段依赖关系

- **HOT-FIX → V1-POLISH**：立即修复清单是 V1-POLISH 的前置条件
- V1-POLISH 不依赖 V1-CAPTURE，两者可并行
- V2-SELFUPGRADE 依赖 V1-POLISH（需要泛化层稳定为前提）
- V2-PLUGIN 依赖 V1-POLISH（Action 注册模式需要稳定）
- **Knowledge-A 不依赖 V2-PLUGIN**，可与 V2-PLUGIN 并行推进
- **Knowledge-B 依赖 V2-PLUGIN**（需要第三方 Action 目录）
- V1-CAPTURE 可在任何时候独立推进

### 里程碑与验收门禁

| 里程碑 | 标志性交付 | 预期效果 | 验收门禁（可执行命令） |
|--------|-----------|---------|---------------------|
| M0: 缺口清零 | HOT-001/002/003 修复 + 原子覆盖补齐 | V1-BASE 真正完成，无链路正确性问题 | `node sidecar/scripts/r16-wire-guard.js --strict-atomic` 全绿（coverage = 41/41） |
| M1: V1 稳定版 | V1-POLISH 完成 + V1-CAPTURE 基础可用 | Cursor 可高效地完成 80% 的 Unity 场景编辑任务 | `npm --prefix sidecar run test:r16:qa` 全绿 + Unity EditMode 全绿 + SLO 指标达标 |
| M2: 自升级 MVP | V2-SELFUPGRADE 核心流程跑通 | Cursor 遇到缺失能力时可自助补全 | 端到端演示：Cursor 生成 Handler → 编译通过 → Action 可调用 |
| M3: 平台化 MVP | V2-PLUGIN SDK 发布 | 第三方项目可接入自己的 Editor 工具 | 示例项目：3 个 `[CodexAction]` 注册 → `get_action_catalog` 可见 → 可执行 |
| M4: 智能化 | Knowledge-A/B + 意图推理 | Cursor 理解项目上下文，减少冗余探查 | `avg_tool_calls_per_task` ≤ 3（简单任务） |

---

## 10. 关键设计决策记录

| 编号 | 决策 | 理由 | 日期 |
|------|------|------|------|
| D-001 | 泛化层采用 `SerializedProperty` 而非逐 API 注册 | 边际成本极低，自定义组件天然支持 | 2026-03 |
| D-002 | 自升级模块走"代码生成 + 人工确认"而非全自动 | 安全性优先，避免编译失败阻塞工作流 | 2026-03 |
| D-003 | 截图定位为诊断辅助而非视觉设计 | LLM 做视觉设计不靠谱，但做问题诊断有价值 | 2026-03 |
| D-004 | 第三方接入走 Attribute 极简注册 | 降低项目方接入成本，不要求理解内部架构 | 2026-03 |
| D-005 | 频率驱动的原语提升策略 | 热路径用原语（1 次调用），长尾走泛化（2-3 次调用） | 2026-03 |
| D-006 | V1 结构化视觉不依赖截图 | 确定性数据链路优先，截图作为 V2 增强 | 2026-03 |

---

## 11. 风险登记簿

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| 泛化层调用效率不够好，用户体感慢 | 高 | 中 | 频率分层 + LLM Hint + 批量读取 |
| 自升级生成的代码编译失败阻塞工作流 | 高 | 中 | 沙箱验证 + 自动回退 + 重试次数限制 |
| 第三方 Action 的 Undo 安全性难保证 | 中 | 中 | 提供标准化 Undo Helper + 测试框架 |
| read_token TTL 对复杂多步操作不够用 | 中 | 低 | 支持 token 续期 / 自动重新获取 |
| 大场景下 property tree 查询性能瓶颈 | 中 | 低 | 已有 budget/pagination 机制，持续监控 |
| Unity 版本升级导致 SerializedProperty 行为变化 | 低 | 低 | 版本兼容测试 + 受限类型白名单 |

---

*本文档为全局路线图，各阶段的详细设计方案将在启动时单独产出。*
