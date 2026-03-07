# MCP工具开发痛点记录

日期：2026-03-06  
状态：待解决
最后更新：2026-03-07

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

#### Step G1-1：L1契约元数据建模
1. 在字典中为以下工具补齐增强字段：
   - `execute_unity_transaction`
   - `set_component_properties`
   - `set_serialized_property`
   - `save_scene`
2. 明确每个工具至少包含：
   - 1个可执行正例
   - 2个反例
   - 对应错误修复映射
3. 更新字典shape校验，缺字段即编译失败。

**交付物**
1. 字典字段稳定可编译。
2. 产物包含增强字段（非手工patch）。

#### Step G1-2：L2合约组包重构
1. 新建 `contractAdvisor.js`，将模板提取、反例注入、关联工具收敛统一在一个入口。
2. `get_write_contract_bundle` 完全迁移到 `contractAdvisor`。
3. 输出协议升级（保留兼容字段）：
   - 新增：`common_mistakes`、`quick_fixes`、`related_contracts`。
   - 旧字段不删（保持客户端兼容）。

**交付物**
1. 同一工具一次调用返回“可执行最小集”。
2. 高频场景不再依赖连续多次 `get_tool_schema`。

#### Step G1-3：L2错误反馈结构化
1. 新建 `errorGuidanceRegistry.js`，将错误码映射集中管理。
2. `mcpErrorFeedback.js` 输出新增字段：
   - `suggested_action`
   - `suggested_tool`
   - `fix_hint`
   - `retry_policy`（沿用并标准化）
3. `turnService.js` 所有失败出口统一通过 `withMcpErrorFeedback`。

**交付物**
1. 错误反馈可被模型直接执行，不再只靠“记住规则”。
2. 不同入口错误协议一致。

#### Step G1-4：L3错误码一致性收口（仅审计+补齐）
1. 盘点第一组相关工具的失败码分布。
2. 对“同类错误多码”做映射收敛（仅必要处调整）。
3. 禁止新增自由文本错误（无error_code）。

**交付物**
1. L2可稳定命中错误修复映射。
2. 不引入执行行为变更。

#### Step G1-5：测试与门禁
1. L1编译测试：
   - 增强字段缺失时失败。
   - 产物字段齐全。
2. L2合同测试：
   - `get_write_contract_bundle` 返回结构化增强字段。
   - 同工具无需再重复 `get_tool_schema` 才能构造最小payload。
3. L2错误反馈测试：
   - `E_SCENE_REVISION_DRIFT`、`E_TRANSACTION_REF_PATH_INVALID`、`E_PROPERTY_NOT_FOUND` 均返回结构化下一步。
4. 回归测试：
   - 不破坏现有 `tools/list` 可见性、schema校验、事务门禁。

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
1. 批量UI场景中，首次构造成功率提升到 `>=85%`。
2. 同类任务平均查询调用次数下降 `>=30%`。
3. 错误后盲重试次数（无结构化修复）下降到 `<20%`。
4. 不引入L3执行行为回归（核心回归测试全绿）。
