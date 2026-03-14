# Workflow Target Bootstrap 开发方案

## 1. 执行摘要
- 【已确认】`workflow.script.create_compile_attach` 已可跑通，但当前只覆盖脚本链路（`create_script_task -> wait_compile_ready -> attach_component_task`），默认依赖目标锚点已存在。
- 【已确认】`create_object` 在 SSOT schema 与 Unity 执行器侧已支持 `name_collision_policy`（`fail/suffix/reuse`），且已有执行与测试基础。
- 【缺失】Planner `create.object` mapper 尚未透传 `name_collision_policy`，导致 workflow 内“补目标”场景无法稳定声明冲突策略与幂等语义。
- 【缺失】当前 workflow runtime 仅支持 `submit_task/wait_task_status`，尚未接入显式 `ensure_target` 前置步骤。
- 本次方案只做两件事：
  - `name_collision_policy` 透传。
  - `ensure_target` 设计与接入（对外单入口、对内显式步骤）。
- 【明确排除】不做点击验收，不做 PlayMode 点击扩展，不做 simulate click/trigger_button_onclick/UI 输入模拟工具，不扩新验收工具链。

## 2. 当前现状分析

### 2.1 现有脚本 workflow 的范围
- 【已确认】SSOT 模板 `script_create_compile_attach.v1` 当前只有 3 步：`create_script_task`、`wait_compile_ready`、`attach_component_task`。
- 【已确认】模板步骤类型当前仅覆盖 `submit_task` 与 `wait_task_status`。
- 【可复用】现有 `workflow_orchestration.step_results` 已可承载步骤级 trace。
- 【缺失】尚无显式“目标存在性保障”步骤。

### 2.2 当前目标存在性约束
- 【已确认】workflow candidate 规则当前要求 `target_anchor_available` 与 `thread_id_available`。
- 【已确认】runtime 对 workflow 输入较硬，缺 `thread_id` 会直接失败。
- 【缺失】“目标不存在时自动补建并继续 attach”的单入口能力。

### 2.3 `name_collision_policy` 的现状
- 【已确认】`create_object` schema 已包含 `name_collision_policy`。
- 【已确认】Unity 侧 `NameCollisionPolicyService` + `CreateObjectSsotExecutor` 已输出：`applied_policy`、`existing_candidates_count`、`existing_candidate_path`、`pre_check_existing`。
- 【已确认】编辑器侧已有 `suffix/reuse` 覆盖测试。
- 【缺失】`BlockToToolPlanMapper.mapCreateObject` 未透传 `input.name_collision_policy`。

### 2.4 当前可复用能力
- 【可复用】SSOT 真源与编译链：`ssot/dictionary/tools.json`、`ssot/compiler/parser/validateDictionaryShape.js`、`ssot/compiler/emitters/l2/emitMcpToolsJson.js`。
- 【可复用】Planner 主干：`sidecar/src/application/turnService.js`（workflow dispatch）。
- 【可复用】映射主干：`sidecar/src/application/blockRuntime/execution/BlockToToolPlanMapper.js`。
- 【可复用】建议与恢复：`contractAdvisor.js`、`PlannerEntryErrorHintBuilder.js`、`errorGuidanceRegistry.js`。
- 【可复用】现有 token 漂移恢复、error mapping、step trace 基础能力。

### 2.5 当前缺失点
- 【缺失】`name_collision_policy` 在 planner 路径的端到端透传缺口。
- 【缺失】`ensure_target` 的 SSOT 表达（step 类型/元数据/输出 contract）缺失。
- 【缺失】`parent_anchor` 与 `resolved_target` 语义尚未被强约束分离。
- 【高风险】若第一轮引入模糊复用（如默认选第一个同名对象），会直接破坏目标确定性与重试稳定性。

## 3. 方案目标与边界
- 本次解决：
  - 补齐 `name_collision_policy` 透传。
  - 在 `workflow.script.create_compile_attach` 内引入显式 `ensure_target` 前置步骤。
- 本次不解决：
  - 点击验收及任意交互模拟能力。
  - 新增并行执行链或新工具体系。
- 第一轮语义边界（强约束）：
  - `ensure_target` 只是 workflow 层对现有 `create_object` / `create.object` 的显式封装。
  - `ensure_target` 不是新的目标创建 DSL，不引入第二套 create/reuse 语义。
  - workflow runtime 不发明新的创建规则系统，只编排已有能力并产出可追踪结果。
  - `parent_anchor` 与 `resolved_target` 必须语义分离，禁止一个字段兼任两种语义。
  - 第一轮禁止模糊复用：`reuse` 必须唯一命中，多候选必须 fail-fast。
- 架构边界：
  - SSOT 仍是唯一真源。
  - `turnService` 第一轮仅负责 workflow step 调度与主流程衔接；规则本体不在 `turnService` 继续膨胀。
  - 若第一轮有过渡逻辑驻留 `turnService`，必须封装为小 helper/adapter，并标注后续收口路径。

## 4. 方案一：`name_collision_policy` 透传

### 4.1 问题定义
- 当前 `create_object` 已具备冲突策略能力，但 planner `create.object` 映射链未透传该字段。
- 导致 workflow 无法稳定表达“创建失败 / 复用”语义，影响幂等与错误恢复。

### 4.2 推荐设计
- 在 `create.object` block input 中允许可选 `name_collision_policy`，由 mapper 透传到 `create_object` payload。
- 透传策略：
  - 未提供：沿用执行器默认策略（由 `SsotCreateFamilyContract.DefaultOnConflict` 决定）。
  - 提供：原样透传，执行器做最终校验并返回 `applied_policy`。
- 第一轮统一原则（适用于 workflow `ensure_target` 场景）：
  - 仅允许 `fail/reuse`。
  - 禁止模糊复用（多候选不允许兜底选第一个）。

### 4.3 第一轮支持范围
- 推荐支持：
  - `fail`：存在冲突即失败，确保确定性。
  - `reuse`：唯一命中则复用，提升重试幂等。
- 对幂等的作用：
  - `reuse` + 唯一命中可避免重复创建。
  - `fail` 可避免 silent drift（静默漂移）。
- 对目标确定性的作用：
  - 通过 `existing_candidates_count` 与 `applied_policy` 明确裁决结果。

### 4.4 暂缓范围
- 暂缓进入 ensure_target 主路径：`suffix`。
- 暂缓策略扩展：`rename`、`auto_increment`、复杂 merge 行为。
- 原因：这些策略天然引入命名漂移或语义分叉，不适合第一轮“可追踪+可幂等”目标。

### 4.5 对 mapper / runtime / workflow 的影响
- mapper：
  - 需要在 `mapCreateObject` 透传 `name_collision_policy`。
- runtime：
  - 复用现有 `CreateObjectSsotExecutor`；不新增第二套冲突裁决逻辑。
- workflow：
  - 读取 `applied_policy` 与候选计数，形成 `resolved_target` 决策输入。

### 4.6 风险
- 【风险】透传后，历史默认行为与显式策略行为可能出现回归差异。
- 【风险】若不设置“多候选 fail-fast”，`reuse` 可能导致目标不稳定。
- 【控制】将“禁止模糊复用”提升为第一轮统一原则，并通过测试强约束。

### 4.7 验证方式
- 单测：mapper 透传、类型非法拒绝、默认策略回退。
- 集成：`create.object` 在 `fail/reuse` 分支结果一致可观测。
- 重试验证：同输入重试下 `resolved_target` 稳定。

## 5. 方案二：`ensure_target`（对外像 A，对内像 B）

### 5.1 问题定义
- “目标存在性检查/创建”是 attach 前不可跳过的前置动作。
- 若让用户先调一个 workflow 再调另一个 workflow，会造成入口体验退化。
- 若做成纯隐式魔法，会失去可追踪性与可定位性。

### 5.2 推荐设计
- 对外：维持单入口 `workflow.script.create_compile_attach`。
- 对内：引入显式 `ensure_target` step，作为 workflow 前置步骤。
- 语义边界（第一轮）：
  - `ensure_target` 仅复用现有 `create_object` / `create.object`。
  - `ensure_target` 不定义新的目标创建语言，不持有独立规则系统。
  - `ensure_target` 只负责：
    - 目标存在性检查。
    - 受限使用 `name_collision_policy`（第一轮仅 `fail/reuse`）。
    - 产出 `resolved_target`。
    - 为 attach 提供稳定目标。

### 5.3 对外入口形态
- 对外仍是一次 `planner_execute_mcp` 调用。
- 当 `ensure_target.enabled=true` 时，目标 bootstrap 信息在 `input.ensure_target` 内声明，不要求用户先调用第二个 workflow。
- 入口示意（去除语义混用）：

```json
{
  "block_spec": {
    "block_id": "__workflow_block_id__",
    "block_type": "MUTATE",
    "intent_key": "workflow.script.create_compile_attach",
    "input": {
      "thread_id": "__thread_id__",
      "user_intent": "__user_intent__",
      "ensure_target": {
        "enabled": true,
        "parent_anchor": {
          "object_id": "__parent_object_id__",
          "path": "__parent_path__"
        },
        "new_object_name": "__new_object_name__",
        "object_kind": "ui_button",
        "set_active": true,
        "name_collision_policy": "reuse"
      },
      "file_actions": [],
      "visual_layer_actions": []
    },
    "based_on_read_token": "__based_on_read_token__",
    "write_envelope": {
      "idempotency_key": "__idempotency_key__",
      "execution_mode": "execute"
    }
  }
}
```

### 5.4 对内显式步骤结构
- 第一轮目标步骤链：
  1. `ensure_target_object`（新，显式）
  2. `create_script_task`
  3. `wait_compile_ready`
  4. `attach_component_task`
- `ensure_target_object` 必须写入 `step_results`（成功/失败/跳过均可见）。
- `ensure_target_object` 内部调用现有 `create.object`，不是 workflow 私有 create 方言。

### 5.5 输入与输出设计
- 语义分离原则（第一轮硬约束）：
  - `parent_anchor`：仅表示“在哪个父节点下查找/创建目标”。
  - `resolved_target`：仅表示“后续 attach/步骤消费的真实目标”。
  - 启用 `ensure_target` 时，禁止把 `block_spec.target_anchor` 同时当父锚点与最终目标锚点使用。
- 输入（最小）：
  - `ensure_target.enabled`：布尔。
  - `ensure_target.parent_anchor.object_id/path`：启用时必填。
  - `ensure_target.new_object_name`：启用时必填。
  - `ensure_target.object_kind`：启用时必填。
  - `ensure_target.set_active`：可选，默认 `true`。
  - `ensure_target.name_collision_policy`：第一轮仅允许 `fail/reuse`。
- 输出（最小强制）：
  - `resolved_target_id`
  - `resolved_target_path`
  - `created_or_reused`（`created` 或 `reused`）
  - `collision_policy_used`
- 建议附加输出：
  - `existing_candidates_count`
  - `existing_candidate_path`
  - `ensure_target_step_id`
- `resolved_target` contract（B3 冻结，v1）：
  - 规范载体：`output_data.workflow_orchestration.resolved_target`。
  - 字段定义：
    - `resolved_target_id`：字符串，来自 `ensure_target_object.output_data.target_object_id`。
    - `resolved_target_path`：字符串，来自 `ensure_target_object.output_data.target_path`。
    - `collision_policy_used`：`fail|reuse`，来自 `ensure_target_object.output_data.applied_policy`（归一化后）。
    - `existing_candidates_count`：整数，来自 `ensure_target_object.output_data.existing_candidates_count`（缺省按 `0`）。
    - `existing_candidate_path`：字符串，来自 `ensure_target_object.output_data.existing_candidate_path`（可空）。
    - `created_or_reused`：派生字段，规则固定为：
      - 当 `collision_policy_used == reuse` 且 `existing_candidates_count == 1` 时为 `reused`；
      - 其余成功路径为 `created`。
    - `ensure_target_step_id`：固定为 `ensure_target_object`，用于 trace 定位。
- 冻结约束（B3）：
  - `resolved_target_id/path` 缺失时必须 fail-fast，不允许带空值继续 attach。
  - 第一轮禁止模糊复用：`reuse` 且 `existing_candidates_count > 1` 必须 fail-fast。
  - `parent_anchor` 只作为 ensure_target 输入上下文，不进入后续 attach 目标计算。

### 5.6 与现有脚本 workflow 的关系
- 向后兼容：
  - `ensure_target.enabled=false` 时，保持 legacy 三步语义不变。
- 启用 ensure_target：
  - create_script / wait_compile 不改写 `resolved_target`，仅透传 workflow 上下文。
  - attach 必须消费 `resolved_target`，且把它作为唯一目标来源。
  - 若显式传入 `target_anchor` 且与 `resolved_target` 不一致，attach 前必须 fail-fast（禁止隐式覆盖）。
  - create_script/wait_compile 仍复用原链路，不引入新脚本执行语义。

### 5.7 错误边界与恢复
- 必须 fail-fast：
  - `ensure_target.enabled=true` 但 `parent_anchor/new_object_name/object_kind` 缺失。
  - `name_collision_policy` 非第一轮允许集合。
  - `reuse` 且 `existing_candidates_count > 1`。
  - `ensure_target` 成功但缺少 `resolved_target_id/path`。
  - attach 前发现显式目标与 `resolved_target` 冲突。
- 可复用：
  - `reuse` 且唯一命中。
- 恢复：
  - 复用现有 error feedback/recovery 主链，新增 ensure_target 专属错误码模板。

### 5.8 风险
- 【风险】若 ensure_target 扩展为私有 DSL，会导致与 `create.object` 语义漂移。
- 【风险】若混淆 `parent_anchor` 与 `resolved_target`，会产生隐式目标漂移。
- 【风险】若放开模糊复用，会出现“成功但挂错对象”。
- 【控制】第一轮保持最小语义闭环：显式步骤、单一策略族、严格 fail-fast。

### 5.9 验证方式
- 覆盖路径：
  - 不存在 -> 创建 -> attach 成功。
  - 存在且唯一 -> reuse -> attach 成功。
  - 存在多候选 -> fail-fast（禁止默认选第一个）。
  - 冲突目标 -> attach 前拦截失败。
- 重试验证：
  - 相同输入多次执行时，`resolved_target` 不漂移。

## 6. 具体开发步骤

### 主线 A：`name_collision_policy` 透传

#### Step A0：扫描 schema / mapper / runtime 现状
- 目的：明确字段断点，建立基线。
- 修改模块 / 文件：
  - `ssot/dictionary/tools.json`
  - `sidecar/src/application/blockRuntime/execution/BlockToToolPlanMapper.js`
  - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/CreateObjectSsotExecutor.cs`
  - `Assets/Editor/Codex/Infrastructure/Ssot/Create/NameCollisionPolicyService.cs`
- 改动内容：仅分析并形成字段流转说明（文档性工作）。
- 为什么这样改：先锁边界，避免误改。
- DoD：形成“输入 -> mapper -> executor -> result”的字段流转图。
- 是否依赖前一步：否。
- 是否可独立提交：是（文档）。

**Step A0 执行结果（2026-03-10）**
- 已完成 `name_collision_policy` 字段流转扫描，形成基线结论：
  - `create_object` 的 SSOT schema 已声明 `name_collision_policy`，值域为 `fail/suffix/reuse`。
  - Unity 生成契约 `SsotCreateFamilyContract` 已固定：
    - `DefaultOnConflict = fail`
    - `AllowedOnConflictPolicies = [fail, suffix, reuse]`
  - Unity 执行器链路已完整支持冲突策略：
    - `CreateObjectSsotExecutor` 会读取 `request.name_collision_policy`，并回退默认策略；
    - `NameCollisionPolicyService` 已实现 `fail/suffix/reuse` 裁决；
    - 成功/失败都可回写 `applied_policy`、`existing_candidates_count`、`existing_candidate_path`、`pre_check_existing`。
- 已确认 planner 侧断点：
  - `BlockToToolPlanMapper.mapCreateObject` 当前未透传 `input.name_collision_policy`；
  - 现有 mapper 单测仅覆盖 `new_object_name/object_kind/set_active`，未覆盖 collision policy 透传。
- 已补充 workflow runtime 相关基线（供 B 线使用）：
  - `turnService` 模板执行器当前只支持 `submit_task/wait_task_status`；
  - 缺 `input.thread_id` 会直接失败；
  - `script_create_compile_attach` candidate 规则仍要求 `target_anchor_available + thread_id_available`。
- 字段流转基线（A0 产出）：
  - 目标链路：`block_spec.input.name_collision_policy -> mapCreateObject -> create_object.payload.name_collision_policy -> CreateObjectSsotExecutor.ResolveNameCollisionPolicy -> SsotDispatchResultData.applied_policy`
  - 当前现实：链路在 `mapCreateObject` 处中断，planner 路径实际落为执行器默认策略（`fail`）。
- 当前状态：Step A0 已完成，可进入 Step A1（字段来源与约束收口）。

#### Step A1：确定字段来源和约束（SSOT 真源）
- 目的：确保策略值域由 SSOT 统一约束。
- 修改模块 / 文件：
  - `ssot/dictionary/tools.json`
  - `ssot/compiler/parser/validateDictionaryShape.js`
  - `ssot/compiler/tests/validateDictionaryShape.test.js`
- 改动内容：补齐/确认 `name_collision_policy` 值域与校验。
- 为什么这样改：防止各层各自扩值造成语义漂移。
- DoD：非法策略在编译期被拒绝。
- 是否依赖前一步：是（A0）。
- 是否可独立提交：是。

**Step A1 执行结果（2026-03-10）**
- 已完成字段来源与约束收口，形成第一轮“单一真源”口径：
  - 值域来源（字段本体）：`tools.create_object.input.properties.name_collision_policy.enum = [fail, suffix, reuse]`（SSOT tool schema）。
  - 默认策略来源（家族策略）：`_definitions.create_family.pre_check_policy.on_conflict = fail`。
  - 运行时常量来源（编译后）：`SsotCreateFamilyContract.DefaultOnConflict/AllowedOnConflictPolicies/PolicyField`。
- 已确认 parser 现状：
  - 已校验 `create_family.pre_check_policy.on_conflict` 必须是 `fail|suffix|reuse`；
  - `policy_field` 当前仅做“非空字符串”校验（若提供），尚未强制等于 `name_collision_policy`；
  - 当前未做“create_family 与 create_object 字段枚举一致性”的跨段校验。
- A1 结论（用于后续实现边界）：
  - 第一轮继续坚持“规则真源在 SSOT”；
  - 以 `create_object.input.properties.name_collision_policy` + `create_family.pre_check_policy.on_conflict` 作为唯一来源；
  - 跨段一致性增强（如 `policy_field` 强绑定、枚举一致性校验）进入 A2/A3 阶段按最小改动落地。
- 当前状态：Step A1 已完成，可进入 Step A2（编译链与产物一致性）。

#### Step A2：更新编译链与生成产物（如需）
- 目的：保证字段在运行时产物可见。
- 修改模块 / 文件：
  - `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
  - `ssot/compiler/tests/emitMcpToolsJson.test.js`
  - `ssot/artifacts/l2/mcp-tools.generated.json`
- 改动内容：补透传断言并更新产物。
- 为什么这样改：避免“SSOT 有定义，runtime 看不到”。
- DoD：产物中 `create_object` 可见 `name_collision_policy`。
- 是否依赖前一步：是（A1）。
- 是否可独立提交：是。

**Step A2 执行结果（2026-03-10）**
- 已完成编译链与产物一致性核对，结论如下：
  - `emitMcpToolsJson` 当前实现对 tool input schema 采用深拷贝+直接投影，`name_collision_policy` 字段无需额外 emitter 逻辑即可保留到产物。
  - `mcp-tools.generated.json` 已确认同时包含：
    - `global_contracts.create_family.pre_check_policy.policy_field = name_collision_policy`
    - `tools.create_object.inputSchema.properties.name_collision_policy`
- 已补充编译器回归测试：
  - `ssot/compiler/tests/emitMcpToolsJson.test.js` 新增 `emitMcpToolsJson preserves create_object name_collision_policy schema`。
  - 断言覆盖 `name_collision_policy` 类型/枚举，以及 `policy_field` 在 global contracts 中保持一致。
- 已执行测试：
  - 命令：`node --test ssot/compiler/tests/emitMcpToolsJson.test.js`
  - 结果：8/8 通过。
- A2 结论：
  - 第一轮无需新增编译器 emitter 逻辑，重点已转为 A3 的 mapper 透传打通。
- 当前状态：Step A2 已完成，可进入 Step A3（mapper 透传到执行层）。

#### Step A3：mapper 透传到执行层
- 目的：打通 planner `create.object` 到 `create_object` 的字段通道。
- 修改模块 / 文件：
  - `sidecar/src/application/blockRuntime/execution/BlockToToolPlanMapper.js`
  - `sidecar/tests/application/block-runtime-mapper.test.js`
- 改动内容：
  - `mapCreateObject` 透传 `input.name_collision_policy`。
  - 非法类型/空值处理与错误码约束。
- 为什么这样改：本主线核心交付点。
- DoD：planner 路径能稳定控制冲突策略。
- 是否依赖前一步：是（A1/A2）。
- 是否可独立提交：是。

**Step A3 执行结果（2026-03-10）**
- 已完成 mapper 侧 `name_collision_policy` 透传接线：
  - `mapCreateObject` 新增可选字段读取：当 `input.name_collision_policy` 存在时写入 `create_object.payload.name_collision_policy`。
  - 校验规则（第一轮最小约束）：
    - 仅在字段出现时校验；
    - 必须是非空字符串（空白字符串视为非法）；
    - 非法时返回 `E_SCHEMA_INVALID`，错误信息为 `input.name_collision_policy must be a non-empty string when provided`。
- 已补 mapper 单测：
  - `S2A-T1 maps CREATE block and forwards name_collision_policy when provided`
  - `S2A-T1 rejects CREATE block when name_collision_policy is empty`
  - `S2A-T1 rejects CREATE block when name_collision_policy is not string`
- 已执行测试：
  - 命令：`node --test sidecar/tests/application/block-runtime-mapper.test.js`
  - 结果：43/43 通过。
- A3 结论：
  - planner `create.object -> create_object` 的 collision policy 字段通道已打通；
  - 字段值域语义仍由 SSOT/执行器主导，mapper 仅做最小类型与空值保护。
- 当前状态：Step A3 已完成，可进入 Step A4（trace/result 输出增强）。

#### Step A4：补 trace/result 输出（策略可观测）
- 目的：让策略执行结果可追踪。
- 修改模块 / 文件：
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/application/blockRuntime/entry/PlannerUxMetricsCollector.js`
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
  - `sidecar/tests/application/planner-ux-metrics-collector.test.js`
- 改动内容：补 `collision_policy_used` 等观测字段与指标。
- 为什么这样改：无观测无法判断幂等收益。
- DoD：结果与指标中可见策略使用与分布。
- 是否依赖前一步：是（A3）。
- 是否可独立提交：是。

**Step A4 执行结果（2026-03-10）**
- 已完成 trace/result 观测增强，核心改动如下：
  - `turnService` 新增从 `blockResult.output_data` 提取 collision 观测元数据：
    - `collision_policy_used`（来自 `applied_policy`，当前规范化为 `fail/reuse/suffix`）
    - `existing_candidates_count`
    - `existing_candidate_path`
    - `pre_check_existing`
  - 上述字段已并入：
    - 响应侧 `data.planner_orchestration`
    - 指标侧 `plannerOrchestrationMetricMeta`（用于 `PlannerUxMetricsCollector.recordAttempt`）
- 已完成 metrics 聚合扩展：
  - `PlannerUxMetricsCollector` 新增：
    - `totals.collision_policy_reported_total`
    - `collision_policy.by_policy`（按 policy 聚合）
    - `collision_policy.hit_rate`
- 已补测试并通过：
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
    - 新增 `A4 executeBlockSpecForMvp exposes collision policy meta in planner orchestration and metrics`
    - 断言 `planner_orchestration` 与 metrics 事件均可见 `collision_policy_used`
  - `sidecar/tests/application/planner-ux-metrics-collector.test.js`
    - 补充 collision policy 聚合断言
- 测试执行结果：
  - `node --test sidecar/tests/application/planner-ux-metrics-collector.test.js`：1/1 通过
  - `node --test sidecar/tests/application/block-runtime-entry-wiring.test.js`：42/42 通过
- A4 结论：
  - 已实现“策略使用可观测”，可在响应与聚合指标中追踪 `name_collision_policy` 的实际落地情况。
- 当前状态：Step A4 已完成，可进入 Step A5（测试与埋点闭环）。

#### Step A5：测试与埋点闭环
- 目的：回归保护与上线证据。
- 修改模块 / 文件：
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
  - `Assets/Editor/Codex/Tests/EditMode/SsotRequestQueryHandlerTests.cs`
- 改动内容：补 `fail/reuse` 重试稳定性断言。
- 为什么这样改：确保策略透传不引入漂移。
- DoD：可证明重复执行不漂移、失败可定位。
- 是否依赖前一步：是（A4）。
- 是否可独立提交：否（建议与 A4 同批）。

**Step A5 执行结果（2026-03-10）**
- 已完成 `fail/reuse` 重试稳定性断言补齐：
  - sidecar 入口层新增：
    - `A5 executeBlockSpecForMvp keeps reuse target stable across retries`
    - `A5 executeBlockSpecForMvp keeps fail collision diagnostics stable across retries`
  - Unity EditMode 层增强：
    - `Handler_CreateObject_ReturnsNameCollisionDetected_WhenSiblingNameExists` 升级为两次重试断言（`fail`）
    - `Handler_CreateObject_ReusesExistingObject_WhenReusePolicyApplied` 升级为两次重试断言（`reuse`）
- 已验证的稳定性结论：
  - `reuse`：重复执行返回同一 `target_object_id`，目标不漂移。
  - `fail`：重复执行稳定返回 `E_NAME_COLLISION_DETECTED`，且冲突诊断字段（`existing_candidates_count/path`）一致可定位。
- 测试执行结果：
  - `node --test sidecar/tests/application/block-runtime-entry-wiring.test.js`：44/44 通过。
  - Unity Test Runner（EditMode 全量）：82/82 通过。
- A5 结论：
  - 主线 A（`name_collision_policy` 透传 + 可观测 + 回归保护）已完成闭环，可进入主线 B。
- 当前状态：Step A5 已完成，可进入主线 B Step 0。

### 主线 B：`ensure_target`

#### Step B0：扫描 workflow 入口、模板、执行器
- 目的：确认接入点与最小改动面。
- 修改模块 / 文件：
  - `ssot/dictionary/tools.json`
  - `ssot/compiler/parser/validateDictionaryShape.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/application/ssotRuntime/contractAdvisor.js`
  - `sidecar/src/application/blockRuntime/entry/PlannerEntryErrorHintBuilder.js`
- 改动内容：仅分析，产出接入草图。
- 为什么这样改：先锁“单入口+显式步骤”落点。
- DoD：形成接入映射表（模板定义点/执行点/建议模板点）。
- 是否依赖前一步：否。
- 是否可独立提交：是（文档）。

**Step B0 执行结果（2026-03-10）**
- 已完成主线 B 的入口/模板/执行器扫描，形成接入映射表：
  - 模板定义点（SSOT 真源）：
    - `ssot/dictionary/tools.json` 中 `workflow_templates.script_create_compile_attach.v1` 已定义三步链路：
      - `create_script_task`（`submit_task` -> `submit_unity_task` -> `file_actions`）
      - `wait_compile_ready`（`wait_task_status` -> `get_unity_task_status`）
      - `attach_component_task`（`submit_task` -> `submit_unity_task` -> `visual_layer_actions`）
    - 同文件 `workflow_candidate_rules.script_create_compile_attach_candidate_v1` 仍要求：
      - `target_anchor_available`
      - `thread_id_available`
  - 编译校验点（parser）：
    - `ssot/compiler/parser/validateDictionaryShape.js` 当前对 workflow step_type 仅允许：
      - `submit_task`
      - `wait_task_status`
    - `workflow_type` 当前仅允许 `condition_wait_sequential`。
  - 运行时执行点（workflow runtime）：
    - `sidecar/src/application/turnService.js`
      - `synthesizeWorkflowDispatch`：按 `selection.intent_keys` 选择模板并注入 workflow orchestration 上下文。
      - `executeWorkflowTemplateDispatch`：解释执行模板步骤；当前仅实现 `submit_task` 与 `wait_task_status`。
      - 显式硬约束已确认：
        - 缺 `input.thread_id` 直接失败（`E_SCHEMA_INVALID`）。
        - `submit_task` 步骤要求 `input.<task_payload_slot>` 为数组。
      - 输出可观测基线已确认：
        - `output_data.workflow_orchestration.step_results`
        - `execution_meta.workflow_template_id/workflow_step_count/workflow_failed_step_id`。
  - 建议模板输出点（repair/recommendation）：
    - `sidecar/src/application/ssotRuntime/contractAdvisor.js` 的 `buildWorkflowMinimalTemplate`。
    - `sidecar/src/application/blockRuntime/entry/PlannerEntryErrorHintBuilder.js` 的 `buildWorkflowMinimalTemplate`。
    - 两处目前都输出“单入口 workflow 调用模板”，并仍以 `target_anchor` + `thread_id` 作为关键占位。
- B0 缺口结论（用于 B1）：
  - 尚无 `ensure_target` 的 step_type / metadata / contract 表达。
  - parser 与 runtime 均未支持 `ensure_target` 显式步骤。
  - 建议模板仍未区分 `parent_anchor` 与 `resolved_target` 语义。
- 当前状态：Step B0 已完成，可进入 Step B1（确定 `ensure_target` 的 SSOT 表达）。

#### Step B1：确定 `ensure_target` 的 SSOT 表达
- 目的：把 ensure_target 收口为 SSOT 可校验能力。
- 修改模块 / 文件：
  - `ssot/dictionary/tools.json`
  - `ssot/compiler/parser/validateDictionaryShape.js`
  - `ssot/compiler/tests/validateDictionaryShape.test.js`
- 改动内容：
  - 新增 `ensure_target` step_type 与最小 metadata。
  - 声明 `parent_anchor` 与 `resolved_target` 的语义边界。
  - 声明第一轮禁止模糊复用规则。
- 为什么这样改：防止 runtime 私有语义膨胀。
- DoD：编译校验可拒绝违规 step 定义。
- 是否依赖前一步：是（B0）。
- 是否可独立提交：是。

**Step B1 执行结果（2026-03-10）**
- 已完成 `ensure_target` 的 SSOT 可校验表达，且不影响现网 workflow 主路径：
  - `ssot/compiler/parser/validateDictionaryShape.js`
    - `workflow step_type` 扩展支持 `ensure_target`。
    - 为三类 step 增加显式键集校验（`submit_task` / `wait_task_status` / `ensure_target`），可拒绝越界字段。
    - 新增 `ensure_target_contract` 校验，冻结第一轮最小语义：
      - `parent_anchor_input_field` 与 `resolved_target_output_field` 必须分离，且分别编码 `parent_anchor` / `resolved_target` 语义；
      - `collision_policy_input_field` 必须指向 `name_collision_policy`；
      - `allowed_collision_policies` 第一轮仅允许 `fail/reuse`；
      - `require_unique_reuse_match=true`、`forbid_fuzzy_reuse=true`（统一原则：禁止模糊复用）。
  - `ssot/dictionary/tools.json`
    - 新增禁用模板 `script_create_compile_attach_with_ensure_target.v1`（`enabled=false`），用于在 SSOT 真源中表达 `ensure_target` 显式步骤与 contract；
    - 保持 `script_create_compile_attach.v1` 现有三步链路不变，避免 B2 前 runtime 行为变化。
  - `ssot/compiler/tests/validateDictionaryShape.test.js`
    - 新增 `ensure_target` 通过用例；
    - 新增拒绝用例：`parent_anchor/resolved_target` 混用、`allowed_collision_policies` 出现 `suffix`、`require_unique_reuse_match=false`。
- 已执行验证：
  - `node --test ssot/compiler/tests/validateDictionaryShape.test.js`：41/41 通过。
  - `node -e "...validateDictionaryShape(JSON.parse(ssot/dictionary/tools.json))"`：返回 `true`。
- B1 结论：
  - `ensure_target` 已具备 SSOT 层可表达、可校验、可拒绝违规定义的基础；
  - 第一轮语义边界已锁定：不引入私有 create DSL、严格区分 `parent_anchor` 与 `resolved_target`、禁止模糊复用。
- 当前状态：Step B1 已完成，可进入 Step B3（先冻结 `resolved_target` contract）。

#### Step B2：workflow runtime 接入显式 `ensure_target` step
- 目的：执行链可运行 ensure_target，但不让 `turnService` 吸收规则本体。
- 修改模块 / 文件：
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/application/workflow/ensureTargetStepAdapter.js`（建议新增）
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
- 改动内容：
  - `turnService` 仅调度 step。
  - 目标解析、冲突判定调用封装在 `ensureTargetStepAdapter`（过渡实现也要隔离）。
- 为什么这样改：收紧 `turnService` 责任边界。
- DoD：`step_results` 可见 ensure_target，且规则本体不散落在 `turnService`。
- 是否依赖前一步：是（B1/B3）。
- 是否可独立提交：否（建议与 B4 联动）。

**Step B2 执行结果（2026-03-10）**
- 已完成 runtime 显式接入 `ensure_target` step，且保持“`turnService` 仅调度、规则下沉 adapter”的边界：
  - 新增 `sidecar/src/application/workflow/ensureTargetStepAdapter.js`：
    - 封装 `ensure_target` 的输入校验、`create.object -> create_object` 调用、冲突判定、`resolved_target` 组装；
    - 第一轮原则已落地：
      - `reuse` 多候选（`existing_candidates_count > 1`）直接 `fail-fast`；
      - 不做模糊复用与顺序猜测；
      - 仅使用模板约束允许的 collision policy（第一轮 `fail/reuse`）。
  - `sidecar/src/application/turnService.js`：
    - `executeWorkflowTemplateDispatch` 新增 `step_type=ensure_target` 分支，仅调用 adapter 并记录 step 结果；
    - workflow 结果新增 `output_data.workflow_orchestration.resolved_target` 注入（按 B3 contract）；
    - workflow 失败路径也保留 `resolved_target`（若已解析），保证 trace 连续。
- 已补集成测试（`sidecar/tests/application/block-runtime-entry-wiring.test.js`）：
  - `B2 ... runs ensure_target step and exposes resolved_target trace`
  - `B2 ... fails fast when ensure_target reuse is ambiguous`
- 已执行验证：
  - `node --test sidecar/tests/application/block-runtime-entry-wiring.test.js`：46/46 通过。
- B2 结论：
  - workflow 执行链已支持显式 `ensure_target`；
  - 规则本体未堆入 `turnService`，满足 Step B2 边界目标。
- 当前状态：Step B2 已完成，可进入 Step B4（衔接 create_script / wait_compile / attach 对 `resolved_target` 的消费）。

#### Step B3：冻结 `resolved_target` contract（先定约）
- 目的：先冻结语义，再接执行链。
- 修改模块 / 文件：
  - 本方案文档（先）
  - 后续落地：`turnService.js`、`contractAdvisor.js`、`PlannerEntryErrorHintBuilder.js`
- 改动内容：冻结输出字段：
  - `resolved_target_id`
  - `resolved_target_path`
  - `created_or_reused`
  - `collision_policy_used`
  - `existing_candidates_count`
  - `existing_candidate_path`
- 为什么这样改：防止实现期字段反复变化。
- DoD：字段语义、来源、判定规则在文档中固定。
- 是否依赖前一步：是（B1）。
- 是否可独立提交：是（文档）。

**Step B3 执行结果（2026-03-10）**
- 已完成 `resolved_target` contract 冻结（文档级定约），核心收口如下：
  - 冻结规范载体：`output_data.workflow_orchestration.resolved_target`。
  - 冻结字段来源与派生规则：
    - `resolved_target_id <- ensure_target_object.output_data.target_object_id`
    - `resolved_target_path <- ensure_target_object.output_data.target_path`
    - `collision_policy_used <- ensure_target_object.output_data.applied_policy`（归一化后仅 `fail/reuse`）
    - `existing_candidates_count <- ensure_target_object.output_data.existing_candidates_count`
    - `existing_candidate_path <- ensure_target_object.output_data.existing_candidate_path`
    - `created_or_reused` 按固定规则派生（`reuse + 唯一命中 => reused`，其余成功路径 `created`）
  - 冻结消费规则：
    - `parent_anchor` 仅用于 ensure_target 查找/创建上下文；
    - `resolved_target` 才是后续 attach 的唯一目标来源；
    - `create_script/wait_compile` 不得改写 `resolved_target`。
  - 冻结 fail-fast 规则：
    - `resolved_target_id/path` 缺失直接失败；
    - `reuse` 且 `existing_candidates_count > 1` 直接失败（第一轮禁止模糊复用）；
    - 显式 `target_anchor` 与 `resolved_target` 冲突时 attach 前失败。
- B3 结论：
  - 执行链接线前的语义基线已锁定，可避免 B2/B4 期间字段和边界反复漂移。
- 当前状态：Step B3 已完成，可进入 Step B2（runtime 接入显式 ensure_target step）。

#### Step B4：衔接 create_script / wait_compile / attach
- 目的：后续步骤稳定消费 `resolved_target`。
- 修改模块 / 文件：
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/application/workflow/resolvedTargetBinder.js`（建议新增）
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
- 改动内容：
  - attach 前由 `resolvedTargetBinder` 注入/校验目标。
  - 显式 target 与 resolved target 冲突时 fail-fast。
  - 禁止模糊路径和顺序猜测。
- 为什么这样改：确保 attach 目标确定且可复现。
- DoD：attach 总是落到 `resolved_target`，冲突可定位。
- 是否依赖前一步：是（B2/B3）。
- 是否可独立提交：否。

**Step B4 执行结果（2026-03-10）**
- 已完成 `resolved_target` 到 attach 链路的消费衔接，核心落地点如下：
  - 新增 `sidecar/src/application/workflow/resolvedTargetBinder.js`：
    - 负责把 `resolved_target` 绑定到 `visual_layer_actions`；
    - 校验并拒绝冲突目标（`block_spec.target_anchor` 与 action 显式 target 冲突）；
    - 仅在 attach 路径执行，不引入第二套 create/reuse 语义。
  - 更新 `sidecar/src/application/turnService.js`：
    - `submit_task` + `visual_layer_actions` 时，若存在 `resolved_target`，先调用 `resolvedTargetBinder`；
    - 绑定成功后，attach step 的 `write_envelope.write_anchor_*` 对齐到 `resolved_target`；
    - 冲突时在 attach 前 fail-fast，返回 `E_WORKFLOW_RESOLVED_TARGET_CONFLICT`；
    - workflow 输出与失败路径均保留 `workflow_orchestration.resolved_target`，保障 trace 连续。
- 已补集成测试（`sidecar/tests/application/block-runtime-entry-wiring.test.js`）：
  - `B4 ... binds attach target to resolved_target for visual actions`
  - `B4 ... fails before attach when block target_anchor conflicts with resolved_target`
  - 同步修正 B2 成功用例输入，使显式 anchor 与 `resolved_target` 对齐，避免触发新冲突保护。
- 已执行验证：
  - `node --test sidecar/tests/application/block-runtime-entry-wiring.test.js`：48/48 通过。
- B4 结论：
  - attach 目标已从“依赖原输入”收口到“优先消费 `resolved_target` + 冲突显式拦截”；
  - 满足 B3 冻结 contract 的执行侧要求。
- 当前状态：Step B4 已完成，可进入 Step B5（错误恢复与 trace 收口）。

#### Step B5：错误恢复与 trace 收口
- 目的：ensure_target 失败可归因、可恢复。
- 修改模块 / 文件：
  - `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
  - `sidecar/src/application/errorFeedback/mcpErrorFeedbackTemplates.json`
  - `sidecar/src/application/blockRuntime/entry/PlannerEntryErrorHintBuilder.js`
  - `sidecar/tests/application/anchor-error-feedback.test.js`
  - `sidecar/tests/application/ssot-recovery-guidance.test.js`
- 改动内容：
  - 新增 ensure_target 专属错误码与修复提示。
  - 推荐模板加入 `ensure_target` 最小占位。
- 为什么这样改：显式步骤必须有显式恢复路径。
- DoD：失败时可回答“哪一步失败、为什么失败、怎么修”。
- 是否依赖前一步：是（B4）。
- 是否可独立提交：是。

**Step B5 执行结果（2026-03-10）**
- 已完成 `ensure_target/resolved_target` 失败路径的错误恢复收口：
  - `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
    - `WORKFLOW_GUIDANCE_FALLBACK_BY_CODE` 新增 4 个 workflow 错误码回退指引：
      - `E_WORKFLOW_ENSURE_TARGET_FAILED`
      - `E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE`
      - `E_WORKFLOW_RESOLVED_TARGET_CONFLICT`
      - `E_WORKFLOW_RESOLVED_TARGET_MISSING`
    - 修正 workflow fallback 的 `fix_hint` 优先级：当命中 workflow fallback 时优先采用 fallback 文案，避免被通用 hint 覆盖。
  - `sidecar/src/application/errorFeedback/mcpErrorFeedbackTemplates.json`
    - 同步新增上述 4 个错误码模板，统一 `recoverable=true` 且给出明确修复建议。
- 已完成 workflow 推荐最小模板的 `ensure_target` 占位扩展：
  - `sidecar/src/application/blockRuntime/entry/PlannerEntryErrorHintBuilder.js`
  - `sidecar/src/application/ssotRuntime/contractAdvisor.js`
  - `buildWorkflowMinimalTemplate` 现在会为脚本 workflow 推荐模板补充：
    - `input.ensure_target.enabled=false`
    - `input.ensure_target.parent_anchor.object_id/path`
    - `input.ensure_target.new_object_name/object_kind/set_active`
    - `input.ensure_target.name_collision_policy=fail`
  - 该占位仅用于修复模板提示，不改变现有 runtime 默认执行语义。
- 已补并通过测试：
  - `sidecar/tests/application/anchor-error-feedback.test.js`
    - 校验 `workflow_recommendation.minimal_valid_template` 包含 `ensure_target` 占位；
    - 新增 `E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE` 指引断言。
  - `sidecar/tests/application/ssot-recovery-guidance.test.js`
    - 新增 `E_WORKFLOW_RESOLVED_TARGET_CONFLICT` 的恢复指引断言。
  - `sidecar/tests/application/get-write-contract-bundle.test.js`
    - 校验 contract bundle 中 workflow 推荐模板包含 `ensure_target` 占位。
- 测试执行结果：
  - `node --test sidecar/tests/application/anchor-error-feedback.test.js`：19/19 通过。
  - `node --test sidecar/tests/application/ssot-recovery-guidance.test.js`：13/13 通过。
  - `node --test sidecar/tests/application/get-write-contract-bundle.test.js`：7/7 通过。
- B5 结论：
  - `ensure_target` 失败路径已具备“可定位 + 可恢复”的错误提示；
  - workflow 修复模板已具备 `ensure_target` 最小输入骨架，可直接用于后续 B6 验证。
- 当前状态：Step B5 已完成，可进入 Step B6（测试与埋点）。

#### Step B6：测试与埋点
- 目的：验证“可追踪、可定位、可幂等”。
- 修改模块 / 文件：
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
  - `sidecar/tests/application/get-write-contract-bundle.test.js`
  - `sidecar/tests/application/planner-ux-metrics-collector.test.js`
  - `ssot/compiler/tests/validateDictionaryShape.test.js`
- 改动内容：
  - ensure_target create/reuse/fail 分支。
  - 多候选 reuse fail-fast。
  - resolved target 稳定性与 attach 对齐。
- 为什么这样改：第一轮价值必须由测试数据支撑。
- DoD：关键约束都有自动化回归。
- 是否依赖前一步：是（B5）。
- 是否可独立提交：否（建议与 B5 同批）。

**Step B6 执行结果（2026-03-10）**
- 已完成 `ensure_target` 相关埋点收口（runtime -> metrics）：
  - `sidecar/src/application/turnService.js`
    - `buildWorkflowRuntimeMetricMetaFromBlockResult` 新增 `ensure_target` 语义提取：
      - `ensure_target_invoked`
      - `ensure_target_created`
      - `ensure_target_reused`
      - `ensure_target_failed`
      - `ensure_target_ambiguous_reuse`
    - 提取依据为 workflow `step_results` + `resolved_target.created_or_reused` + workflow 失败错误码（含 `E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE`）。
  - `sidecar/src/application/blockRuntime/entry/PlannerUxMetricsCollector.js`
    - 新增 totals：
      - `ensure_target_invoked_total`
      - `ensure_target_created_total`
      - `ensure_target_reused_total`
      - `ensure_target_failed_total`
      - `ensure_target_ambiguous_reuse_total`
    - 新增 snapshot 聚合块 `ensure_target`，输出 invoked/created/reused/failed/ambiguous 及对应 rate。
- 已补测试覆盖（B6 范围）：
  - `sidecar/tests/application/planner-ux-metrics-collector.test.js`
    - 新增 `PlannerUxMetricsCollector aggregates ensure_target metrics`，验证上述 5 个计数与 rate。
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
    - 增强 `B2 ... runs ensure_target step ...`：验证 response + metrics event 含 `ensure_target_invoked/reused`。
    - 新增 `B6 ... marks ensure_target created path in trace and metrics`：覆盖 created 分支。
    - 增强 `B2 ... ambiguous`：验证失败时 metrics event 含 `ensure_target_failed/ensure_target_ambiguous_reuse`。
- 已执行验证：
  - `node --test sidecar/tests/application/planner-ux-metrics-collector.test.js`：2/2 通过。
  - `node --test sidecar/tests/application/block-runtime-entry-wiring.test.js`：49/49 通过。
  - `node --test sidecar/tests/application/get-write-contract-bundle.test.js`：7/7 通过。
  - `node --test sidecar/tests/application/anchor-error-feedback.test.js`：19/19 通过。
  - `node --test sidecar/tests/application/ssot-recovery-guidance.test.js`：13/13 通过。
  - `node --test ssot/compiler/tests/validateDictionaryShape.test.js`：41/41 通过。
- B6 结论：
  - `ensure_target` 的 create/reuse/fail（含 ambiguous reuse）路径已具备自动化回归与指标可见性；
  - 主线 B（B0~B6）达到“可追踪、可定位、可幂等”的第一轮验收口径。
- 当前状态：Step B6 已完成。

## 7. 建议实施顺序
- 预备（可先做文档扫描）：`A0`、`B0`。
- 第一批先做（锁语义）：
  - `A1 -> A2 -> A3`
  - `B1 -> B3`
- 第二批再做（接执行链）：
  - `B2 -> B4`
  - `A4`（与 B2/B4 同期补观测）
- 第三批最后做（外围能力）：
  - `B5`
  - `A5` 与 `B6`
- 串行关系：
  - `B2` 依赖 `B1/B3`。
  - `B4` 依赖 `B2`。
  - `B6` 依赖 `B5`。
- 并行机会：
  - `A4` 与 `B2/B4` 可并行。
  - `A5` 与 `B6` 可并行补测。

## 8. 测试与埋点
- 单测必补：
  - `block-runtime-mapper.test.js`：`name_collision_policy` 透传与非法值拒绝。
  - `validateDictionaryShape.test.js`：`ensure_target` step 与边界约束（含禁止模糊复用）。
  - `get-write-contract-bundle.test.js`：最小模板包含 `ensure_target` 输入占位与输出字段说明。
- 集成必补：
  - `block-runtime-entry-wiring.test.js`：
    - `reuse` 唯一命中成功。
    - `existing_candidates_count > 1` fail-fast。
    - `parent_anchor` 与 `resolved_target` 分离语义。
    - attach 使用 `resolved_target`。
  - `anchor-error-feedback.test.js`：ensure_target 失败提示与修复步骤。
- 建议指标：
  - `ensure_target_invoked_total`
  - `ensure_target_created_total`
  - `ensure_target_reused_total`
  - `ensure_target_failed_total`
  - `ensure_target_ambiguous_reuse_total`
- 验证重点：
  - reuse/fail 行为正确。
  - resolved target 稳定。
  - workflow 重试幂等。
  - attach 目标准确。

## 9. 风险与回滚策略
- 风险边界（第一轮必须遵守）：
  1. 不让 `ensure_target` 长成 workflow 私有 create 语言。
  2. 不混淆 `parent_anchor` 与 `resolved_target`。
  3. 禁止模糊复用（多候选不允许默认选第一个）。
  4. 不让 `turnService` 继续吸收目标解析与冲突裁决规则本体。
  5. 不把 `suffix`、复杂 rename/merge 带入第一轮主路径。
- 控制策略：
  - SSOT 声明规则，runtime 解释执行。
  - `turnService` 仅调度；解析/注入/冲突检查尽量下沉 helper/adapter。
  - 多候选 reuse 强制 fail-fast。
- 回滚策略：
  - 关闭 SSOT 中 `ensure_target` step，回退 legacy 三步。
  - 保留 `name_collision_policy` 透传，不影响旧调用。
  - 关闭 ensure_target 相关指标与提示，不影响现有 workflow 主链。

## 10. 本轮最小交付范围
- `name_collision_policy`：
  - 仅打通 `create.object -> create_object` 透传。
  - 第一轮主路径仅使用 `fail/reuse`。
- `ensure_target`：
  - 只做 workflow 显式前置步骤。
  - 只做目标存在性保障与 `resolved_target` 产出。
  - 只在 `workflow.script.create_compile_attach` 内接入。
- 明确暂缓：
  - `suffix` 主路径化。
  - `rename/auto_increment/merge` 扩展。
  - 点击验收与交互模拟全套能力。
- 第一轮统一原则（落地口径）：
  - 不做第二套 create 语义。
  - `parent_anchor` / `resolved_target` 严格分离。
  - 禁止模糊复用。

## 11. 涉及文件 / 模块清单
- SSOT 真源与编译：
  - `ssot/dictionary/tools.json`
  - `ssot/compiler/parser/validateDictionaryShape.js`
  - `ssot/compiler/tests/validateDictionaryShape.test.js`
  - `ssot/compiler/emitters/l2/emitMcpToolsJson.js`
  - `ssot/compiler/tests/emitMcpToolsJson.test.js`
  - `ssot/artifacts/l2/mcp-tools.generated.json`
- Planner runtime：
  - `sidecar/src/application/blockRuntime/execution/BlockToToolPlanMapper.js`
  - `sidecar/src/application/turnService.js`
  - `sidecar/src/application/ssotRuntime/contractAdvisor.js`
  - `sidecar/src/application/blockRuntime/entry/PlannerEntryErrorHintBuilder.js`
  - `sidecar/src/application/errorFeedback/errorGuidanceRegistry.js`
  - `sidecar/src/application/errorFeedback/mcpErrorFeedbackTemplates.json`
  - `sidecar/src/application/blockRuntime/entry/PlannerUxMetricsCollector.js`
  - `sidecar/src/application/workflow/ensureTargetStepAdapter.js`（建议新增，收口解析与冲突判断）
  - `sidecar/src/application/workflow/resolvedTargetBinder.js`（建议新增，收口注入与一致性检查）
- 测试：
  - `sidecar/tests/application/block-runtime-mapper.test.js`
  - `sidecar/tests/application/block-runtime-entry-wiring.test.js`
  - `sidecar/tests/application/get-write-contract-bundle.test.js`
  - `sidecar/tests/application/anchor-error-feedback.test.js`
  - `sidecar/tests/application/ssot-recovery-guidance.test.js`
  - `sidecar/tests/application/planner-ux-metrics-collector.test.js`
  - `Assets/Editor/Codex/Tests/EditMode/SsotRequestQueryHandlerTests.cs`
- Unity 执行侧（复用，不新增语义）：
  - `Assets/Editor/Codex/Infrastructure/Ssot/Create/NameCollisionPolicyService.cs`
  - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/CreateObjectSsotExecutor.cs`
  - `Assets/Editor/Codex/Generated/Ssot/SsotDtos.generated.cs`
