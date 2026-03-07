# MCP工具开发痛点记录

日期：2026-03-06  
状态：阶段性完成（第一组/第二组已完成，体验优化进行中）
最后更新：2026-03-08

---

## 痛点1：两步式操作的Token失效问题

### 问题描述

在执行需要多步操作的任务时，第一步写操作（如`create_object`）会改变场景版本（`scene_revision`），导致旧的token立即失效。必须重新获取token才能执行后续操作，增加了不必要的往返通信。

### 典型场景

**示例：创建对象并设置属性**
1. 获取token → 创建对象（成功，但场景版本变了）
2. 使用旧token执行后续操作 → `E_SCENE_REVISION_DRIFT` 失败
3. 重新获取token → 执行后续操作

**影响：**
- 增加了不必要的token获取步骤
- 增加了往返通信次数
- 降低了操作效率
- 容易出错（忘记重新获取token）

### 当前状态

- Token TTL是3分钟，时间足够
- 主要失效原因是`scene_revision`不匹配，不是时间过期
- 写操作不会自动返回新token（`read_token_candidate`为空）
- 必须手动调用读工具获取新token

---

## 痛点2：新增MCP指令需要手写和手动注册

### 问题描述

当前新增MCP工具需要多个手写步骤，未完全走SSOT流水线，存在大量重复劳动和耦合。

### 当前流程

新增一个MCP工具需要：

1. **SSOT字典**：在`ssot/dictionary/tools.json`添加工具定义
2. **编译产物**：运行`npm run ssot:build`生成L2/L3产物
3. **定义文件**：手写`sidecar/src/mcp/commands/definitions/<tool>.js`桥接文件
4. **Validator**：手写`sidecar/src/mcp/commands/<tool>/validator.js`（虽然可以从SSOT获取schema，但仍需手写文件）
5. **Handler**：手写`sidecar/src/mcp/commands/<tool>/handler.js`
6. **注册导入**：在`sidecar/src/mcp/commands/commandDefinitionManifest.js`手动添加导入（300+行）
7. **重启服务**：必须重启npm才能生效

### 存在的问题

- **Schema部分已解耦**：从SSOT生成，但定义文件仍需手写桥接代码
- **Handler/Validator未完全解耦**：仍需手写每个工具的处理逻辑
- **注册流程未自动化**：需要在manifest中手动添加导入
- **缺乏模板化**：每个工具都需要重复编写相似代码

### 代码重复度分析

经过代码检查发现，这些"手写"文件实际上**高度模板化**，只有极少数字段不同：

**1. 定义文件（definitions/*.js）**
- **重复度：90%+**
- 只有以下字段不同：
  - 工具名（`name`）
  - HTTP路径（`path`）
  - turnService方法名（`turnServiceMethod`）
  - fallback描述（`fallbackDescription`）
- 其他代码完全相同

**2. Validator文件（<tool>/validator.js）**
- **重复度：100%**
- 只有以下字段不同（**不是功能差异，只是命名差异**）：
  - `TOOL_NAME`常量（"add_component" vs "create_object"）
  - 函数名（`validateAddComponent` vs `validateCreateObject`）
- 验证逻辑完全相同：都是调用`getValidatorRegistrySingleton().validateToolInput(TOOL_NAME, payload)`
- **结论**：Validator文件没有功能差异，完全可以自动生成

**3. Handler（turnService.js中的方法）**
- **重复度：100%**
- 所有方法都是一行代码：
  ```javascript
  async xxxForMcp(body) {
    return this.dispatchSsotToolForMcp("tool_name", body);
  }
  ```
- 只有工具名不同

**结论**：这些文件都是**高度模板化的通用逻辑**，完全可以自动生成，不需要手写。

### 真正的功能逻辑位置

**L2 (Sidecar) 层**：
- Validator：只是调用SSOT schema验证，没有业务逻辑差异
- Handler：只是调用`dispatchSsotToolForMcp`，没有业务逻辑差异

**L3 (Unity) 层**：
- **真正的功能逻辑在Executor中**：`Assets/Editor/Codex/Infrastructure/Ssot/Executors/<Tool>SsotExecutor.cs`
- 例如：
  - `AddComponentSsotExecutor.cs`：解析组件类型、添加到GameObject、错误处理等
  - `CreateObjectSsotExecutor.cs`：根据object_kind创建不同类型的GameObject
- **这些Executor才是需要手写的业务逻辑**，每个工具有不同的Unity操作逻辑

**总结**：
- L2的文件（定义、Validator、Handler）都是模板代码，可以自动生成
- L3的Executor才是真正的功能差异点，需要手写业务逻辑

### 理想状态

完全走SSOT流水线，实现：
- **Handler/Validator自动生成或模板化**：基于SSOT定义自动生成或使用模板
- **注册流程自动化**：新增工具自动注册，无需手动修改manifest
- **完全解耦**：新增工具只需修改SSOT字典，其他步骤自动化完成

---

---

## 痛点3：实际使用体验问题（AI使用视角）

### 问题描述

从AI实际使用MCP工具的角度，存在以下影响效率和体验的问题：

### 具体痛点

**1. 查询次数过多**
- 需要多次查询才能获取完整信息（如分别查询x和y坐标）
- 无法一次性获取所需的所有信息
- 增加了往返通信次数和延迟

**2. 参数格式不确定**
- 有时候不确定参数的具体格式（如颜色值范围、坐标系统等）
- 需要查询SSOT字典才能确认，增加了额外步骤
- 工具定义中的参数说明可能不够详细

**3. 错误信息不够友好**
- Token失效时只返回错误码和简单消息，没有明确提示下一步该做什么
- 需要我"记住"token失效后要重新获取，容易忘记
- 错误信息缺乏可操作的指导

**4. 操作步骤繁琐**
- 创建对象并设置属性需要：获取token → 创建 → 获取新token → 设置属性
- 步骤多，容易出错
- 虽然可以用事务工具，但需要先创建对象获取object_id，无法完全在一个事务中完成

**5. 响应延迟感知明显**
- 每次调用都需要等待往返（MCP Client → Sidecar → Unity → 返回）
- 多个步骤串联时，总延迟累积明显
- **与写脚本的差异**：
  - 写脚本：可以一次性规划完整流程，脚本执行时串行但我不需要等待中间结果
  - MCP工具：必须分步调用，每次都要等待返回才能继续，无法一次性规划完整流程
  - 关键差异：**脚本是"规划-执行"分离，MCP是"规划-执行-等待-规划-执行"循环**

**6. 不确定操作顺序**
- 不确定哪些操作可以并行，哪些必须串行
- 不确定是否需要先查询再操作，还是可以直接操作
- 缺乏操作最佳实践的明确指导

**7. Token管理负担**
- 需要主动管理token的生命周期
- 写操作后需要"记住"重新获取token
- Token失效时没有自动重试机制

### 与写脚本的对比

**写脚本的优势：**
- 可以一次性规划完整流程，然后执行
- 不需要管理token，不需要等待中间结果
- 错误处理可以统一规划
- 执行时串行，但规划时可以并行思考

**MCP工具的劣势：**
- 必须分步调用，每次都要等待返回
- 需要管理token生命周期
- 无法一次性规划完整流程
- 每次调用都是"规划-执行-等待"的循环

**关键差异：**
- **脚本**：规划阶段可以完整思考，执行阶段串行但我不需要参与
- **MCP工具**：必须"规划-执行-等待-规划-执行"循环，每一步都需要我的参与和等待

### 影响

- **效率低**：多次往返、多次查询、步骤繁琐，无法一次性规划
- **易出错**：容易忘记重新获取token、参数格式错误
- **体验差**：响应慢、错误信息不友好、操作不直观，需要频繁等待和决策

---

## 后续计划

以上痛点待后续推动解决，当前先记录在此文档中。

---

## 2026-03-07 评审结论与执行决策单

### 一、痛点优先级（按“成功率/体验提升比”）
1. P0：Token自动化与错误可执行指引。
2. P1：参数不确定性收敛（高频工具的合法样例+反例内嵌）。
3. P1：查询成本压缩（减少重复schema查询）。
4. P2：事务编排体感优化（减少“规划-执行-等待”循环感）。
5. P3：外部文档优化（Cheat Sheet等）。

### 二、对 Gemini 评审的逐条判定

| 评审点 | 判定 | 原因 | 处理结论 |
|---|---|---|---|
| ROI排序思路正确 | 合理 | 当前核心目标是提升首次成功率并压低往返成本 | 采用 |
| 先保基础设施稳定，避免破坏OCC/门禁 | 合理 | 当前链路已有稳定约束，先做低风险改造更稳妥 | 采用 |
| P0优先做Token自动化+错误指引 | 合理 | 直接影响失败重试率与学习成本 | 采用 |
| P1优先做参数不确定性收敛 | 合理 | 高频错误集中在`$ref`、`property_path`、`component_type` | 采用 |
| P3文档降级（优先系统自解释） | 合理 | 自解释能力优先级高于外部文档堆叠 | 采用 |
| Token自动化改造侵入性高 | 部分合理 | 若改L3返回协议侵入性高；若L2基于`scene_revision`签发则中等 | 采用“先L2、后L3” |
| 每次写后L2自动补一次快照取token | 不合理 | 会固定增加RTT和token消耗，且可能引入时序漂移 | 不采用 |
| 避免新增batch接口，优先增强现有接口 | 部分合理 | 盲目加路由会膨胀；但若现有接口不足，仍可增量扩展 | 先增强现有接口 |
| 错误提示先做L2文本映射 | 基本合理 | 低风险高收益；但建议返回结构化字段而非纯文本 | 采用并结构化 |
| “第一刀零风险” | 不合理 | 仍可能影响`tools/list`体积、快照测试与提示行为 | 改口径为“低风险” |

### 三、可执行决策单（Do / Don’t / Observe）

**Do（本轮执行）**
- 在L2错误返回中补充结构化可执行指引（如`suggested_action`、`fix_hint`）。
- 在高频工具中补充最小合法样例与反例（事务、组件属性、序列化属性）。
- 优先增强现有`get_write_contract_bundle`，减少重复`get_tool_schema`查询。
- 保留并强化失败拦截策略：同类错误最多一轮定向修复重试。

**Don’t（本轮不做）**
- 不做“每次写后自动补一次快照”的L2代理方案。
- 不一次性引入多条新MCP路由（避免基础设施维护面膨胀）。
- 不在规则中继续堆固定行号和长文本指令（避免漂移与上下文膨胀）。

**Observe（观测后再决策）**
- 观测批量UI任务首次成功率、平均调用次数、重复错误率。
- 若仍高频出现`E_SCENE_REVISION_DRIFT`，再评估“写成功后token刷新”的最小侵入实现。
- 若schema查询仍占比过高，再评估是否增加batch查询能力。

### 四、推进顺序与验收标准

**阶段1（低风险）**
- 目标：先提升“错误可恢复性”和“参数首轮命中率”。
- 验收：批量UI任务首次成功率达到`>=85%`；同错误码连续重试不超过2次。

**阶段2（中风险）**
- 目标：评估并实施最小侵入的Token自动化策略。
- 验收：与阶段1相比，平均调用次数再下降`20%`以上。

### 阶段2执行状态（PR-8，2026-03-07）
**执行结果：已完成第一轮落地（L2 write-through token refresh）。**
1. 已实施：`dispatchSsotRequest` 在 **read/write 成功响应** 上统一基于 `scene_revision` 签发 L2 Authority token。
2. 已实施：不透传 L3 旧 `read_token_candidate`，统一替换为 L2 签发结果。
3. 已实施：不增加额外快照查询，不引入“每次写后自动补一次 read 请求”的 RTT 成本。
4. 已实施：写成功后响应可直接携带 `data.read_token_candidate`，用于下一次写操作连续提交。
5. 边界策略：若写响应缺失 `scene_revision`，则不签发新 token（保持 fail-safe，不猜测版本）。
6. 收口补强：L3 `SsotRequestDispatcher.Success` 统一兜底 `scene_revision`，避免单个写 executor 漏填导致 PR-8 失效。

**验证门禁（PR-8）**
1. `sidecar/tests/application/ssot-dispatch-token-issuance.test.js`
2. `sidecar/tests/application/ssot-write-token-auto-refresh.test.js`
3. `sidecar/tests/application/ssot-l2-closure-evidence.test.js`

**阶段3（优化）**
- 目标：根据观测决定是否补充batch查询或更高阶事务辅助能力。
- 验收：典型批量UI任务总调用次数稳定在`5-6`次区间。

---

## 第一组开发方案（落地版）：错误可执行指引 + 参数样例注入 + 合约查询收敛

> 设计原则：拒绝补丁式/最小改动式修复。  
> 执行策略：按职责重构模块边界，统一入口、统一数据源、统一输出协议。

### 1. 目标与范围

**第一组目标（一次完成）**
1. 错误返回从“文本建议”升级为“结构化可执行指引”。
2. 高频工具的参数不确定性收敛为“正例+反例+常见错误修复”。
3. `get_write_contract_bundle` 一次返回完成执行所需信息，减少重复 `get_tool_schema`。

**不在第一组范围**
1. Token自动刷新机制（第二组单独推进）。
2. 新增batch路由（先不扩基础设施面）。

### 2. 分层职责（L1 / L2 / L3）

#### L1（SSOT字典与编译产物）
职责：定义“工具契约元数据”，不承载运行时决策。

**新增/改造能力**
1. 在 `ssot/dictionary/tools.json` 为高频工具新增契约增强字段：
   - `usage_notes`：关键规则（如`$ref`别名字段、`m_`序列化路径）。
   - `examples_positive`：最小可执行正例（可直接粘贴）。
   - `examples_negative`：高频反例（如`container.object_id`、`spacing`）。
   - `common_error_fixes`：`error_code -> fix_hint/suggested_action`。
   - `related_tools`：该工具常配套查询工具（用于合约收敛）。
2. 扩展编译器输出，使上述字段进入L2产物（不手工写L2 JSON）。

**涉及文件**
1. `ssot/dictionary/tools.json`
2. `ssot/compiler/parser/validateDictionaryShape.js`
3. `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
4. `ssot/compiler/tests/emitMcpToolsJson.test.js`
5. `ssot/artifacts/l2/mcp-tools.generated.json`（由编译生成）

#### L2（Sidecar运行时与对外协议）
职责：消费L1产物，统一生成“可执行指导响应”；不再分散在多模块硬编码建议文本。

**新增模块（单一职责）**
1. `sidecar/src/application/ssotRuntime/contractAdvisor.js`
   - 输入：tool_name、静态工具目录
   - 输出：最小模板、必填字段、正反例、相关工具摘要
2. `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
   - 输入：error_code、tool_name、阶段上下文
   - 输出：`suggested_action`、`suggested_tool`、`fix_hint`、`retry_policy`

**重构模块（职责收敛）**
1. `staticContractViews.js`
   - `get_write_contract_bundle` 改为调用 `contractAdvisor` 统一组包。
   - 输出新增结构化字段：`common_mistakes`、`quick_fixes`、`related_contracts`。
2. `mcpErrorFeedback.js`
   - 统一接入 `errorGuidanceRegistry`，输出结构化可执行指引字段。
   - 保留原 `suggestion`，新增机器可消费字段，避免只靠自然语言。
3. `turnService.js`
   - 所有失败出口统一经过 `withMcpErrorFeedback`（收口错误协议）。
   - 避免一部分路径返回结构化，另一部分路径返回裸错误。

**涉及文件**
1. `sidecar/src/application/ssotRuntime/staticContractViews.js`
2. `sidecar/src/application/errorFeedback/mcpErrorFeedback.js`
3. `sidecar/src/application/turnService.js`
4. `sidecar/src/application/turnPolicies.js`（仅保留策略分类，不再承载大段指导文案）
5. 新增：
   - `sidecar/src/application/ssotRuntime/contractAdvisor.js`
   - `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`

#### L3（Unity执行层）
职责：维持稳定错误码与最小必要上下文，不承载L2指导文案。

**第一组改造边界**
1. 不改执行逻辑，不改token机制，不改事务算法。
2. 只做错误码一致性审计与补齐（确保L2可稳定映射）。

**涉及文件（审计/必要补齐）**
1. `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`
2. `Assets/Editor/Codex/Infrastructure/Ssot/Transaction/*.cs`
3. `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*SsotExecutor.cs`

### 3. 实施步骤（一步一交付）

#### Step G1-0：基线测量与口径固化
1. 固化第一组改造前基线样本（至少5类场景）：
   - 简单场景：单对象改色（1个工具调用）。
   - 中等场景：批量UI创建（3-5个工具调用）。
   - 复杂场景：事务创建+保存（6+个工具调用）。
   - 错误场景：故意触发常见错误（验证错误反馈链）。
   - 边界场景：极端参数或大量对象（验证性能与裁剪策略）。
2. 固化指标定义与统计方式：
   - 首次构造成功率：`一次提交即成功的任务数 / 总任务数`。
   - 平均查询调用次数：每任务 `get_* + get_tool_schema + get_write_contract_bundle` 调用总和均值。
   - 盲重试率：`无结构化建议字段即直接重试` 的次数占失败次数比例。
   - P95响应时间：`get_write_contract_bundle` 95分位延迟。
3. 将基线统计脚本和样本输入纳入测试仓，不允许“口头基线”。
4. 基线采集结果必须附带可复现元数据：
   - `git_commit`
   - `timestamp`
   - `scenario_name`
   - `seed/固定输入`
5. 样本代表性约束：
   - 每个场景样本数 `>=20`。
   - 至少覆盖3种不同工具组合。
   - 至少覆盖5种不同错误码。

**交付物**
1. 基线数据文件与统计脚本入库。
2. 第一组验收指标具备可追溯对照。
3. 任一指标均可回放到具体提交与样本输入。

#### Step G1-0.5：工具优先级判定（新增）
1. 基于 G1-0 基线数据计算工具优先级指标：
   - `call_ratio = 工具调用次数 / 总调用次数`
   - `error_ratio = 工具错误次数 / 总错误次数`
   - `score = call_ratio * 0.6 + error_ratio * 0.4`（默认权重，可配置）
2. 分层阈值：
   - P0（必须配置）：`score >= 0.10` 或 `error_ratio >= 0.15`
   - P1（建议配置）：`score >= 0.05` 或 `error_ratio >= 0.08`
   - P2（可选配置）：其余
3. 将 `tool_priority` 回写字典并锁定到本轮实施，不在运行时动态漂移。
4. 若基线样本与当前工具集不一致（新增/删除工具），先重采样再进入 G1-1。

**交付物**
1. P0/P1/P2 工具清单与评分明细入库。
2. G1-1 的覆盖范围有数据依据且可复现。

#### Step G1-1：L1契约元数据建模
1. 在字典中为以下工具补齐增强字段（按频率分层）：
   - 高频（必须）：
     - `execute_unity_transaction`
     - `create_object`
     - `set_component_properties`
     - `set_ui_image_color`
     - `get_scene_snapshot_for_write`
     - `save_scene`
   - 中频（建议）：
     - `set_serialized_property`
     - `modify_ui_layout`
     - `add_component`
2. 明确每个工具至少包含：
   - 1个可执行正例
   - 2个反例
   - 对应错误修复映射
3. 更新字典shape校验，缺字段即编译失败；新增：
   - `examples_positive[].example_revision` 必填。
   - `tool_combinations[]` 场景定义校验。
   - `related_tools` 循环依赖检测（禁止递归环）。
4. 新增属性路径通用策略（避免单属性特判）：
   - `property_path_rules`：统一声明“SerializedProperty.propertyPath口径”“`m_`前缀规则”“嵌套分隔符规则”。
   - `discovery_tool` 固定为 `get_serialized_property_tree`，未知属性路径必须先查询再写入。
   - `high_frequency_properties` 仅收敛高频易错属性（20-30个），不追求全量属性穷举。
5. 新增工具优先级口径（用于后续扩容决策）：
   - `tool_priority`: `P0/P1/P2`。
   - `must_configure`: 高频工具必须配置增强字段；中低频工具按指标滚动纳入。
   - 高频判定口径由基线数据驱动（调用占比+错误占比），禁止主观指定。

**交付物**
1. 字典字段稳定可编译。
2. 产物包含增强字段（非手工patch）。

#### Step G1-2：L2合约组包重构
1. 新建 `contractAdvisor.js`，将模板提取、反例注入、关联工具收敛统一在一个入口。
   - 接口口径：`contractAdvisor({ tool_name, context, include_related, budget_chars, include_enhanced, include_legacy })`。
   - `context` 结构固定为：`{ scenario, previous_tool, error_context }`，不接受自由结构。
2. `get_write_contract_bundle` 完全迁移到 `contractAdvisor`。
3. 输出协议升级（保留兼容字段）：
   - 新增：`contract_version`。
   - 新增：`common_mistakes`、`quick_fixes`、`related_contracts`。
   - 新增：`validation_tool: "preflight_validate_write_payload"`。
   - 新增：`enhanced_fields` 与 `legacy_fields` 并行返回。
   - 旧字段不删（保持客户端兼容），但允许 `include_legacy=false` 关闭旧字段以控制体积。
4. 明确 `related_tools` 展开边界与预算策略：
   - `expand_depth=1`（只展开一层），`exclude_self=true`，`max_tools=5`。
   - `expand_mode=summary`（默认摘要，不返回完整嵌套结构）。
   - 受 `budget_chars` 约束时按优先级裁剪：`minimal_valid_payload_template` > `common_mistakes` > `quick_fixes` > `examples_positive` > `examples_negative` > `related_contracts`。
5. `budget_chars` 边界处理：
   - 若完整内容超限：返回裁剪内容并附带 `metadata.original_size/truncated_size/truncated_fields/truncated=true`。
   - 若 `minimal_valid_payload_template` 本身超限：返回 `E_CONTRACT_BUDGET_TOO_SMALL`，并提示最小建议预算，不返回无效模板。

**交付物**
1. 同一工具一次调用返回“可执行最小集”。
2. 高频场景不再依赖连续多次 `get_tool_schema`。

#### Step G1-3：L2错误反馈结构化
1. 新建 `errorGuidanceRegistry.js`，将错误码映射集中管理。
   - 接口口径：`errorGuidanceRegistry({ error_code, tool_name, context: { stage, previous_operation, scene_revision_changed } })`。
2. `mcpErrorFeedback.js` 输出新增字段：
   - `suggested_action`
   - `suggested_tool`
   - `fix_hint`
   - `contextual_hint`
   - `retry_policy`（沿用并标准化）
3. `turnService.js` 所有失败出口统一通过 `withMcpErrorFeedback`。
4. 要求L3错误上下文字段透传到L2（如 `scene_revision` 变化信息、失败阶段、失败属性路径、失败组件类型），禁止在L2丢失上下文。
5. 上下文缺失时必须降级为结构化通用建议，不允许返回裸文本错误：
   - `fallback_strategy=generic_with_warning`（默认）。
   - 返回 `context_missing=true` 与降级提示，便于上层决策是否重试。
6. 透传字段契约（L3->L2）：
   - 必填基础字段：`error_code`、`error_message`。
   - 建议上下文字段：`stage`、`previous_operation`、`scene_revision_changed`、`failed_property_path`、`failed_component_type`、`old_revision`、`new_revision`。
   - 命名统一采用 `snake_case`；缺字段必须显式为 `null` 或缺省，由 L2 输出 `missing_fields`。

**交付物**
1. 错误反馈可被模型直接执行，不再只靠“记住规则”。
2. 不同入口错误协议一致。

#### Step G1-4：L3错误码一致性收口（仅审计+补齐）
1. 盘点第一组相关工具的失败码分布。
2. 对“同类错误多码”做映射收敛（仅必要处调整）。
3. 禁止新增自由文本错误（无error_code）。
4. 增加自动化门禁（非侵入式）：
   - 错误码映射一致性测试。
   - L3->L2错误上下文透传测试。
5. 对 `tool_combinations` 增加失败处理语义映射：
   - `after_write_failure`：建议动作与是否需重新获取token。
   - `after_save_failure`：重试策略（最多一次）与失败升级路径。

**交付物**
1. L2可稳定命中错误修复映射。
2. 不引入执行行为变更。

#### Step G1-5：测试与门禁
**执行状态（2026-03-07）**：已完成（PR-7）
1. 已落地并通过的门禁：
   - L1 字典校验新增 `common_error_fixes`/`fix_steps`/`tool_combinations.failure_handling` 语义校验。
   - L2 静态目录加载新增同口径 fail-fast 语义校验（未知工具引用、`auto_fixable` 无 `fix_steps`、步骤序号不递增等）。
   - `get_write_contract_bundle` 返回结构校验补齐（`suggested_tool`、结构化 `fix_steps`、预算裁剪守护）。
2. 本轮已通过测试：
   - `ssot/compiler/tests/validateDictionaryShape.test.js`
   - `ssot/compiler/tests/emitMcpToolsJson.test.js`
   - `sidecar/tests/application/get-write-contract-bundle.test.js`
   - `sidecar/tests/application/static-tool-catalog-semantic-guards.test.js`
   - `sidecar/tests/application/anchor-error-feedback.test.js`
   - `sidecar/tests/application/ssot-error-code-closure.test.js`
   - `sidecar/tests/application/ssot-error-code-mapping-consistency.test.js`

1. L1编译测试：
   - 增强字段缺失时失败。
   - 产物字段齐全。
   - `related_tools` 循环依赖时失败。
   - 示例版本/场景字段缺失时失败。
2. L2合同测试：
   - `get_write_contract_bundle` 返回结构化增强字段。
   - 同工具无需再重复 `get_tool_schema` 才能构造最小payload。
   - `budget_chars` 裁剪策略可预测（核心字段不被裁掉）。
   - `include_legacy=false` 时响应体积与字段行为符合预期。
3. L2错误反馈测试：
   - `E_SCENE_REVISION_DRIFT`、`E_TRANSACTION_REF_PATH_INVALID`、`E_PROPERTY_NOT_FOUND` 均返回结构化下一步。
   - 错误上下文字段参与建议分流（同error_code不同stage返回不同建议）。
   - 上下文缺失时触发 `generic_with_warning`，仍返回结构化字段。
4. 回归测试：
   - 不破坏现有 `tools/list` 可见性、schema校验、事务门禁。
5. 新增 fix_steps 有效性门禁（分层策略，避免用例爆炸）：
   - 关键修复链：独立测试（如 `E_SCENE_REVISION_DRIFT -> get_scene_snapshot_for_write`）。
   - 通用修复链：共享模式测试（`E_XXX -> suggested_tool`）。
   - 复杂修复链（>=3步）：至少1条端到端用例覆盖。
   - 修复链失败时必须进入明确的中止/升级路径。
6. L3->L2 上下文透传门禁：
   - 覆盖字段存在性测试（含缺字段降级分支）。
   - 字段命名一致性测试（`snake_case`）。

### 4. 废弃/替代清理清单（职责级）

#### 4.1 代码职责替代
1. `turnPolicies.js` 中“长文本指导”迁移到 `errorGuidanceRegistry.js`：
   - `turnPolicies.js` 仅保留策略分类和可恢复性标志。
2. `staticContractViews.js` 内部分散模板拼装迁移到 `contractAdvisor.js`：
   - `staticContractViews.js` 仅做HTTP视图适配。

#### 4.2 废弃内容清理
1. 清理重复/冲突的建议文本源，避免多处维护同一错误提示。
2. 清理“固定行号定位”类说明（字典更新后易失效）。
3. 清理与SSOT静态模式不一致的旧提示（例如仍建议走已废弃动态发现路径）。

#### 4.3 清理验收标准
1. 同一个 `error_code` 的修复建议仅有一个权威来源。
2. `get_write_contract_bundle` 组包逻辑仅有一个权威模块。
3. 删除后不出现行为回退（以自动化回归为准）。

### 5. 第一组验收标准（量化）
1. 批量UI组合场景中，首次构造成功率提升到 `>=85%`（阶段二目标提升到 `>=90%`）。
   - 首次构造定义：不含前置查询调用，仅统计“首次写入提交”是否成功。
2. 同类任务平均查询调用次数下降 `>=30%`。
3. 错误后盲重试次数（无结构化修复）下降到 `<20%`。
   - 盲重试定义：未消费 `suggested_action/suggested_tool/fix_steps` 即重复提交。
4. 结构化错误字段返回率口径：
   - 第一组覆盖错误码：`=100%`。
   - 未覆盖错误码：`>=80%` 返回通用结构化字段（非裸文本）。
5. 工具组合场景独立指标（监控项）：
   - 组合流程完整成功率（全步骤成功）`>=85%`。
   - 组合流程部分成功率（至少1步成功）`>=95%`。
   - 组合失败原因分类覆盖率 `=100%`（token/参数/执行/门禁/unknown）。
   - 其中 `unknown` 比例 `<=5%`，超阈值必须补充映射后重测。
6. `get_write_contract_bundle` 的P95响应时间进入监控，阶段二设门槛 `<200ms`。
7. 不引入L3执行行为回归（核心回归测试全绿）。

### 5.2 本轮第三次评审判定与补强（新增）

| 反馈点 | 判定 | 处理结论 |
|---|---|---|
| L3->L2 上下文透传实现细节缺失 | 合理 | 已补充字段契约、命名规范、缺字段降级与测试门禁。 |
| `tool_priority` 判定时机不明确 | 合理 | 新增 G1-0.5，固定“基线后判定、实施期锁定”的流程。 |
| `fix_steps` 验证成本过高 | 合理 | 改为关键/通用/复杂三层验证策略，避免测试爆炸。 |
| `budget_chars` 裁剪边界未定义 | 合理 | 新增超限元数据与最小模板超限错误码 `E_CONTRACT_BUDGET_TOO_SMALL`。 |
| 失败原因分类覆盖率可测量性不足 | 合理 | 增加 `unknown` 桶与阈值（<=5%）以及超阈值处理动作。 |
| 基线样本代表性不足 | 合理 | G1-0 扩展到5类场景+样本量与多样性硬约束。 |

**本轮未采纳项**
1. 不在第一组引入运行时动态优先级漂移；优先级仅在 G1-0.5 由基线一次性固化，避免执行期抖动。

### 5.3 三次评审判定与补强（基于 Cursor 二次评审）

#### 5.3.1 逐条判定（14项）

| 反馈项 | 判定 | 处理结论 |
|---|---|---|
| 漏洞1 属性配置策略不明确 | 合理 | 已在 G1-1 增加 `property_path_rules` + 高频属性收敛 + 未知属性查询规则。 |
| 漏洞2 tool_combinations 缺少失败处理 | 合理 | 已在 G1-4 增加失败处理语义（写失败/token、保存失败/重试）。 |
| 漏洞3 related_tools 展开边界不明确 | 合理 | 已在 G1-2 固化 `expand_depth=1`、`max_tools=5`、`summary` 模式。 |
| 漏洞4 contractAdvisor 上下文参数不完整 | 合理 | 已在 G1-2 固化 `context={scenario, previous_tool, error_context}`。 |
| 漏洞5 errorGuidance 上下文透传不完整 | 合理 | 已在 G1-3 增加透传字段与缺失降级策略。 |
| 漏洞6 enhanced/legacy 并行返回冗余 | 部分合理 | 保留并行返回以兼容旧客户端，新增 `include_legacy=false` 控制体积。 |
| 漏洞7 基线测量缺少自动化 | 合理 | G1-0 保留自动化基线采集脚本与可复现元数据要求。 |
| 漏洞8 工具覆盖缺少优先级定义 | 合理 | G1-1 增加 `tool_priority` 与数据驱动的高频判定口径。 |
| 漏洞9 缺少组合场景独立指标 | 合理 | 验收标准新增组合流程成功率与失败分类覆盖。 |
| 漏洞10 结构化字段100%定义不明确 | 合理 | 验收标准拆分“覆盖码100% / 未覆盖码>=80%通用结构化”。 |
| 漏洞11 budget_chars 裁剪策略不明确 | 合理 | G1-2 新增固定裁剪优先级，保证核心字段不丢失。 |
| 漏洞12 related_tools 展开性能风险 | 合理 | 通过深度/数量/摘要模式约束在 G1-2 收敛。 |
| 漏洞13 上下文丢失降级策略不明确 | 合理 | G1-3 明确 `generic_with_warning` 默认降级策略。 |
| 漏洞14 fix_steps 缺少验证机制 | 合理 | G1-5 增加 fix_steps 自动化可执行性门禁。 |

#### 5.3.2 未采纳项说明（本轮无新增拒绝）

本轮反馈均已采纳或“部分采纳（兼容性约束）”；不存在需要新增拒绝项。唯一保留约束为：
1. 不以牺牲兼容性为代价立即移除 `legacy_fields`，而是通过参数开关逐步收敛。

### 6. 二次评审判定与修订（基于 Cursor 反馈）

#### 6.1 逐条判定（含原因）

| 反馈点 | 判定 | 原因 |
|---|---|---|
| L1字段需补版本/上下文/组合场景 | 合理 | 仅“正反例文本”不足以支撑场景化执行，需结构化上下文和组合流程。 |
| contractAdvisor输入输出需显式参数 | 合理 | 若无上下文/预算/关联开关，容易再次出现过度返回或信息不足。 |
| Step G1-1 仅4个工具覆盖偏窄 | 合理 | 第一组目标是体验收敛，至少覆盖高频工具链。 |
| `get_write_contract_bundle` 升级需版本与兼容开关 | 合理 | 避免客户端因字段扩展产生兼容歧义。 |
| errorGuidanceRegistry需上下文参数 | 合理 | 同一错误码在不同阶段可能需要不同建议。 |
| L3只审计不够，应有自动检查 | 部分合理 | 需要自动化检查，但不采用侵入式C#特性注解方案，改用测试与映射门禁。 |
| 工具组合场景未覆盖 | 合理 | 批量UI等任务天然是组合流，单工具提示不够。 |
| L3->L2错误上下文可能丢失 | 合理 | 若不透传上下文，结构化修复建议会退化成通用文案。 |
| 示例维护成本缺机制 | 合理 | 示例过时会直接降低首次成功率，需自动验例机制。 |
| `related_tools` 循环依赖风险 | 合理 | 若递归展开无边界，可能导致组包膨胀。 |
| 场景化示例（examples_by_scenario） | 合理 | 与工具组合场景一致，收益直接。 |
| 错误修复返回可执行步骤（fix_steps） | 合理 | 比自然语言建议更易被模型执行。 |
| 基于使用统计动态返回示例 | 暂不采纳（后置） | 引入新统计链路和状态依赖，超出第一组范围。 |
| 在bundle里返回`validation_tool` | 合理 | 低风险高收益，可直接降低盲提交流程。 |
| 增加基线测量步骤（G1-0） | 合理 | 无基线无法验证改造收益。 |
| 加组合场景成功率与性能指标 | 合理 | 验收需覆盖流程成功率和响应质量。 |

#### 6.2 已采纳的方案补强（写回第一组）

**A. L1 字段模型补强（采纳）**
1. 高频工具新增结构化字段：
   - `examples_positive[]`：增加 `scenario`、`example_revision`、`context_tags`。
   - `examples_negative[]`：增加 `error_code`、`fix_hint`、`wrong_payload_fragment`。
   - `common_error_fixes`：支持 `suggested_action`、`context_required`、`fix_steps`、`auto_fixable`。
   - `tool_combinations[]`：定义场景级工具顺序（如 batch_ui_create）。
2. `related_tools` 保留，但编译期限制“单层展开+去重”，禁止递归展开。

**B. L2 契约与错误反馈补强（采纳）**
1. `contractAdvisor` 接口改为：
   - `contractAdvisor({ tool_name, context, include_related, budget_chars, include_enhanced, include_legacy })`
2. `get_write_contract_bundle` 增加：
   - `contract_version`
   - `enhanced_fields` 与 `legacy_fields`（并行返回）
   - `validation_tool: "preflight_validate_write_payload"`
3. `errorGuidanceRegistry` 接口增加上下文：
   - `stage`、`previous_operation`、`scene_revision_changed`
4. 错误输出新增结构化字段：
   - `suggested_action`、`suggested_tool`、`fix_hint`、`contextual_hint`、`retry_policy`

**C. 步骤补强（采纳）**
1. 新增 **Step G1-0（基线测量）**：
   - 首次成功率、平均查询调用次数、盲重试率、P95响应时间。
2. Step G1-1 覆盖工具扩展为：
   - 高频（必须）：`execute_unity_transaction`、`create_object`、`set_component_properties`、`set_ui_image_color`、`get_scene_snapshot_for_write`、`save_scene`
   - 中频（建议）：`set_serialized_property`、`modify_ui_layout`、`add_component`

#### 6.3 不采纳/后置项（含原因）
1. 不采纳“L3 C# Attribute 注解式错误码审计”：
   - 原因：侵入执行层，违反第一组“L3行为不改”的边界。
   - 替代：L2/L3回归测试 + 错误码映射门禁测试。
2. 后置“基于使用统计动态示例排序”：
   - 原因：需要新增状态采集与持久化，不适合第一组低风险目标。
3. `tool_combinations` 成功率 `>=90%`：
   - 第一组暂设观察指标，不设硬门槛；阶段二再升门槛。

#### 6.4 第一组修订后验收标准（替换原验收口径）
1. 建立并固化基线（G1-0），所有改进指标必须可追溯对比。
2. 批量UI组合场景首次成功率 `>=85%`（阶段二目标再提升）。
3. 平均查询调用次数下降 `>=30%`。
4. 错误后盲重试率 `<20%`。
5. 结构化错误字段返回率 `=100%`（针对第一组覆盖错误码）。
6. `get_write_contract_bundle` P95 响应时间进入监控（第一组先记录，不做阻断阈值）。
7. 不引入L3执行行为回归（核心回归测试全绿）。

---

## 2026-03-07 Baseline Closure + Deprecated Cleanup（PR-9）

### 1. G1-0 基线闭环（已完成）
1. 新增基线样本：`sidecar/scripts/g1-baseline-samples.json`（5类场景 * 每类20条，共100条）。
2. 已执行：`npm run metrics:g1:baseline -- --input ./scripts/g1-baseline-samples.json`。
3. 产物：`sidecar/.state/g1-baseline-report.json`。
4. 代表性门禁：`all_passed=true`，`min_samples_per_scenario=true`，`min_tool_combinations=true`，`min_error_code_variety=true`。

### 2. G1-0.5 工具优先级冻结闭环（已完成）
1. 已执行：`npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.json`。
2. 产物：`sidecar/.state/g1-tool-priority-freeze.json`。
3. 冻结结果：`p0=4`，`p1=3`，`p2=55`（`representativeness_gate.all_passed=true`）。

### 3. 废弃清理（已完成）
1. 新建 `sidecar/src/application/errorFeedback/errorFeedbackTemplateRegistry.js`，作为 MCP 错误模板与建议的唯一权威入口。
2. 新建 `sidecar/src/application/errorFeedback/mcpErrorFeedbackTemplates.json`，承载模板目录数据。
3. `turnPolicies.js` 删除旧的 `MCP_ERROR_FEEDBACK_TEMPLATES` 和 `getMcpErrorFeedbackTemplate` 残余职责，仅保留跨模块政策辅助函数。
4. 迁移完成的调用点：
   - `errorGuidanceRegistry.js` 改为依赖 `errorFeedbackTemplateRegistry.js`
   - `unitySnapshotService.js` 的 `OCC_STALE_SNAPSHOT_SUGGESTION` 改为从 `errorFeedbackTemplateRegistry.js` 引入
   - `anchor-error-feedback.test.js` 与 `ssot-error-code-mapping-consistency.test.js` 改为新入口

### 4. G1-0.5 字典闭环（已完成）
1. 已执行写回：`npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.json --write-dictionary`。
2. 审计产物：`sidecar/.state/g1-priority-dictionary-audit.json`。
3. 审计结论：
   - `changed_tools_total=62`
   - `freeze_mismatch_total=0`
   - `after_priority_counts={P0:4,P1:3,P2:55,OTHER:0}`
4. 字典门禁与编译验证：
   - `node ssot/compiler/index.js --dictionary ssot/dictionary/tools.json --out-dir ssot/artifacts` 通过
   - `node --test ssot/compiler/tests/validateDictionaryShape.test.js ssot/compiler/tests/emitMcpToolsJson.test.js` 通过
   - `node --test sidecar/tests/application/g1-baseline-report-script.test.js sidecar/tests/application/g1-tool-priority-freeze-script.test.js` 通过

### 5. 基线覆盖修正审计 + 二次冻结（2026-03-07，已完成）
1. 发现并确认偏差：旧基线中 `create_object` 与 `set_ui_image_color` 未被覆盖（`observed_in_baseline=false`），导致被误降至 `P2`。
2. 已补充高频样本：`sidecar/scripts/g1-baseline-samples.corrected.json`（在原100条上追加40条高频直写场景样本）。
3. 已执行二次基线计算：
   - `npm run metrics:g1:baseline -- --input ./scripts/g1-baseline-samples.corrected.json --output ./.state/g1-baseline-report.corrected.json`
4. 已执行二次冻结写回：
   - `npm run metrics:g1:priority -- --baseline ./.state/g1-baseline-report.corrected.json --output ./.state/g1-tool-priority-freeze.corrected.json --write-dictionary`
5. 审计产物：`sidecar/.state/g1-baseline-coverage-correction-audit.json`
6. 审计结论：
   - `freeze_before`: `p0=4,p1=3,p2=55`
   - `freeze_after`: `p0=5,p1=4,p2=53`
   - 核心工具修正结果：
     - `create_object: P2 -> P1`
     - `set_ui_image_color: P2 -> P1`
     - `save_scene: P1 -> P0`
7. 回归验证：
   - `node ssot/compiler/index.js --dictionary ssot/dictionary/tools.json --out-dir ssot/artifacts` 通过
   - `npm run test:r20:qa` 通过（120/120）


---

## 2026-03-07 Pain Point Status Update (Execution View)

### Pain Point 1: Two-step Token invalidation
- Status: Stage-wise resolved (core closure completed).
- Completed: L2 write-through token refresh; successful read/write responses now issue `read_token_candidate` and structured guidance covers `E_SCENE_REVISION_DRIFT`.
- Completed: Transaction alias binding and `$ref` chain reduced token-drift failures in multi-step writes.
- Completed (PR-V3-6): failure-context hydration now backfills from `nested_context_json`, canonicalizes alias error codes to SSOT canonical routes, and keeps transaction recovery routing deterministic without adding extra RTT.

### Pain Point 2: New MCP tools required manual glue and registration
- Status: Stage-wise resolved (L1/L2 automation backbone completed).
- Completed: SSOT dictionary -> compiler artifacts -> L2 static catalog pipeline is closed.
- Completed: G1-0/G1-0.5 baseline, freeze, dictionary write-back, and diff audit are closed (including coverage-corrected second freeze).
- Pending: New tool delivery still requires L3 executor implementation; keep improving end-to-end templated delivery efficiency.

### Pain Point 3: AI operation experience and execution feel
- Status: Partially resolved (significantly improved).
- Completed: `get_write_contract_bundle` enhanced output, structured error guidance, and fix steps are in place.
- Completed: Coverage correction restored core tool priority classification (`create_object` and `set_ui_image_color` moved from P2 to P1).
- Completed (PR-V3-7): `get_write_contract_bundle` now uses a dedicated cache policy layer keyed by tool+budget+context+catalog version, reducing repeated contract assembly overhead while keeping payload contract stable.

### Overall
- All three pain points moved from "unresolved" to "converging".
- Pain points 1 and 2 have completed core engineering closure; pain point 3 entered experience-optimization phase.

---

## 第一组 V2 修复方案（系统化收口）

### 1. 修复目标（明确收敛口径）
1. 将“复杂失败不可诊断”收敛为“失败可定位、可执行修复、可自动验证”。
2. 将“锚点冲突/同名对象歧义”收敛为“统一冲突语义 + 统一恢复路径”。
3. 将“事务步骤失败信息过粗”收敛为“标准化失败上下文（step/tool/error/建议）”。
4. 避免针对单指令补丁，改为跨工具、跨层统一能力，后续新增工具可复用。

### 2. 设计原则（拒绝补丁式）
1. 单一职责：
   - L1 只定义契约与治理策略，不承载运行时分支逻辑。
   - L2 只做协议组装、错误映射、指引输出，不做执行推断。
   - L3 只做执行与事实采集，输出标准化失败上下文。
2. 统一语义：所有写工具共享同一失败上下文模型与恢复建议模型。
3. 可扩展：新增工具只需接入标准失败上下文，不新增专属错误拼接逻辑。
4. 可审计：所有建议来源可追踪到字典产物与映射门禁测试。

### 3. 分层方案（L1 / L2 / L3）

#### 3.1 L1（SSOT 字典与编译产物）
目标：定义“失败诊断契约”与“歧义治理策略”标准，不绑定单工具实现。

1. 在 `tools.json` 的 `_definitions` 新增全局契约：
   - `error_context_contract`：失败上下文字段白名单（如 `failed_step_id`、`failed_tool_name`、`failed_error_code`、`failed_anchor_path`、`ambiguity_kind`）。
   - `recovery_action_contract`：建议动作标准字段（`suggested_action`、`suggested_tool`、`fix_hint`、`fix_steps`、`retry_policy`）。
   - `name_collision_policy_contract`：创建类能力统一命名冲突策略（`fail` / `auto_suffix` / `reuse_existing`）。

2. 为“能力族”而非单指令定义策略：
   - 事务执行族（transaction-enabled write tools）统一要求返回步骤级失败上下文。
   - 锚点写入族（anchor-based write tools）统一要求返回冲突定位上下文与歧义类别。
   - 创建类工具族（create-like tools）统一遵循命名冲突策略契约。

3. 编译器输出扩展：
   - 将上述全局契约投影到 L2 产物，供 L2 运行时直接消费。
   - 对缺失字段、循环依赖、策略非法值做编译期 fail-fast。

涉及文件（L1）：
1. `ssot/dictionary/tools.json`
2. `ssot/compiler/parser/validateDictionaryShape.js`
3. `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
4. `ssot/compiler/tests/validateDictionaryShape.test.js`
5. `ssot/compiler/tests/emitMcpToolsJson.test.js`

#### 3.2 L2（Sidecar 协议层）
目标：统一消费 L1 契约，稳定输出“可执行错误恢复协议”。

1. 新增 `failureContextNormalizer`（独立模块）：
   - 只负责验证/归一化 L3 返回的失败上下文。
   - 输出统一字段：`failed_step_*`、`failed_anchor_*`、`ambiguity_kind`、`context_missing`。

2. 升级 `errorGuidanceRegistry`：
   - 从“按错误码文本映射”升级为“错误码 + 失败上下文 + 契约策略”三元决策。
   - 对 `E_TRANSACTION_STEP_FAILED` 统一输出可执行修复步骤（不是单句提示）。
   - 对 `E_TARGET_ANCHOR_CONFLICT` 统一输出定位流程（先读后写，禁止盲重试）。

3. 升级 `get_write_contract_bundle`：
   - 输出“冲突治理与失败恢复”字段（基于 L1 契约自动组包）。
   - 返回创建类命名冲突策略说明，避免模型猜测行为。

4. 清理旧耦合：
   - 移除分散在其它模块中的同类错误文案重复定义。
   - 统一由 `errorGuidanceRegistry` + 契约产物生成恢复建议。

涉及文件（L2）：
1. `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
2. `sidecar/src/application/errorFeedback/mcpErrorFeedback.js`
3. `sidecar/src/application/ssotRuntime/staticContractViews.js`
4. `sidecar/src/application/ssotRuntime/contractAdvisor.js`
5. （新增）`sidecar/src/application/errorFeedback/failureContextNormalizer.js`
6. `sidecar/tests/application/get-write-contract-bundle.test.js`
7. `sidecar/tests/application/anchor-error-feedback.test.js`
8. `sidecar/tests/application/ssot-error-code-mapping-consistency.test.js`

#### 3.3 L3（Unity 执行层）
目标：提供标准化“执行事实”，不在执行层拼接策略文案。

1. 统一失败上下文模型（执行层事实模型）：
   - 事务失败统一填充：`failed_step_index`、`failed_step_id`、`failed_tool_name`、`failed_error_code`、`failed_error_message`。
   - 锚点冲突统一填充：`ambiguity_kind`、`target_path`、`target_object_id`、`resolved_candidates_count`。
   - 创建类冲突统一填充：`name_conflict=true`、`conflicted_name`、`existing_candidates_count`。

2. 事务执行引擎收口：
   - 由统一引擎负责步骤失败包装，不允许各 executor 私自拼错误描述。
   - 保持执行职责单一：只产出事实上下文，不产出策略建议文案。

3. 锚点解析与命名策略基础能力化：
   - 锚点冲突检测下沉到共享解析器（跨写工具复用）。
   - 命名冲突策略下沉到共享创建策略服务（跨创建类工具复用）。

涉及文件（L3）：
1. `Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionExecutionEngine.cs`
2. `Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionReferenceResolver.cs`
3. `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`
4. （共享能力）锚点解析/创建策略相关基础服务文件
5. `Assets/Editor/Codex/Tests/EditMode/SsotTransactionExecutionTests.cs`
6. `Assets/Editor/Codex/Tests/EditMode/SsotRequestQueryHandlerTests.cs`

### 4. 落地步骤（V2 执行序列）
1. V2-A（L1 契约建模）：完成全局错误上下文契约与策略契约入字典 + 编译门禁。
2. V2-B（L3 事实输出）：完成执行层标准失败上下文统一产出（事务/锚点/命名冲突）。
3. V2-C（L2 映射收口）：完成 failureContextNormalizer + errorGuidanceRegistry 三元决策。
4. V2-D（合约查询增强）：`get_write_contract_bundle` 输出恢复路径与冲突策略。
5. V2-E（废弃清理）：删除重复错误文案源与旧散落映射入口。
6. V2-F（门禁与回归）：编译门禁 + 端到端错误恢复场景测试全绿。

### 5. 验收标准（V2）
1. 事务失败错误返回中必须包含：`failed_step_id`、`failed_tool_name`、`failed_error_code`、`suggested_action`、`fix_hint`。
2. 锚点冲突错误返回中必须包含：`ambiguity_kind` 与结构化修复步骤（非裸文本）。
3. 创建类冲突场景行为可预测（按策略 fail/suffix/reuse），不允许隐式命中。
4. 同类错误的恢复建议仅有一个权威来源（避免多源冲突）。
5. 不引入新链路回归：`npm run test:r20:qa` 全绿，编译器测试全绿。

### 6. 废弃/替代清单（V2）
1. 废弃：按工具散落定义的事务失败文案拼接逻辑。
2. 废弃：锚点冲突的非结构化建议分支（多处重复提示文本）。
3. 替代：统一使用 `failureContextNormalizer + errorGuidanceRegistry + L1 契约产物`。
4. 废弃：创建类冲突的隐式行为分支；替代为统一命名冲突策略契约。

---

## 第一组 V2 修复方案（实施版，2026-03-07）

### 1. V2 修复目标（必须同时达成）
1. 失败可诊断：所有写链路失败都输出统一结构化上下文，而不是零散文本。
2. 失败可恢复：L2 必须返回可执行修复动作（`suggested_action`/`fix_steps`），而不是“仅提示”。
3. 歧义可治理：锚点冲突、同名对象冲突进入统一治理模型，不允许各工具各自处理。
4. 合约可收敛：一次 `get_write_contract_bundle` 返回最小可执行模板+常见反例+恢复路径。
5. 架构可扩展：新增工具只接入“能力族契约”，不新增专属补丁逻辑。

### 2. 范围与非目标
1. 范围：第一组内所有写能力族（事务族、锚点写入族、创建族）。
2. 非目标：
   - 不做“单一指令特判增强”。
   - 不新增一次性临时字段或临时错误码映射。
   - 不在 L3 注入文案策略（L3 只产出执行事实）。

### 3. 分层设计（单一职责）

#### 3.1 L1（字典/编译）职责
1. 定义全局能力族契约：
   - `error_context_contract`：失败上下文字段规范，事务失败场景必须包含 `nested_error_code`、`nested_error_message`、`nested_context`（若存在底层错误）。
   - `recovery_action_contract`：恢复动作与重试策略规范，`fix_steps` 必须声明执行语义（`advisory` 或 `transactional`）与失败处理策略。
   - `recovery_action_contract.dependency_validation`：`check_cycles`、`max_depth`、`on_cycle_detected=fail_fast`。
   - `recovery_action_contract.context_validity`：`ttl_seconds`、`context_snapshot`、`requires_context_refresh` 标记语义。
   - `recovery_action_contract.fallback_strategy`：`try_simpler_fix|return_manual_instructions|escalate_to_human`。
   - `ambiguity_resolution_policy_contract`：锚点与命名冲突策略规范。
2. 定义能力族策略绑定：
   - `transaction_write_family`（含 `rollback_policy`：`on_step_failure=rollback_all` 为默认口径；可扩展 `rollback_none/rollback_partial`）
   - `anchor_write_family`
   - `create_family`（含 `pre_check_policy`：`check_existing`、`on_conflict`、`return_candidates`）
3. 编译门禁：
   - 缺失契约字段即失败。
   - 策略值非法即失败。
   - 恢复动作与错误码映射断裂即失败。
   - `fix_steps.depends_on` 引用不存在步骤、出现环依赖、超过深度阈值即失败。
   - `fix_steps.execution_order` 非法枚举值、`idempotent` 非布尔值即失败。

涉及文件（L1）
1. `ssot/dictionary/tools.json`
2. `ssot/compiler/parser/validateDictionaryShape.js`
3. `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
4. `ssot/compiler/tests/validateDictionaryShape.test.js`
5. `ssot/compiler/tests/emitMcpToolsJson.test.js`

#### 3.2 L2（协议/恢复建议）职责
1. `failureContextNormalizer`：只做失败上下文标准化与缺失标注。
2. `recoveryPlanner`：按“错误码 + 能力族策略 + 失败上下文”生成恢复动作。
   - `fix_steps` 执行语义：首版默认 `execution_order=sequential`、`failure_handling=stop_on_first_failure`。
   - `fix_steps` 依赖关系：使用显式 `depends_on`（无依赖即空数组），禁止隐式顺序推断。
   - `fix_steps` 幂等语义：每步必须声明 `idempotent=true/false`，并可返回 `already_fixed` 判定提示。
   - `fix_steps` 验证语义：可选 `verification`（`auto_verify`、`verification_tool`、`verification_criteria`）。
   - 上下文注入：允许在 `fix_steps` 中引用失败上下文字段（如 `failed_step_id`、`failed_tool_name`）以避免二次猜测。
   - 上下文一致性：若错误上下文超过 `ttl_seconds` 或指纹不一致，返回 `requires_context_refresh=true` 与刷新建议；首版不做隐式自动刷新。
   - 依赖安全：生成计划前执行有向无环校验，环依赖直接 `fail_fast`（返回 `E_RECOVERY_PLAN_CYCLE`）。
   - 语义模板化：恢复策略来自 L1 契约模板，`recoveryPlanner` 仅做选择与参数填充，不引入硬编码分支膨胀。
3. `contractAdvisor`：按预算收敛模板、反例、修复路径，输出可执行合约。
   - 最小必需字段：`minimal_valid_payload_template`、`required_fields`、至少 1 条 `common_mistakes`。
   - 裁剪标记：`truncated`、`truncated_fields`、`min_required_budget`、`original_size`、`truncated_size`。
   - 缓存策略（可选优化）：按 `tool_name + include_enhanced + include_legacy + budget_chars + artifacts_hash` 缓存组包结果，字典产物变更自动失效。
   - 上下文体积控制：`nested_context` 默认摘要输出，必要时通过显式参数请求完整上下文。
4. `mcpErrorFeedback`：只负责协议拼装，不维护业务规则。
5. `turnService`：所有失败出口统一经过同一反馈管道。

涉及文件（L2）
1. 新增：`sidecar/src/application/errorFeedback/failureContextNormalizer.js`
2. 新增：`sidecar/src/application/errorFeedback/recoveryPlanner.js`
3. 改造：`sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
4. 改造：`sidecar/src/application/errorFeedback/mcpErrorFeedback.js`
5. 改造：`sidecar/src/application/ssotRuntime/contractAdvisor.js`
6. 改造：`sidecar/src/application/ssotRuntime/staticContractViews.js`
7. 改造：`sidecar/src/application/turnService.js`

#### 3.3 L3（执行事实/冲突检测）职责
1. `ExecutionFailureContextBuilder`（统一失败上下文构建）：
   - 事务失败统一产出 `failed_step_*`。
   - 若步骤内部存在底层失败，统一透传 `nested_error_*` 与 `nested_context`。
   - 事务失败统一产出回滚事实：`rollback_applied`、`rollback_policy`、`rollback_reason`。
   - 锚点冲突统一产出 `ambiguity_*`。
   - 创建冲突统一产出 `name_conflict_*`。
   - 上下文快照字段：`scene_revision_at_failure`、`error_context_issued_at`。
2. `AnchorResolutionService`（共享锚点解析）：统一冲突检测与候选输出。
3. `NameCollisionPolicyService`（共享命名策略）：统一 fail/suffix/reuse 行为，并在创建前执行同名预检查（可返回候选列表）。
4. `SsotRequestDispatcher` 只透传事实模型，不拼接建议文案。
5. 并发失败口径：事务首版为串行 fail-fast，仅返回首个失败；若存在后续抑制错误，返回 `suppressed_error_count`。

涉及文件（L3）
1. 新增：`Assets/Editor/Codex/Infrastructure/Ssot/Errors/ExecutionFailureContextBuilder.cs`
2. 新增：`Assets/Editor/Codex/Infrastructure/Ssot/Anchors/AnchorResolutionService.cs`
3. 新增：`Assets/Editor/Codex/Infrastructure/Ssot/Create/NameCollisionPolicyService.cs`
4. 改造：`Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionExecutionEngine.cs`
5. 改造：`Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`

### 4. 实施步骤（按 PR 交付）
1. PR-V2-1（L1 契约定型）【已完成，2026-03-07】
   - 落地三类全局契约与能力族绑定。
   - 补齐编译门禁与产物输出。
2. PR-V2-2（L3 统一失败事实）【已完成，2026-03-07】
   - 接入 `ExecutionFailureContextBuilder`。
   - 事务、锚点、命名冲突统一输出事实字段。
   - 明确回滚策略执行与回滚事实透传字段。
3. PR-V2-3（L3 冲突基础能力化）【已完成，2026-03-07】
   - 引入 `AnchorResolutionService` 与 `NameCollisionPolicyService`。
   - 移除各 executor 内部重复冲突判断片段。
4. PR-V2-4（L2 恢复策略引擎化）【已完成，2026-03-07】
   - 引入 `failureContextNormalizer + recoveryPlanner`。
   - `errorGuidanceRegistry` 改为产物驱动。
   - `fix_steps` 输出补齐顺序、依赖、幂等、验证语义。
   - 增加恢复计划安全门禁：依赖无环校验、上下文新鲜度校验、降级策略输出。
   - 收口接线：`mcpErrorFeedback/turnService/staticToolCatalog` 已全量透传结构化恢复字段（含 `fix_steps`、`requires_context_refresh`、`recovery_plan_error_*`）。
   - 门禁新增：`sidecar/tests/application/ssot-recovery-guidance.test.js`（覆盖 context stale、依赖环 fail-fast、结构化恢复字段透传）。
   - 验证结果：`npm --prefix sidecar run test:r20:qa` 全绿（123/123）。
5. PR-V2-5（L2 合约查询收敛）【已完成，2026-03-07】
   - `get_write_contract_bundle` 输出模板+反例+恢复路径一体化。
   - 裁剪策略与预算边界统一。
   - 收口实现：`contractAdvisor` 已重构为“最小可执行负载门禁 + 可选字段有序裁剪 + 预算失败快返（E_CONTRACT_BUDGET_TOO_SMALL）”统一策略。
   - 新增字段：`required_fields`、`recovery_paths`、`contract_budget_policy`（含 minimal_required_fields/optional_fields/truncation_order）。
   - 预算语义：仅当预算能容纳最小可执行负载时返回 200；否则返回 400 + `min_required_budget`。
   - 验证结果：`node --test sidecar/tests/application/get-write-contract-bundle.test.js` 全绿；`npm --prefix sidecar run test:r20:qa` 全绿（124/124）。
6. PR-V2-6（废弃清理）【已完成，2026-03-07】
   - 删除旧建议映射入口：`mcpErrorFeedback` 不再经过 `normalizeErrorSuggestionByCode`。
   - 删除旧导出入口：`sidecar/src/utils/turn/errors.js` 移除 `normalizeErrorSuggestionByCode/mapMcpErrorFeedback` 导出。
   - 物理删除旧实现：`sidecar/src/utils/turn/legacyTurnUtils.js` 移除 `normalizeErrorSuggestionByCode/mapMcpErrorFeedback` 与对应常量。
   - 门禁补充：新增“unknown timeout 走模板注册中心而非 legacy map 覆写”测试并通过。
7. PR-V2-7（门禁与回归）【已完成，2026-03-07】
   - 错误反馈出口收口：`withMcpErrorFeedback` 统一抬升结构化失败字段（`failed_step_*`、`nested_error_*`、`rollback_*`、`suppressed_error_count`、`resolved_ref_count`、`executed_step_count`、`scene_revision_at_failure`、`error_context_issued_at`）。
   - 恢复 E2E 门禁补齐：`ssot-error-code-closure.test.js` 新增“嵌套错误场景”“上下文过期场景”回归断言。
   - 修复步骤失败门禁补齐：`ssot-recovery-guidance.test.js` 新增 `fix_steps depends_on unknown step_id` fail-fast 回归断言。
   - 性能观测落地：`generate-g1-baseline-report.js` 新增 `structured_error_response_p95_bytes` 指标，与既有 `get_write_contract_bundle_p95_latency_ms` 联合输出。
   - 恢复可观测性落地：新增 `recovery_observability`（错误次数、建议执行次数、修复尝试/成功/失败、成功率、平均耗时、P95耗时）。
   - 告警口径落地：新增 `RECOVERY_SUCCESS_RATE_LOW` 与 `RECOVERY_LATENCY_P95_HIGH` 两类结构化告警输出。
   - 测试结论：`npm --prefix sidecar run test:r20:qa` 全绿（127/127）；`g1-baseline-report-script` 新指标测试通过。

### 4.1 缺陷状态快照（2026-03-07）

| 缺陷项 | 当前状态 | 状态说明 |
|---|---|---|
| `E_TRANSACTION_STEP_FAILED` 恢复链路不完整 | 已完成（PR-V3-6） | 已补齐 `nested_context_json` 回填与 `nested_error_code` 规范化路由；当 L3 返回 alias 错误码时可自动映射到 canonical 路由，并补齐事务恢复 `fix_steps.depends_on` 数字索引到 `step_id` 的确定性解析。 |
| `create_object` 预检查策略未贯通 | 已完成（PR-V3-2） | 已移除执行器硬编码策略，统一改为 `create_family.pre_check_policy + create_object.name_collision_policy` 驱动；创建成功/失败均透传 `existing_candidates_count/existing_candidate_path/applied_policy/pre_check_existing`。 |
| 锚点冲突诊断信息不足 | 已完成（PR-V3-3） | 已补齐 path/objectId 双候选锚点透传（`resolved_candidates_count/path_candidate_*/object_id_candidate_*`），并统一输出“读两侧候选→重绑锚点→重试”的确定性恢复步骤。 |
| 错误文案乱码治理 | 已完成（PR-V3-4） | 文案模板已迁移到 `_definitions.error_feedback_contract` 并进入 SSOT 产物链路，L2 运行时优先消费字典契约。 |
| 失败上下文归一化重复实现 | 已完成（PR-V3-4） | 已移除 `turnService` 的重复归一化函数，统一通过 `failureContextNormalizer` 产出失败上下文。 |
| `E_STALE_SNAPSHOT` 多源建议口径 | 已完成（PR-V3-4） | `ssotWriteTokenGuard`/`unitySnapshotService`/`mcpErrorFeedback` 统一走 `errorFeedbackTemplateRegistry`，并由字典契约驱动建议文案。 |
| 写后 token 发放守护矩阵 | 已完成（PR-V3-5） | 已新增 token 发放策略中枢与全矩阵门禁：仅成功 read/write 且具备 scene_revision 时发放；失败/非 eligible/缺 revision 统一剥离透传候选 token。 |

### 5. 废弃清理清单（必须执行）
1. 删除按工具散落的事务失败提示拼接逻辑。
2. 删除锚点冲突在多模块重复定义的文本建议。
3. 删除“同类错误多入口映射”残留分支，收敛为单权威入口。
4. 删除创建类工具中的隐式命名冲突行为分支，统一走策略服务。

### 6. 验收口径（V2）
1. 所有第一组写链路失败返回均包含结构化恢复字段（覆盖率 100%）。
2. `E_TRANSACTION_STEP_FAILED` 必含 `failed_step_id/failed_tool_name/failed_error_code`，若存在底层失败必须包含 `nested_error_code/nested_error_message`。
3. 事务失败响应必须包含回滚事实字段：`rollback_applied/rollback_policy/rollback_reason`。
4. `E_TARGET_ANCHOR_CONFLICT` 必含 `ambiguity_kind` 与 `fix_steps`。
5. `fix_steps` 必须具备可执行语义字段：`execution_order`、`depends_on`、`idempotent`，可选 `verification`。
6. 创建族工具必须执行创建前同名预检查；冲突时按策略返回（fail/suffix/reuse）并支持候选对象信息输出。
7. `get_write_contract_bundle` 在预算受限时仍保证最小可执行模板可用；否则返回明确预算不足错误，且带 `min_required_budget`。
8. 错误恢复 E2E 用例通过：覆盖 `E_PROPERTY_NOT_FOUND`、`E_TRANSACTION_REF_PATH_INVALID`、`E_TARGET_ANCHOR_CONFLICT`。
9. 不引入新链路回归：编译测试、L2 应用测试、Unity EditMode 测试全绿。
10. 恢复计划依赖图必须无环；若检测到环依赖，返回结构化失败并拒绝执行。
11. 上下文过期时必须返回 `requires_context_refresh=true`，并给出明确刷新动作，不允许盲重试建议。

### 7. 外部评审判定与补强（2026-03-07）
1. 采纳：嵌套错误传递缺失。
   - 处理：将 `nested_error_*` 与 `nested_context` 纳入事务失败契约与 L3 事实透传要求。
2. 采纳：场景状态预检查缺失。
   - 处理：在 `create_family` 增加 `pre_check_policy`，并要求创建前同名预检查。
3. 采纳：错误恢复原子性定义不清。
   - 处理：在 `recovery_action_contract` 中为 `fix_steps` 增加执行语义与失败处理策略；默认 `advisory`，需要原子性时显式 `transactional`。
4. 采纳：预算裁剪边界不完整。
   - 处理：补充最小必需字段集合与裁剪标记输出规则。
5. 采纳：端到端错误恢复测试缺失。
   - 处理：PR-V2-7 增加错误恢复 E2E 场景门禁。
6. 部分采纳：向后兼容性。
   - 处理：保持新增字段“向后兼容的增量扩展”；不引入双协议回退分叉（避免维护两套错误响应协议）。
7. 采纳：性能影响评估缺失。
   - 处理：新增响应体积与关键接口延迟的 P95 观测项。
8. 不采纳：错误码层次化拆分。
   - 原因：层次化子错误码会扩大治理面并增加迁移成本；V2 采用“父错误码 + `nested_error_code`”收敛根因，保证一致性与可扩展性。

### 8. 第二次评审判定与补强（2026-03-07）
1. 采纳：事务回滚策略需显式化。
   - 处理：`transaction_write_family` 增加 `rollback_policy`，L3 失败上下文透传 `rollback_applied/rollback_reason`。
2. 采纳：`fix_steps` 执行顺序与依赖关系需显式化。
   - 处理：`execution_order=sequential`（首版）+ 显式 `depends_on` + `failure_handling=stop_on_first_failure`。
3. 采纳：错误恢复幂等性需显式化。
   - 处理：每个 `fix_step` 增加 `idempotent`，并支持 `already_fixed` 提示。
4. 采纳：错误恢复验证机制需补充。
   - 处理：`verification` 语义入契约，支持 `auto_verify/verification_tool/verification_criteria`。
5. 采纳：错误上下文版本标识。
   - 处理：结构化错误响应增加 `error_context_version`（增量字段，默认 `2.0`）。
6. 部分采纳：并发错误处理策略。
   - 处理：首版事务维持 fail-fast，只返回首错并返回 `suppressed_error_count`；不引入多错误列表协议。
7. 采纳：性能与可观测性优化方向。
   - 处理：补充 `contract bundle` 缓存策略与恢复链路监控指标（成功率/耗时）。
8. 部分采纳：完整上下文体积控制。
   - 处理：默认返回关键上下文字段；`nested_context` 按预算裁剪并标记，暂不引入分页协议。

### 9. 第三次评审判定与补强（2026-03-07）
1. 采纳：错误恢复循环依赖风险。
   - 处理：在 `recovery_action_contract` 与编译门禁中加入依赖有向无环校验，L2 运行时再做二次校验。
2. 采纳：错误恢复上下文一致性。
   - 处理：新增 `context_validity` 契约与 `requires_context_refresh` 标记；首版不做隐式自动刷新，避免引入额外 RTT 与副作用。
3. 部分采纳：副作用管理。
   - 处理：对 `transactional` 修复步骤增加副作用说明与失败处理语义；暂不在 L2 实现通用“自动清理执行器”。
4. 部分采纳：超时与取消机制。
   - 处理：在契约中增加超时建议字段与告警观测；暂不引入新的跨层取消协议。
5. 部分采纳：权限与安全性。
   - 处理：沿用现有工具门禁与写权限体系；不新增 fix_steps 独立权限子系统，避免双轨授权。
6. 不采纳：国际化支持（本轮）。
   - 原因：当前优先级在恢复语义稳定性，不在第一组引入多语言模板治理面。
7. 采纳：恢复降级策略。
   - 处理：新增 `fallback_strategy`，失败时给出“简化修复/手工指引/人工升级”路径。
8. 部分采纳：批量修复、智能排序、学习反馈。
   - 处理：纳入后续优化项；本轮先补监控与告警，不在 V2 首轮引入学习闭环。
9. 采纳：测试覆盖增强。
   - 处理：PR-V2-7 增加嵌套错误、修复失败、上下文过期三类 E2E。

### 10. V3 执行状态（2026-03-07）
1. PR-V3-1（事务失败恢复链路系统化）：【已完成，2026-03-07】
   - L1：`execute_unity_transaction.common_error_fixes` 增加 `E_TRANSACTION_STEP_FAILED`，并新增 `nested_error_routes`（按 `nested_error_code` 路由）。
   - L2：`recoveryPlanner` 新增事务失败嵌套路由选择；`errorGuidanceRegistry/mcpErrorFeedback` 补充 `routed_error_code/routed_source` 透传。
   - L3：沿用既有 `failed_* + nested_*` 失败事实输出，形成“失败事实 -> 路由恢复”的闭环。
   - 门禁：`ssot-recovery-guidance`、`static-tool-catalog-semantic-guards`、`validateDictionaryShape` 新增/增强测试并通过。
2. PR-V3-2（create_family 预检查策略贯通）：【已完成，2026-03-07】
   - L1：`create_family.pre_check_policy` 补齐 `policy_field=name_collision_policy`；`create_object` 输入契约新增 `name_collision_policy`；`common_error_fixes` 新增 `E_NAME_COLLISION_DETECTED` 标准修复路径。
   - L2：`contractAdvisor/get_write_contract_bundle` 新增 `create_pre_check_policy` 输出（`check_existing/on_conflict/return_candidates/policy_field/allowed_policies`），统一对外暴露创建族冲突治理口径。
   - L3：`CreateObjectSsotExecutor` 删除硬编码 fail 策略，改为读取 `SsotCreateFamilyContract` 默认策略与允许策略；`SsotRequestDispatcher` 扩展冲突诊断字段透传。
   - 门禁：`get-write-contract-bundle.test` 新增 create 预检查策略断言；`emitDtosCs/validateDictionaryShape/emitMcpToolsJson` 编译侧测试通过；`npm --prefix sidecar run test:r20:qa` 130/130 全绿。
3. PR-V3-3（锚点冲突诊断与确定性重定位收口）：【已完成，2026-03-07】
   - L1：`error_context_contract.anchor_conflict.required_fields` 补齐候选锚点必需字段；`execute_unity_transaction` 的 `E_TARGET_ANCHOR_CONFLICT` 嵌套路由升级为三步重定位语义（双候选检查 + 重试）。
   - L2：`failureContextNormalizer/turnService/mcpErrorFeedback` 贯通候选锚点字段；`recoveryPlanner` 新增 `E_TARGET_ANCHOR_CONFLICT` 基线恢复模板；`contractAdvisor` 为锚点写工具自动注入 `E_TARGET_ANCHOR_CONFLICT` 快速修复路径并保留 `context_bindings`。
   - L3：`AnchorResolutionService` 增加双候选锚点事实（path侧/objectId侧 path+object_id）；`SsotRequestDispatcher` 在 `E_TARGET_ANCHOR_CONFLICT` 失败出口统一补全诊断上下文，避免逐工具补丁分支。
   - 门禁：`anchor-error-feedback/get-write-contract-bundle/ssot-recovery-guidance/validateDictionaryShape` 新增回归断言并通过；`npm --prefix sidecar run test:r20:qa` 131/131 全绿。
4. PR-V3-4：已完成（错误文案契约化 + 归一化单入口 + stale 建议口径收敛）。
5. PR-V3-5（写后 token 发放守护矩阵）：【已完成，2026-03-07】
   - L2：新增 `tokenIssuancePolicy` 作为单一策略入口，统一判定发放条件并执行 token envelope 清洗（去除 L3 透传候选与 legacy 字段）。
   - L2：`dispatchSsotRequest.maybeIssueReadTokenFromResponse` 收敛到策略中枢；仅 `ok=true` 且 `tool.kind∈{read,write}` 且存在 `scene_revision` 时由 sidecar 发放新 token。
   - 门禁：新增 `ssot-token-issuance-policy.test.js`，并扩展 `ssot-dispatch-token-issuance.test.js` 覆盖成功/失败/读写/非 eligible/root revision/缺 revision 全边界；`npm --prefix sidecar run test:r20:qa` 139/139 全绿。
6. PR-V3-6（事务失败恢复链路闭环补强）：【已完成，2026-03-07】
   - L2：`failureContextNormalizer` 新增 `nested_context_json` 回填（stage/failed_error*/ambiguity*/candidate* 等关键字段），并将 alias 错误码统一 canonical 化后再参与恢复路由。
   - L2：`recoveryPlanner` 增加事务嵌套错误 baseline 覆盖（`E_COMPONENT_TYPE_INVALID`、`E_COMPONENT_NOT_FOUND`、`E_PROPERTY_NOT_FOUND`、`E_TARGET_NOT_FOUND`、`E_NAME_COLLISION_DETECTED`），补齐“未知嵌套路由 -> 标准恢复步骤”兜底。
   - L2：`fix_steps.depends_on` 支持数字索引到 `step_id` 的确定性解析，避免模板里数字依赖被静默丢失。
   - 门禁：`ssot-recovery-guidance.test.js` 新增 nested_context 回填与数字依赖解析回归并通过。
7. PR-V3-7（合约查询收敛二阶优化）：【已完成，2026-03-07】
   - L2：新增 `contractBundleCache` 单职责缓存层（key=`tool+budget+flags+context+catalog_version`），将 `get_write_contract_bundle` 的重复组包从“重复构建”收敛为“命中返回”。
   - L2：`contractAdvisor` 接入缓存策略中枢，返回 `metadata.cache_hit` 以支持可观测性审计，且不改变既有合约字段语义。
   - 门禁：新增 `ssot-contract-bundle-cache.test.js`（命中、key隔离、LRU驱逐）并通过；`npm --prefix sidecar run test:r20:qa` 全绿（144/144）。

---

## 第二组开发方案（落地版）：Token 自动化闭环（V2）

> 设计原则：拒绝补丁式/最小改动式修复。  
> 执行策略：以“Token 生命周期中枢”重构读写链路，清理重复治理模块，形成 L1->L2->L3 单一职责闭环。

### 1. 修复目标与边界

1. 目标一：将“手动刷新 token”收敛为“平台自动续签 + 受控一次重试”。
2. 目标二：将 token 规则从分散实现收敛为单一策略中枢（可审计、可测试、可扩展）。
3. 目标三：将 `E_SCENE_REVISION_DRIFT` 从“建议性提示”升级为“可执行恢复流程（可开关）”。
4. 非目标：不在第二组引入跨请求多步自动事务编排，不改 L3 业务执行语义。

### 2. 分层职责（L1 / L2 / L3）

#### 2.1 L1（SSOT 字典与编译产物）
职责：定义 token 自动化契约，不承载运行时状态机。

1. 在 `ssot/dictionary/tools.json` 的 `_definitions` 新增 `token_automation_contract`：
   - `issuance_authority`: 固定 `l2_sidecar`。
   - `success_continuation`: `read|write` 成功时可续签。
   - `drift_recovery`: `enabled`、`max_retry=1`、`requires_idempotency=true`。
   - `redaction_policy`: 屏蔽 L3 透传 token 字段，统一由 L2 输出。
2. 为工具增加 `token_family` 元数据（数据驱动，不靠硬编码）：
   - `read_issues_token`
   - `write_requires_token`
   - `local_static_no_token`
3. 编译器新增 token 契约门禁：
   - `write_requires_token` 工具必须声明 `based_on_read_token`。
   - `read_issues_token/write_requires_token` 工具响应必须可携带 `scene_revision`。
4. 产物新增 `token-policy.generated.json`（L2 运行时只读消费）。

涉及文件（L1）：
1. `ssot/dictionary/tools.json`
2. `ssot/compiler/parser/validateDictionaryShape.js`
3. `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
4. `ssot/compiler/emitters/l2/emitTokenPolicyManifest.js`（新增）
5. `ssot/compiler/tests/validateDictionaryShape.test.js`
6. `ssot/compiler/tests/emitMcpToolsJson.test.js`
7. `ssot/compiler/tests/emitTokenPolicyManifest.test.js`（新增）
8. `ssot/artifacts/l2/token-policy.generated.json`（编译产物）

#### 2.2 L2（Sidecar 运行时）
职责：唯一 token 生命周期治理层，负责验证、续签、自动恢复、输出协议。

1. 新增 `tokenLifecycleOrchestrator.js`（新增，单一入口）：
   - 前置：写请求 token 校验。
   - 后置：成功续签、失败清洗、响应标准化。
2. 新增 `tokenDriftRecoveryCoordinator.js`（新增，单一职责）：
   - 仅处理 `E_SCENE_REVISION_DRIFT` 的一次自动恢复。
   - 流程：刷新快照拿新 token -> 原请求重放一次 -> 输出恢复结果。
3. 新增 `tokenPolicyRuntime.js`（新增）：
   - 加载 `token-policy.generated.json`。
   - 提供工具级 token 行为判定 API。
4. 重构 `dispatchSsotRequest.js`：
   - 移除分散续签/清洗逻辑，统一委派给 `tokenLifecycleOrchestrator`。
5. 重构 `turnService.js`：
   - 删除重复 token 分支判断，仅保留编排入口与依赖注入。
6. 输出协议统一新增 `token_automation` 区段：
   - `auto_refreshed`
   - `auto_retry_attempted`
   - `auto_retry_succeeded`
   - `recovery_source`

涉及文件（L2）：
1. `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`
2. `sidecar/src/application/turnService.js`
3. `sidecar/src/application/ssotRuntime/tokenIssuancePolicy.js`（保留为纯策略或并入 orchestrator）
4. `sidecar/src/application/ssotRuntime/tokenLifecycleOrchestrator.js`（新增）
5. `sidecar/src/application/ssotRuntime/tokenDriftRecoveryCoordinator.js`（新增）
6. `sidecar/src/application/ssotRuntime/tokenPolicyRuntime.js`（新增）
7. `sidecar/src/application/errorFeedback/mcpErrorFeedback.js`（补齐自动恢复结果透传）

#### 2.3 L3（Unity 执行层）
职责：提供事实字段，不做 token 签发与恢复策略决策。

1. 统一成功响应 `scene_revision` 兜底（read/write 工具）。
2. 失败上下文补齐修订事实：
   - `scene_revision_at_failure`
   - `requires_context_refresh`
   - 可选 `old_revision/new_revision`
3. 清理 L3 旧 token 口径残余：
   - 删除 executor 中无意义的 `read_token_candidate` 构造/赋值路径。
   - 保留字段兼容但不再产生行为依赖。

涉及文件（L3）：
1. `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`
2. `Assets/Editor/Codex/Infrastructure/Ssot/Executors/SsotExecutorCommon.cs`
3. `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*SsotExecutor.cs`（批量替换旧 token 赋值）
4. `Assets/Editor/Codex/Infrastructure/Ssot/Errors/ExecutionFailureContextBuilder.cs`

### 3. 实施步骤（第二组）

#### Step G2-0：基线冻结（Token 维度）【已完成，2026-03-08】
1. 采集改造前基线：
   - `E_SCENE_REVISION_DRIFT` 发生率
   - 手动 `get_scene_snapshot_for_write` 次数
   - 写链路平均调用数
2. 冻结输入样本与统计脚本（入库）。
3. 本轮落地产物（已入库）：
   - `sidecar/scripts/generate-g2-token-baseline-report.js`
   - `sidecar/tests/application/g2-token-baseline-report-script.test.js`
   - `sidecar/scripts/g2-token-baseline-samples.example.json`
   - `sidecar/scripts/g2-token-baseline-samples.json`
   - `sidecar/.state/g2-token-baseline-report.json`
4. 执行命令与结果：
   - 命令：`npm run metrics:g2:baseline`
   - 输入：`sidecar/scripts/g2-token-baseline-samples.json`
   - 样本量：`140`
   - `drift_incidence_rate_per_write_call=0.046154`
   - `manual_refresh_after_drift_ratio=0.583333`
   - `write_chain_avg_call_count=3.521429`
   - 代表性检查：`all_passed=true`

#### Step G2-1：L1 契约建模【已完成，2026-03-08】
1. 增加 `token_automation_contract` 与 `token_family`。
2. 编译门禁升级并产出 `token-policy.generated.json`。
3. 本轮落地改动（L1）：
   - `ssot/dictionary/tools.json`：新增 `_definitions.token_automation_contract`；全量工具补齐 `token_family + scene_revision_capable`。
   - `ssot/compiler/parser/validateDictionaryShape.js`：新增 token 契约门禁与工具级约束校验（`write_requires_token` 必须声明 `based_on_read_token`，token family 与 kind/scene_revision 能力一致性校验）。
   - `ssot/compiler/emitters/l2/emitTokenPolicyManifest.js`（新增）：产出 `token-policy.generated.json`。
   - `ssot/compiler/emitters/l2/emitMcpToolsJson.js`：输出 `token_automation_contract` 和工具级 token 元数据。
   - `ssot/compiler/index.js`：编译产物新增 `l2/token-policy.generated.json`。
   - `ssot/compiler/tests/emitTokenPolicyManifest.test.js`（新增）及现有测试补强。
4. 编译产物结果：
   - `ssot/artifacts/l2/token-policy.generated.json` 已生成。
   - `family_counts`：`write_requires_token=38`、`read_issues_token=17`、`local_static_no_token=8`。
   - `write_requires_token_missing_based_on_read_token=0`、`scene_revision_ineligible_tools=0`。
5. 本轮验证：
   - `node --test "ssot/compiler/tests/*.test.js"`：`45/45` 通过。
   - `npm run test:r20:qa`：`148/148` 通过。
   - `npm run ssot:build`：编译成功（产物文件数 `8`）。

#### Step G2-2：L2 生命周期中枢落地【已完成，2026-03-08】
1. 引入 `tokenLifecycleOrchestrator`，接管校验/续签/清洗。
2. `dispatchSsotRequest` 与 `turnService` 迁移到中枢调用。
3. 本轮落地改动（L2）：
   - 新增：`sidecar/src/application/ssotRuntime/tokenPolicyRuntime.js`
   - 新增：`sidecar/src/application/ssotRuntime/tokenLifecycleOrchestrator.js`
   - 重构：`sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`（写前校验与写后续签统一经 orchestrator）
   - 重构：`sidecar/src/application/turnService.js`（删除旧写前 token 兼容分支，改为单中枢调用）
   - 重构：`sidecar/src/application/ssotRuntime/startupArtifactsGuard.js`（纳入 `token-policy.generated.json` 启动门禁）
4. 门禁与回归（已通过）：
   - `npm run test:r20:qa`：`154/154` 通过
   - 新增测试：
     - `sidecar/tests/application/ssot-token-policy-runtime.test.js`
     - `sidecar/tests/application/ssot-token-lifecycle-orchestrator.test.js`

#### Step G2-2.5：自动续签验证与观测（新增）【已完成，2026-03-08】
1. 验证续签只发生在 `read_issues_token/write_requires_token` 工具族。
2. 验证失败响应、`scene_revision` 缺失响应不会发放 token。
3. 输出续签命中率、剥离命中率、异常路径样本日志。
4. 本轮落地改动（L2）：
   - 新增：`sidecar/src/application/ssotRuntime/tokenLifecycleMetricsCollector.js`（单职责：续签/剥离/异常计数与快照输出）。
   - 重构：`sidecar/src/application/ssotRuntime/tokenLifecycleOrchestrator.js`（统一采集 finalize 观测事件并上报 metrics collector）。
   - 导出：`sidecar/src/application/ssotRuntime/index.js` 增加 metrics collector 导出，供运行时/测试复用。
   - 新增：`sidecar/scripts/generate-g2-token-auto-issue-observability-report.js`（样本驱动观测报告）。
   - 新增：`sidecar/scripts/g2-token-auto-issue-samples.json` 与 `*.example.json`（固定样本源）。
5. 门禁与报告（已通过）：
   - `node --test sidecar/tests/application/ssot-token-lifecycle-metrics.test.js` 通过。
   - `npm --prefix sidecar run test:g2:qa` 通过（6/6）。
   - `npm --prefix sidecar run metrics:g2:auto-issue:observability:ci` 通过。
   - 产物：`sidecar/.state/g2-token-auto-issue-observability-report.json`
     - `continuation_issueable_hit_rate=1`
     - `redaction_hit_rate=1`
     - `anomaly_total=0`
     - `all_passed=true`

#### Step G2-2.6：续签性能影响评估（新增）【已完成，2026-03-08】
1. 评估自动续签对主请求响应时间影响（与 G2-0 基线对比）。
2. 评估自动续签资源开销（CPU/内存/事件循环阻塞）。
3. 未达门槛前不得进入自动恢复灰度阶段。
4. 本轮落地改动（L2）：
   - 新增：`sidecar/scripts/evaluate-g2-token-auto-issue-performance.js`（基准评估与 CI 门禁脚本）。
   - 脚本口径修正：
     - 延迟回归采用 `min_latency_baseline_ms` 下限，避免微秒级基线导致假阳性。
     - 堆内存门禁采用“比率 + 绝对阈值（`heap_abs_threshold_bytes`）”双条件，避免 GC 符号抖动误判。
     - CPU 门禁采用“比率 + 绝对增量（`cpu_delta_threshold_ms`）”双条件，避免低基线放大误报。
   - 新增测试：`sidecar/tests/application/g2-token-auto-issue-performance-script.test.js`。
5. 门禁与报告（已通过）：
   - `npm --prefix sidecar run metrics:g2:auto-issue:perf:ci` 通过。
   - 产物：`sidecar/.state/g2-token-auto-issue-performance-report.json`
     - `latency_regression_ratio=0.06208`
     - `cpu_regression_ratio=0`
     - `heap_regression_ratio=0.07118`
     - `event_loop_p95_ms=0.000511`
     - `all_passed=true`

#### Step G2-3：影子模式（自动恢复仅决策不执行）【已完成，2026-03-08】
1. 引入 `tokenDriftRecoveryCoordinator`，先只产出“是否可恢复”的决策与阻断原因。
2. 不执行真实重放，仅记录：触发率、可恢复率、阻断原因分布。
3. 影子模式观察通过后才进入灰度执行。
4. 本轮落地改动（L2）：
   - 新增：`sidecar/src/application/ssotRuntime/tokenDriftRecoveryCoordinator.js`（单职责：drift 影子决策与分布统计）。
   - 重构：`sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`
     - 写前 token 校验失败时触发影子决策记录（`before_write_validation`）。
     - Unity 返回失败时触发影子决策记录（`during_dispatch`）。
     - 明确“只记录不重放”，不改写现有错误返回主链路。
   - 重构：`sidecar/src/application/turnService.js`
     - 注入 `ssotTokenDriftRecoveryCoordinator` 单例并传入 `dispatchSsotRequest`。
     - `getStateSnapshotPayload` 新增 `mcp_runtime.token_drift_recovery_shadow` 快照输出，支持观测。
   - 新增开关：`TOKEN_AUTO_RETRY_SHADOW_ENABLED`（默认 true）。
5. 影子决策口径（已固化）：
   - 可恢复条件：`error_code=E_SCENE_REVISION_DRIFT` 且工具族在 `auto_retry_safe_family` 且 `idempotency_key` 存在。
   - 阻断原因：`shadow_mode_disabled` / `drift_recovery_disabled` / `error_code_not_drift` / `tool_policy_missing` / `tool_family_not_safe` / `idempotency_key_missing`。
6. 门禁与回归（已通过）：
   - 新增测试：
     - `sidecar/tests/application/ssot-token-drift-recovery-coordinator.test.js`
     - `sidecar/tests/application/ssot-dispatch-token-drift-shadow.test.js`
   - `npm --prefix sidecar run test:r20:qa`：`160/160` 通过。
   - `npm --prefix sidecar run test:g2:qa`：`6/6` 通过。

#### Step G2-3.5：影子数据分析与策略收敛（新增）【已完成，2026-03-08】
1. 固化高风险工具清单与阻断原因 TopN。
2. 收敛 `auto_retry_safe_family`，禁止未达幂等门槛工具进入灰度。
3. 固化恢复超时预算与并发上限配置。
4. 本轮落地改动（L2）：
   - 新增：`sidecar/scripts/generate-g2-token-shadow-analysis-report.js`（影子数据分析与策略收敛报告）。
   - 新增：`sidecar/scripts/g2-token-shadow-samples.json` 与 `*.example.json`（固定输入样本）。
   - `package.json` 新增命令：
     - `metrics:g2:shadow:analysis`
     - `metrics:g2:shadow:analysis:ci`
5. 产物与策略收敛结果：
   - 产物：`sidecar/.state/g2-token-shadow-analysis-report.json`
   - 阻断原因 Top5：`idempotency_key_missing / tool_family_not_safe / global_limit / queue_limit / recovery_timeout`
   - 高风险工具 Top3：`get_scene_roots`、`get_tool_schema`、`execute_unity_transaction`
   - 家族收敛建议：
     - `proposed_auto_retry_safe_family_keep=["write_requires_token"]`
     - `proposed_auto_retry_safe_family_drop=["local_static_no_token","read_issues_token"]`
   - 恢复预算与并发上限已固化：
     - `snapshot_refresh_timeout_ms=2000`
     - `retry_dispatch_timeout_ms=5000`
     - `total_recovery_timeout_ms=8000`
     - `max_global_recovery_tasks=10`
     - `max_session_recovery_tasks=1`
     - `max_tool_recovery_tasks=1`
     - `max_recovery_queue_size=10`
6. 门禁结果：
   - `npm --prefix sidecar run metrics:g2:shadow:analysis:ci` 通过（`all_passed=true`）。

#### Step G2-3.6：自动恢复测试矩阵（新增）【已完成，2026-03-08】
1. 完成端到端场景：成功恢复、恢复失败、超时、并发阻断、幂等冲突。
2. 完成压力场景：高并发触发恢复、队列饱和、限流阻断。
3. 完成边界场景：恢复期间再次 revision 漂移、恢复中断后的降级返回。
4. 本轮落地改动（L2 测试）：
   - 新增：`sidecar/tests/application/ssot-token-drift-shadow-matrix.test.js`
   - 覆盖矩阵：
     - 端到端决策：可恢复 / 缺失幂等键 / 非 drift 错误 / 不安全工具族
     - 并发阻断：`global_limit`、`session_busy`、`tool_busy`、`queue_limit`
     - 超时阻断：`recovery_timeout`
     - 幂等冲突：`idempotency_conflict`
     - 优先级校验：`global > session > tool > queue`
     - 压力场景：600 次混合事件下计数与比率一致性
     - 边界场景：同请求指纹稳定性（deterministic fingerprint）
5. 同步补强：
   - `tokenDriftRecoveryCoordinator` 新增并发/超时/冲突阻断口径与 `policy_limits` 输出。
   - `dispatchSsotRequest` 保持“影子记录不执行重放”语义。
6. 门禁结果：
   - `npm --prefix sidecar run test:r20:qa`：`164/164` 通过。
   - `npm --prefix sidecar run test:g2:qa`：`8/8` 通过。

#### Step G2-4：自动恢复灰度执行【已完成，2026-03-08】
1. 已落地“一次恢复”执行链路：仅对 `E_SCENE_REVISION_DRIFT` + `auto_retry_safe_family` 触发 `refresh -> replay` 一次重放。
2. 已落地“禁止循环重试”：重放后再次命中 drift 直接失败返回，不进入第二轮恢复。
3. 已落地“双错误上下文”：自动恢复失败返回 `initial_error_* + retry_error_* + auto_retry_failure_reason`。
4. 已落地事务边界：`execute_unity_transaction` 若在 L3 执行中返回 `E_TRANSACTION_STEP_FAILED + nested drift`，返回 `auto_recovery_blocked_reason=inflight_transaction_failure`，不自动重放。
5. 主要实现文件：
   - `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`
   - `sidecar/src/application/ssotRuntime/tokenDriftRecoveryCoordinator.js`
   - `sidecar/src/application/turnService.js`
   - `sidecar/src/index.js`
6. 门禁测试：
   - 新增：`sidecar/tests/application/ssot-dispatch-token-drift-auto-retry.test.js`
   - 回归：`npm --prefix sidecar run test:r20:qa`（169/169）
   - 第二组：`npm --prefix sidecar run test:g2:qa`（8/8）

#### Step G2-4.5：监控与告警门禁（新增）【已完成，2026-03-08】
1. 落地自动恢复执行态观测门禁脚本（L2）：
   - 新增：`sidecar/scripts/generate-g2-token-auto-retry-observability-report.js`
   - 新增输入样本：`sidecar/scripts/g2-token-auto-retry-observability-samples.json`
   - 新增示例样本：`sidecar/scripts/g2-token-auto-retry-observability-samples.example.json`
   - 新增测试：`sidecar/tests/application/g2-token-auto-retry-observability-report-script.test.js`
2. 门禁口径（固定）：
   - 成功率下限：`min_success_rate=0.85`
   - 失败率上限：`max_fail_rate=0.20`
   - 阻断率上限：`max_blocked_rate=0.35`
   - 恢复耗时上限：`max_duration_p95_ms=3000`
   - 误触发上限：`max_misfire_total=0`
   - 同指纹重复重放上限：`max_duplicate_replay_total=0`
3. 回退语义（统一）：
   - 任一门禁失败输出 `fallback_recommendation`，要求切回 `guidance_only`。
   - 固化一键关闭建议：`TOKEN_AUTO_RETRY_ENABLED=false`。
4. 执行结果：
   - `npm --prefix sidecar run metrics:g2:auto-retry:observability:ci` 通过。
   - 产物：`sidecar/.state/g2-token-auto-retry-observability-report.json`
     - `success_rate=0.9`
     - `blocked_rate=0.117647`
     - `duration_p95_ms=1280`
     - `all_passed=true`

#### Step G2-4.6：自动恢复性能闸门（新增）【已完成，2026-03-08】
1. 落地自动恢复性能闸门脚本（L2）：
   - 新增：`sidecar/scripts/evaluate-g2-token-auto-retry-performance.js`
   - 新增输入样本：`sidecar/scripts/g2-token-auto-retry-performance-samples.json`
   - 新增示例样本：`sidecar/scripts/g2-token-auto-retry-performance-samples.example.json`
   - 新增测试：`sidecar/tests/application/g2-token-auto-retry-performance-script.test.js`
2. 熔断口径（固定）：
   - 主链路延迟劣化上限：`max_latency_degradation_ratio=0.10`
   - 吞吐下降上限：`max_throughput_drop_ratio=0.05`
   - 恢复耗时 P95 上限：`max_recovery_duration_p95_ms=3000`
3. 熔断语义（统一）：
   - 任一性能门禁失败输出 `fuse_recommendation.fuse_required=true`。
   - 熔断后模式固定为 `guidance_only`，并输出关闭建议 `TOKEN_AUTO_RETRY_ENABLED=false`。
4. 执行结果：
   - `npm --prefix sidecar run test:g2:qa` 通过（14/14）。
   - `npm --prefix sidecar run metrics:g2:auto-retry:perf:ci` 通过。
   - 产物：`sidecar/.state/g2-token-auto-retry-performance-report.json`
     - `latency_degradation_ratio=0.08`
     - `throughput_drop_ratio=0.04`
     - `recovery_duration_p95_ms=1280`
     - `all_passed=true`

#### Step G2-5：L3 事实字段收口【已完成，2026-03-08】
1. L3 成功响应 `scene_revision` 兜底保持单口径：
   - `SsotRequestDispatcher.Success(...)` 在缺失时统一补齐 `scene_revision`。
2. L3 失败上下文事实字段已收口：
   - `scene_revision_at_failure`
   - `error_context_issued_at`
   - `error_context_version`
   - `requires_context_refresh`
3. 清理 L3 旧 token 赋值残余（物理删除）：
   - 批量移除所有 executor 中 `read_token_candidate = ...` 的旧赋值路径。
   - 删除 `SsotExecutorCommon.BuildReadTokenCandidate()`（旧能力入口下线）。
4. 本轮落地文件（L3）：
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/SsotExecutorCommon.cs`
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*.cs`（移除 `read_token_candidate` 赋值残留）

#### Step G2-5.5：协议与可观测性【已完成，2026-03-08】
1. 协议收口（L2）：
   - `dispatchSsotToolForMcp` 成功/失败响应统一包含 `token_automation` 区段。
   - `data.token_automation` 同步镜像，避免调用侧在 `body/data` 双路径分裂解析。
2. 指标收口（L2）：
   - 在 `getStateSnapshotPayload().mcp_runtime.token_automation_metrics` 固化输出：
     - `token_auto_refresh_total`
     - `token_auto_retry_success_total`
     - `token_auto_retry_fail_total`
   - 同时输出补充指标：
     - `token_auto_retry_attempt_total`
     - `token_auto_retry_blocked_total`
     - `token_auto_retry_duration_p95_ms`
3. 本轮落地文件（L2）：
   - `sidecar/src/application/turnService.js`
   - `sidecar/tests/application/ssot-write-token-auto-refresh.test.js`
4. 本轮门禁结果：
   - `npm --prefix sidecar run test:r20:qa`：`170/170` 通过。
   - `npm --prefix sidecar run test:g2:qa`：`14/14` 通过。

#### Step G2-6：测试与门禁【已完成，2026-03-08】
1. L1 编译门禁测试（契约缺失即失败）。
   - `npm --prefix sidecar run ssot:build`：通过（产物 `files=8`）。
   - `node --test "ssot/compiler/tests/emitMcpToolsJson.test.js" "ssot/compiler/tests/emitTokenPolicyManifest.test.js" "ssot/compiler/tests/validateDictionaryShape.test.js"`：`26/26` 通过。
2. L2 自动恢复链路测试（成功/失败/禁止循环）。
   - `npm --prefix sidecar run test:g2:qa`：`14/14` 通过。
   - `npm --prefix sidecar run test:r20:qa`：`170/170` 通过（含 `dispatch auto-retries drift once and succeeds`、`dispatch auto-retry never loops`、`dispatch blocks in-flight transaction nested drift`）。
3. L3 事实字段快照测试（`scene_revision`、failure context）。
   - MCP 实跑：`POST /mcp/run_unity_tests`（`scope=editmode`, `test_filter=UnityAI.Editor.Codex.Tests.EditMode`）：
   - `status=succeeded`，`total=82`，`passed=82`，`failed=0`（`run_id=utr_editor_1772908359693_51bfe5c5`）。
4. 回归测试：第一组与事务链路不回退。
   - 指标闸门（CI）全部通过：
   - `npm --prefix sidecar run metrics:g2:auto-issue:observability:ci`
   - `npm --prefix sidecar run metrics:g2:auto-issue:perf:ci`
   - `npm --prefix sidecar run metrics:g2:shadow:analysis:ci`
   - `npm --prefix sidecar run metrics:g2:auto-retry:observability:ci`
   - `npm --prefix sidecar run metrics:g2:auto-retry:perf:ci`
   - 关键结果：`success_rate=0.9`、`duration_p95_ms=1280`、`latency_degradation_ratio=0.08`、`throughput_drop_ratio=0.04`，满足第二组放量门禁。

### 4. 废弃/替代清理清单（第二组必须执行）

1. 清理重复 token 决策入口：
   - `turnService` 内散落 token 校验/续签分支迁移后删除。
2. 清理旧 token 输出口径：
   - 删除 L3 executor 侧 `read_token_candidate` 无效赋值代码。
3. 清理重复治理模块：
   - 若 `tokenIssuancePolicy` 与 orchestrator 职责重叠，收敛为单入口并删除冗余导出。
4. 清理测试冗余：
   - 合并旧“按模块拆散”的 token 测试为“策略中枢 + 恢复链路 + 协议快照”三类门禁。

### 5. 第二组验收标准（量化）

1. `E_SCENE_REVISION_DRIFT` 后人工刷新步骤占比下降 `>=70%`。
2. 写链路平均调用次数下降 `>=25%`（与 G2-0 基线对比）。
3. 自动恢复成功率 `>=85%`（限定一次重放）。
4. 自动恢复不产生循环重试（`max_retry=1` 违反率 `=0`）。
5. 第一组既有回归测试保持全绿，不引入协议破坏。

### 6. 执行纪律（第二组）

1. 不以单工具特判修复 token 行为，所有规则必须走 `token_family + token_automation_contract`。
2. 不在 L3 引入策略分支，L3 只输出事实字段。
3. 不保留双入口 token 决策代码，迁移后必须物理删除冗余实现。

### 7. 第二组遗漏补强（吸取第一组 V1/V2 教训）

> 目的：避免“先实现再补洞”。以下项纳入第二组主方案的强制门禁，不作为可选优化。

#### 7.1 自动重试安全边界（必须先定义）
1. 新增 `auto_retry_safe_family`（L1 字典）：
   - 仅允许幂等且可回放的写工具自动重试。
   - 非幂等工具（含不可逆副作用）即使 `E_SCENE_REVISION_DRIFT` 也只返回结构化指引，不自动重放。
2. 新增 `auto_retry_policy`（L1 字典）：
   - `max_retry=1` 固定。
   - `requires_idempotency_key=true`。
   - `on_retry_failure=return_both_errors`（必须同时返回首错与重试错）。
3. L2 `tokenDriftRecoveryCoordinator` 必须按字典策略执行，不允许硬编码工具名白名单。

#### 7.2 并发与竞态防护（必须先落地）
1. Token 绑定上下文扩展：
   - `thread_id/session_id`（若可得）纳入 token entry。
   - 校验时必须匹配来源上下文，防止跨会话复用 token。
2. 自动重放前增加请求指纹：
   - `tool_name + normalized_payload + idempotency_key + scene_revision`。
   - 同指纹在恢复窗口内只允许一次自动重放。
3. 只允许“同请求链路”触发自动恢复：
   - 必须校验 `request_id/correlation_id` 一致，禁止旧响应触发新 token 发放。

#### 7.3 灰度与回滚（必须内建）
1. 第二组拆为两阶段开关发布：
   - `token_auto_issue_enabled`（先开）
   - `token_auto_retry_enabled`（后开）
2. 需要“影子模式”：
   - 先只计算“本应自动重试”的决策与成功率，不真实重放，观察 1-2 天基线。
3. 一键回退要求：
   - 任一开关关闭后，系统立即退回“结构化指引 + 人工重试”模式，不影响主链路可用性。

#### 7.4 失败语义与协议完整性（必须统一）
1. 自动恢复失败时返回结构化双错误：
   - `initial_error_code/message`
   - `retry_error_code/message`
   - `auto_retry_attempted=true`
2. 自动恢复成功时返回恢复事实：
   - `auto_retry_succeeded=true`
   - `recovery_source=scene_snapshot_refresh`
   - `refreshed_token_issued=true`
3. 禁止只返回“最终状态”覆盖首错（避免丢失诊断链）。

#### 7.5 观测指标与阻断阈值（必须）
1. 最小指标集（L2）：
   - `token_auto_retry_attempt_total`
   - `token_auto_retry_success_total`
   - `token_auto_retry_fail_total`
   - `token_auto_retry_blocked_by_policy_total`
   - `token_cross_context_reject_total`
2. 阈值门禁（上线阻断）：
   - 自动重试失败率 > 20%（P0 工具）阻断放量。
   - 同指纹重复自动重放 > 0 阻断上线。

#### 7.6 清理职责补充（防止“新旧并存”）
1. 若 `tokenLifecycleOrchestrator` 上线，`turnService` 内旧 token 分支必须同 PR 删除，不允许保留“备用逻辑”。
2. 若 `tokenPolicyRuntime` 上线，任何手工工具名判断必须删除或改为字典驱动。
3. L3 executor 中 `read_token_candidate` 赋值路径必须批量删除，不允许逐文件遗留。

#### 7.7 第二组实施顺序（修订）
1. `G2-0` 基线冻结。
2. `G2-1` L1 契约 + `auto_retry_safe_family` + 编译门禁。
3. `G2-2` L2 生命周期中枢（仅自动续签，不自动重试）。
4. `G2-3` 影子模式观测（自动重试决策只记录不执行）。
5. `G2-4` 自动重试灰度开启（仅 `auto_retry_safe_family`）。
6. `G2-5` L3 事实字段收口 + 旧字段清理。
7. `G2-6` 全量回归 + 指标达标后放量。

#### 7.8 第二组新增验收口径（补充）
1. 自动重试仅发生在 `auto_retry_safe_family`，违规率 `=0`。
2. 自动重试成功任务中“人工介入步骤”下降 `>=60%`。
3. 自动重试失败返回双错误字段覆盖率 `=100%`。
4. 关闭 `token_auto_retry_enabled` 后，系统行为可在一次发布内完整回退。

#### 7.9 事务场景自动恢复策略（补充）
1. `execute_unity_transaction` 的 token 自动恢复仅允许在“L2 预校验阶段”触发：
   - 场景：写前校验命中 `E_SCENE_REVISION_DRIFT`，事务尚未下发到 L3。
   - 行为：刷新快照并用同一请求重放整个事务一次。
2. 若事务已进入 L3 执行并返回 `E_TRANSACTION_STEP_FAILED`：
   - 不做 token 自动重放。
   - 保持第一组恢复路径（结构化 `fix_steps`）处理，避免“部分执行状态”二次放大。
3. 自动重放事务时必须保持：
   - 同一 `transaction_id`
   - 同一 `idempotency_key`
   - 同一步骤序列（不做“从失败步骤继续执行”）。
4. 二次评审判定（范围边界）：
   - 不采纳“事务已进入 L3 执行后，按 `rollback_policy` 自动回滚并整事务重放”。
   - 原因：该策略需要跨层回滚事务可观测一致性保证，风险与耦合度超出第二组目标。
   - 现阶段处理：返回 `auto_recovery_blocked_reason=inflight_transaction_failure`，并强制输出手动恢复 `fix_steps`。

#### 7.10 自动恢复上下文一致性检查（补充）
1. 自动恢复前必须满足：
   - 已拿到新 `read_token_candidate`。
   - 新 token 对应 `scene_revision` 与旧 token 不同（确认为真实刷新）。
2. 自动恢复执行过程中若再次命中 revision 漂移：
   - 立即终止自动恢复（不再二次重试）。
   - 返回 `auto_retry_attempted=true` + `auto_retry_succeeded=false` + 阻断原因。
3. 不增加额外“锚点预检查读请求”：
   - 避免恢复前再引入额外 RTT。
   - 锚点失效由一次重放后的结构化错误承接（第一组能力复用）。
4. 自动恢复失败后的用户指引（新增）：
   - 必须返回：`auto_retry_attempted=true`、`auto_retry_succeeded=false`、`auto_retry_failure_reason`。
   - 必须返回：`next_suggested_action` 与可执行 `fix_steps`（禁止仅返回文本解释）。
   - 必须同时保留：`initial_error_code` 与 `retry_error_code`（双错误上下文）。

#### 7.11 自动恢复超时与并发边界（补充）
1. 恢复预算（可配置）：
   - `snapshot_refresh_timeout_ms`（默认 2000）
   - `retry_dispatch_timeout_ms`（默认 5000）
   - `total_recovery_timeout_ms`（默认 8000）
2. 超时处理：
   - 超时即终止恢复，返回结构化失败与 `auto_retry_timeout=true`。
   - 不进入第二轮恢复。
3. 并发控制：
   - 全局上限：`max_global_recovery_tasks`（默认 10）。
   - 会话上限：同一会话同一时刻仅允许一个自动恢复任务。
   - 工具上限：同一工具同一时刻仅允许一个自动恢复任务。
   - 阻断优先级：`global_limit > session_busy > tool_busy > queue_limit`。
   - 被阻断请求必须返回 `auto_recovery_blocked_reason` 与下一步建议，不阻塞主链路。

#### 7.12 自动恢复可观测性（补充）
1. 响应新增/补齐字段：
   - `auto_recovery_triggered`
   - `auto_recovery_reason`
   - `auto_recovery_duration_ms`
   - `auto_recovery_blocked_reason`
2. 指标新增：
   - `token_auto_retry_triggered_by_tool_total`
   - `token_auto_retry_blocked_by_reason_total`
   - `token_auto_retry_duration_p95_ms`
3. 日志要求：
   - 触发、成功、失败、阻断四类事件必须输出结构化日志并包含请求指纹。

#### 7.13 细粒度配置（补充）
1. 采纳：工具级 `auto_retry_enabled` 覆盖开关（默认继承全局）。
2. 不采纳（第二组范围外）：用户级 `auto_retry_preference` 协议扩展。
3. 不采纳（第二组范围外）：按业务场景动态切换恢复策略。

#### 7.14 范围边界（补充）
1. 第二组仅覆盖 `E_SCENE_REVISION_DRIFT` 自动恢复。
2. `E_PROPERTY_NOT_FOUND` 等非 token 错误不纳入第二组自动恢复链路，继续走第一组结构化指引能力。

#### 7.15 幂等与重放规则（补充）
1. 自动恢复必须复用原 `idempotency_key`，否则拒绝自动重放。
2. 不实现“事务部分成功后从中间步骤续跑”：
   - 该模式会引入高耦合状态恢复复杂度。
   - 第二组坚持“整请求一次重放”或“不重放”二选一。
3. 若命中幂等冲突，返回结构化冲突信息并停止自动恢复。

#### 7.16 实施顺序（最终版）
1. `G2-0` 基线冻结。
2. `G2-1` L1 契约 + 编译门禁。
3. `G2-2` 生命周期中枢（只续签）。
4. `G2-2.5` 续签验证与观测。
5. `G2-2.6` 续签性能影响评估。
6. `G2-3` 影子模式（只决策不执行）。
7. `G2-3.5` 影子数据分析与策略收敛。
8. `G2-3.6` 自动恢复测试矩阵。
9. `G2-4` 自动恢复灰度执行。
10. `G2-4.5` 监控与告警门禁。
11. `G2-4.6` 自动恢复性能闸门。
12. `G2-5` L3 事实字段收口 + 旧代码清理。
13. `G2-5.5` 协议与可观测性收口。
14. `G2-6` 全量回归与放量。

#### 7.17 验收标准补充（量化）
1. 自动恢复误触发率 `=0`（不该触发时绝不触发）。
2. 自动恢复 P95 耗时 `<=3000ms`。
3. 自动恢复引入的主请求响应时间劣化 `<=10%`（与 G2-0 基线对比）。
4. 自动恢复触发/成功/失败/阻断四类事件日志覆盖率 `=100%`。
5. 自动恢复失败后 `auto_retry_failure_reason + next_suggested_action + fix_steps` 返回覆盖率 `=100%`。
6. 自动恢复并发阻断准确率 `=100%`（阻断原因与策略一致）。
7. 自动恢复不引入崩溃、泄漏、跨请求污染（稳定性回归全绿）。

#### 7.18 自动恢复降级策略（新增）
1. 降级链路固定为三级：
   - 第一级：自动恢复（一次）。
   - 第二级：结构化指引 + 手动恢复（第一组能力）。
   - 第三级：诊断详情（失败上下文 + 阻断原因 + 双错误码）。
2. 触发条件：
   - 自动恢复超时、阻断、执行失败任一命中即降级到第二级。
   - 若二级仍失败，输出第三级诊断信息并停止自动重试。
3. 降级语义必须稳定：
   - 不覆盖首错。
   - 不隐藏自动恢复发生事实。
   - 不返回“下一步为空”的指引。

#### 7.19 性能影响评估口径（新增）
1. 必测指标：
   - 主请求响应时间劣化比例。
   - 系统吞吐变化。
   - 自动恢复耗时分位（P50/P95）。
2. 阻断阈值：
   - 主请求响应时间劣化 `>10%` 触发告警与灰度收缩。
   - 吞吐下降 `>5%` 触发熔断自动恢复。
3. 资源边界：
   - 自动恢复执行使用独立并发配额，不挤占主链路执行槽位。

#### 7.20 自动恢复测试覆盖（新增）
1. 端到端测试：
   - 单工具恢复成功。
   - 单工具恢复失败（锚点失效/上下文失效）。
   - 事务预校验阶段恢复成功。
   - 自动恢复超时与并发阻断。
   - 幂等冲突检测与降级。
2. 压测测试：
   - 并发恢复洪峰。
   - 队列饱和与阻断优先级。
3. 边界测试：
   - 恢复过程中 revision 再次变化。
   - 自动恢复中断后的降级输出完整性。

#### 7.21 错误码映射完整性（新增）
1. 第二组自动恢复触发错误码仅限：
   - `E_SCENE_REVISION_DRIFT`
   - （如存在同义码）在 L2 先归一化到上述 canonical 码再处理。
2. 明确不触发自动恢复的错误码族：
   - `E_PROPERTY_NOT_FOUND`
   - `E_TRANSACTION_REF_PATH_INVALID`
   - `E_TARGET_ANCHOR_CONFLICT`
   - 其他非 token 错误统一走第一组恢复链路。
3. 映射门禁：
   - 自动恢复触发/不触发矩阵测试必须覆盖并持续回归。
