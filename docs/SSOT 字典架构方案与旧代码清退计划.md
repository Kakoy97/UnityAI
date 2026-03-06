# SSOT 字典架构方案与旧代码清退计划

日期：2026-03-04  
范围：L1（MCP 协议）/ L2（Sidecar 网关）/ L3（Unity C# 执行层）

---

## 模块一：独立架构与物理流转设计

### 1.1 独立结构判断（SSOT 放置位置与形态）

结论：**应该设计为独立基础设施包**，而不是散落在 `sidecar` 或 `Assets` 任一端。

建议目录（仓库根目录）：

```text
ssot/
  dictionary/
    tools.yaml                 # 全局唯一真理源
    dictionary.schema.json     # 字典自身校验 schema
  compiler/
    index.ts                   # 解析 + 规范化 + 产物编译
    emit-l2.ts                 # 生成 L2 MCP 定义与 AJV 校验器
    emit-l3.ts                 # 生成 L3 C# DTO 与绑定代码
  artifacts/
    l2/
      mcp-tools.generated.json
      validators.generated.js
    l3/
      SsotDtos.generated.cs
      SsotBindings.generated.cs
```

工程接入位置：

1. L2 只引用 `ssot/artifacts/l2/*`，禁止手写工具 schema。  
2. L3 只引用 `ssot/artifacts/l3/*`，禁止手写并行 DTO。  
3. CI 增加门禁：`tools.yaml` 变更后必须重新生成 artifacts，且生成产物不得有脏差异。  

### 1.2 三端驱动机制（“一份文件，三端共用”）

#### A. L2 MCP 暴露（tools/list 自动下发）

流转：

1. 启动前运行 `ssot compiler`，产出 `mcp-tools.generated.json`。  
2. `mcpServer` 启动时直接加载该文件注册工具。  
3. `tools/list` 不再走手写拼装和裁剪分支，直接回传生成产物（可按策略做 token-budget 级别的展示裁剪，但裁剪器也来自 SSOT 配置，不来自手写逻辑）。

#### B. L2 参数门禁（代替手写 Validator）

流转：

1. `tools.yaml` 中每个字段规则（required/type/enum/range/互斥组）编译为 AJV schema。  
2. 编译器输出 `validators.generated.js`，每个工具一个 `validate<Tool>()`。  
3. 路由层统一调用生成校验器，删除手写 if/else 校验树。

补充（读工具纳入同管线）：

1. SSOT 字典同时支持 `write_envelope` 与 `read_envelope` 两类 mixin。  
2. 只读工具（如 `get_scene_snapshot_for_write`）同样通过该编译链生成 schema 与运行时校验。  
3. `read_envelope` 默认不要求 `based_on_read_token`/`idempotency_key`，但允许按工具声明扩展。

#### C. L3 C# DTO 生成（代替手写并行 DTO）

流转：

1. 编译器将每个工具映射为 C# 强类型请求 DTO（可选 Fat DTO 或按 mutation 组分 DTO）。  
2. 输出 `SsotDtos.generated.cs` 与 `SsotBindings.generated.cs`。  
3. Unity 端请求进入统一 `SsotRequestBinder`，反序列化后交给执行器。  

关键约束：

1. L3 不再消费 `legacy_stringified_action_data/legacy_marshaled_action_data` 线缆字段。  
2. L3 不再做双源 payload 回退（新字段 + legacy 字段同时兜底）。  

---

## 模块二：字典条目样例（`modify_ui_layout`）

以下为 YAML 草案样例（强调防呆描述、扁平参数、few-shot 示例）：

```yaml
version: 1
tools:
  - name: modify_ui_layout
    lifecycle: stable
    category: ui_layout
    description: >
      修改单个 UI 节点的 RectTransform 布局参数（位置与尺寸）。
      仅用于 anchored_position 与 size_delta 等布局几何调整。
      严禁用于颜色、文本、组件属性或非 UI 对象；这些场景必须使用
      set_component_properties 或其他对应工具。
      当目标不是 RectTransform（或不是 UI 节点）时必须直接失败，不做隐式修复。
    input:
      type: object
      additionalProperties: false
      required:
        - execution_mode
        - idempotency_key
        - based_on_read_token
        - write_anchor_object_id
        - write_anchor_path
        - target_object_id
        - target_path
        - anchored_x
        - anchored_y
        - width
        - height
      properties:
        execution_mode:
          type: string
          enum: [validate, execute]
          case_insensitive: true
        thread_id:
          type: string
          default: t_default
        idempotency_key:
          type: string
          minLength: 8
        based_on_read_token:
          type: string
          minLength: 1
        write_anchor_object_id:
          type: string
          minLength: 1
        write_anchor_path:
          type: string
          minLength: 1
        target_object_id:
          type: string
          minLength: 1
        target_path:
          type: string
          minLength: 1
        anchored_x:
          type: number
        anchored_y:
          type: number
        width:
          type: number
          minimum: 0
        height:
          type: number
          minimum: 0
        pivot_x:
          type: number
          minimum: 0
          maximum: 1
          default: 0.5
        pivot_y:
          type: number
          minimum: 0
          maximum: 1
          default: 0.5
    examples:
      - name: set_button_position_and_size
        user_intent: "把 Canvas/Button 移动到 x=100,y=100，尺寸 160x48"
        request:
          execution_mode: execute
          thread_id: t_default
          idempotency_key: txn_ui_layout_001
          based_on_read_token: rt_xxx
          write_anchor_object_id: GlobalObjectId_V1-...-canvas
          write_anchor_path: Scene/Canvas
          target_object_id: GlobalObjectId_V1-...-button
          target_path: Scene/Canvas/Button
          anchored_x: 100
          anchored_y: 100
          width: 160
          height: 48
          pivot_x: 0.5
          pivot_y: 0.5
        expected_outcome:
          status: succeeded
          changed_fields:
            - RectTransform.anchoredPosition
            - RectTransform.sizeDelta
            - RectTransform.pivot
```

---

## 模块三：旧代码“拆迁清单”（The Kill List）

前提：以下清退在 SSOT 编译链（字典 -> L2 artifacts -> L3 artifacts）稳定后执行，禁止新老并存。

### A. L2 手工 Schema 组装与裁剪链（整段废弃）

1. `sidecar/src/mcp/commandRegistry.js`  
   - `compactSchemaNode`（L101）  
   - `buildToolsListSchema`（L228）  
   - `getToolsListCache`（L348）  
   评估：这条链是“compact/full 双轨 + 手工裁剪”的核心来源，SSOT 后应由生成产物替代。

2. `sidecar/src/mcp/mcpServer.js`  
   - `getToolDefinitions`（L280）  
   评估：不再手写工具定义组装，改为加载 `mcp-tools.generated.json`。

### B. L2 手写校验树（整段废弃）

1. `sidecar/src/domain/validators/_mcpWriteValidatorsImpl.js`  
   - `resolveVisualActionField`（L99）  
   - `validateMcpApplyVisualActions`（L1458）  
   - `validateMcpSetUiProperties`（L1476）  
   - 各类 `legacy_stringified_action_data/legacy_marshaled_action_data` 外层拦截分支（L233/L241/L1751/L1759/L2536/L2544 等）  
   评估：统一替换为 SSOT 生成 AJV 校验器。

2. `sidecar/src/domain/validators/mcpWriteValidators.js`（导出桥接）  
   评估：作为旧 validator 聚合层整体下线。

3. `sidecar/src/mcp/commands/*/validator.js`（尤其写工具）  
   - `set_ui_properties/validator.js`  
   - `set_serialized_property/validator.js`  
   - `preflight_validate_write_payload/validator.js`  
   评估：全部改为生成校验器，不保留并行手写版本。

### C. L2 “Schema 补偿提示”与多入口 schema 导航链（下线）

1. `sidecar/src/application/turnPolicySchemaCompensation.js`  
   - `buildValidationSchemaCompensation`（L347）  
   - `schema_source/schema_ref/tool_schema_ref` 分支（L381-L429）  
   评估：SSOT 后不需要“猜该查哪个 schema”。

2. `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`  
   - `buildValidationSchemaCompensation` 注入链（L174）  
   评估：保留错误反馈框架，但删除 schema 补偿注入逻辑。

3. `sidecar/src/application/writeContractBundle.js`  
   - `preferred_schema_tool: get_tool_schema/get_action_schema`（L615/L625）  
   - `action_schema_ref/tool_schema_ref`（L873/L879）  
   评估：改为返回 SSOT 工具契约引用，不再保留 action/tool 双查询建议。

4. 旧 schema 发现工具（迁移后删除）  
   - `sidecar/src/mcp/commands/definitions/get_action_schema.js`  
   - `sidecar/src/mcp/commands/definitions/get_tool_schema.js`  
   - `sidecar/src/mcp/commands/definitions/get_write_contract_bundle.js`  
   - `sidecar/src/mcp/commands/definitions/preflight_validate_write_payload.js`  
   - `sidecar/src/mcp/commands/get_action_schema/*`  
   - `sidecar/src/mcp/commands/get_tool_schema/*`  
   - `sidecar/src/mcp/commands/get_write_contract_bundle/*`  
   - `sidecar/src/mcp/commands/preflight_validate_write_payload/*`  
   评估：由 `get_write_contract_v2`（SSOT直出）替代。

### D. L2 action_data 桥接编码链（整段废弃）

1. `sidecar/src/application/turnPayloadBuilders.js`  
   - `tryParseMarshaledActionData`（L134）  
   - `resolveVisualActionData`（L154）  
   - `buildVisualActionDataBridge`（L212）  
   - `legacy_stringified_action_data/legacy_marshaled_action_data` 生成（L199/L200/L222/L223）  

2. `sidecar/src/application/unityDispatcher/runtimeUtils.js`  
   - `payload.legacy_stringified_action_data`、`payload.legacy_marshaled_action_data` 赋值（L434/L435）  

评估：SSOT 新契约走纯 JSON 强类型字段，不再做桥接编码。

### E. L3 双源反序列化与模糊匹配（整段废弃）

1. `Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`  
   - `query_payload_json -> legacy payload` 回退（L125-L134）  
   - `SerializeLegacyPayload`（L164）  
   评估：统一单源 payload。

2. `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`  
   - `legacy_stringified_action_data` / `legacy_marshaled_action_data` 字段（L45/L46/L225/L226）  
   评估：由 SSOT 生成 DTO 替换。

3. `Assets/Editor/Codex/Application/Conversation/VisualActionContractValidator.cs`  
   - `DecodeBase64UrlUtf8` 读取链（L314/L320/L323）  

4. `Assets/Editor/Codex/Infrastructure/Actions/McpVisualActionContext.cs`  
   - `TryDecodeMarshaledActionData` + JSON 回退（L116/L125/L128）  

5. `Assets/Editor/Codex/Infrastructure/Actions/LegacyPrimitiveHandlersDeprecated.cs`  
   - `FindFuzzyComponentTypeCandidates`（L1950）  
   - `FindFuzzyComponentMatchesOnTarget`（L1922）  
   - fuzzy 分支入口（L1836/L1899）  
   评估：SSOT 契约 + 强类型匹配后应 Fail-Fast，不保留 fuzzy。

### F. 重复错误归一点（合并）

1. `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`  
   - `NormalizeExecutionErrorCode`（L149）
2. `Assets/Editor/Codex/Infrastructure/Actions/LegacyPrimitiveHandlersDeprecated.cs`  
   - `NormalizeExecutionErrorCode`（L1417）

评估：保留单一归一入口，另一个删除，避免双点归一漂移。

---

## 清退执行策略（避免“新老并存”）

1. 阶段门禁：  
   - Gate-1：SSOT 编译产物与运行时接入完成。  
   - Gate-2：L2/L3 双端回归通过（编译 + 单测 + E2E）。  
   - Gate-3：执行物理删除（Kill List 批量清退）。

2. 强约束：  
   - 禁止“保留旧 validator 兜底”。  
   - 禁止“保留旧 schema tool 以防万一”。  
   - 删除后由 CI 增加反向扫描：命中 `legacy_stringified_action_data`、`legacy_marshaled_action_data`、`get_action_schema` 等关键字即失败。

---

## 模块四：SSOT 基础设施开发任务拆解表

### 4.1 编译器目录结构规划（SRP）

建议目录（`ssot/compiler/`）：

```text
ssot/compiler/
  index.ts                              # 编译入口编排（只做流程调度）
  shared/types.ts                       # 纯类型定义（AST/IR/Artifact）
  shared/deepMerge.ts                   # 通用深度合并算法（无业务语义）
  io/readDictionaryFile.ts              # 读取 YAML/JSON 文件
  io/writeArtifacts.ts                  # 写入 generated 产物文件
  parser/validateDictionaryShape.ts     # 字典结构校验（dictionary.schema.json）
  parser/parseDictionary.ts             # 解析原始字典为内存 IR
  parser/applyMixins.ts                 # Mixin/继承合并（核心）
  parser/normalizeEnums.ts              # 枚举归一化规则（大小写策略）
  examples/expandBusinessOnlyExamples.ts# 将 request_business_only 自动补全为完整 request
  emitters/l2/emitMcpToolsJson.ts       # 生成 mcp-tools.generated.json
  emitters/l2/emitAjvSchemas.ts         # 生成 AJV schema 清单
  emitters/l2/emitAjvValidators.ts      # 生成 validators.generated.js
  emitters/l3/emitDtosCs.ts             # 生成 SsotDtos.generated.cs
  emitters/l3/emitBindingsCs.ts         # 生成 SsotBindings.generated.cs
```

单一职责约束：

1. `io/*` 不得包含任何 schema 语义逻辑。  
2. `parser/*` 不得做文件系统写入。  
3. `emitters/l2/*` 不得引用 Unity C# 模板。  
4. `emitters/l3/*` 不得依赖 AJV 或 Node 运行时校验库。  
5. `index.ts` 只做编排，不写规则。  

### 4.2 Milestone 1 分步执行清单（TDD 强制门禁）

| Step | 目标 | 产出 | TDD 门禁（通过后才能进下一步） |
|---|---|---|---|
| Step 1 | 搭建编译器骨架与命令入口 | `ssot/compiler/` 目录、`index.ts`、`npm script`（如 `ssot:build`） | `compiler bootstrap` smoke test：空字典输入可跑通到“无产物”结果 |
| Step 2 | 完成字典结构校验器 | `parser/validateDictionaryShape.ts` + `dictionary.schema.json` | 单测覆盖：缺必填字段、非法类型、未知键拦截；通过样例可验证 |
| Step 3 | 完成解析器（YAML -> IR） | `parser/parseDictionary.ts` + `shared/types.ts` | 单测覆盖：多工具解析、definitions 解析、examples 解析；IR snapshot 稳定 |
| Step 4 | 完成 Mixin 深度合并器 | `parser/applyMixins.ts` + `shared/deepMerge.ts` | 单测覆盖：required 并集、properties 合并、冲突优先级、循环继承检测、不存在 mixin 报错 |
| Step 5 | 完成 Example 自动补全器 | `examples/expandBusinessOnlyExamples.ts` | 单测覆盖：`request_business_only` 自动 Merge `write_envelope` 后输出完整合法 request；确保含 `based_on_read_token/idempotency_key/execution_mode` |
| Step 6 | 完成 L2 Schema 产物生成 | `emitters/l2/emitMcpToolsJson.ts`、`emitters/l2/emitAjvSchemas.ts` | 快照测试：`mcp-tools.generated.json` 与预期一致；AJV 编译可通过 |
| Step 7 | 完成 L2 Schema 加载与 Ajv 运行时编译模块 | `runtime/l2/loadCompiledSchemas.ts`、`runtime/l2/validatorRegistry.ts`（或等价模块） | 集成单测：Node 启动时 `ajv.compile(schema)` 成功；合法/非法 payload 拦截行为与字典规则一致 |
| Step 8 | 完成 L3 DTO/Binding 生成并打通编译流程 | `emitters/l3/emitDtosCs.ts`、`emitters/l3/emitBindingsCs.ts`、`io/writeArtifacts.ts` | Golden-file 测试：C# 产物稳定；生成的反序列化路由（Router/Dispatcher）可根据 `tool_name`（或 Fat DTO 标识）安全绑定到具体 DTO；端到端测试一次编译同时输出 L2/L3 产物且无脏差异 |

### 4.3 开发流程硬规则（执行期）

1. 每完成一个“转换模块”（Parser/Merger/Example 扩展器/Emitter），先补单测再合并主线。  
2. 不允许跨 Step 并行堆功能，必须按门禁顺序推进。  
3. 每一步都保留最小可回滚提交，禁止一次提交跨两个核心模块。  

---

请确认任务拆解，确认后将开始执行 Step 1。

---

## 进展快照（2026-03-05，清理批次 B）

### 已完成：SSOT 字典扩充
当前 `ssot/dictionary/tools.json` 已扩充并编译通过，包含以下工具：
1. `modify_ui_layout`
2. `set_component_properties`
3. `create_object`
4. `instantiate_prefab`
5. `delete_object`
6. `get_scene_snapshot_for_write`

对应产物已更新：
- `ssot/artifacts/l2/mcp-tools.generated.json`
- `ssot/artifacts/l2/ajv-schemas.generated.json`
- `ssot/artifacts/l3/SsotDtos.generated.cs`
- `ssot/artifacts/l3/SsotBindings.generated.cs`

### 已完成：旧链路拆迁（已物理删除）
#### L2（Sidecar）
- `sidecar/src/application/turnPolicySchemaCompensation.js`
- `sidecar/src/domain/validators/_mcpWriteValidatorsImpl.js`
- `sidecar/src/mcp/commands/set_serialized_property/validator.js`
- `sidecar/src/mcp/commands/definitions/modify_ui_layout.js`
- `sidecar/src/mcp/commands/modify_ui_layout/handler.js`
- `sidecar/src/mcp/commands/modify_ui_layout/validator.js`
- `sidecar/scripts/r16-wire-guard.js`
- `sidecar/tests/application/turn-policies-schema-compensation.test.js`

#### L3（Unity）
- `Assets/Editor/Codex/Application/Conversation/VisualActionContractValidator.cs`
- `Assets/Editor/Codex/Infrastructure/Actions/LegacyPrimitiveHandlersDeprecated.cs`
- `Assets/Editor/Codex/Infrastructure/Queries/Handlers/SsotDeserializeModifyUiLayoutQueryHandler.cs`

### 已完成：阻断级清理与止血（仅清理/桩化）
1. `PendingActionCoordinator.cs` 已切断对已删除校验器的依赖，`TryValidateActionPayload(...)` 当前为直接放行桩。
2. `BuiltInVisualActionHandlers.cs` / `ValuePackVisualActionHandlers.cs` 已移除旧执行器调用，无法直接替换的方法统一桩化为 `NotImplementedException("Legacy pipeline deprecated")`。
3. `McpVisualActionContext.cs` / `CompositeVisualActionHandler.cs` 已切到单字段 `action_data`，不再读取旧线缆字段。
4. `ssot/compiler/index.js` 已内置产物同步：`ssot:build` 完成后自动覆盖 `Assets/Editor/Codex/Generated/Ssot/*`。

### 当前残留问题（阻断级已显著下降，但未闭环）
#### P0：Unity 编译状态仍需 Editor 侧实机确认
1. 终端环境缺少 Unity CLI（`Unity`/`Unity.exe` 不在 PATH），当前无法在命令行给出“零红错”最终结论。
2. 已清理 `VisualActionContractValidator` 相关残留关键字，当前代码扫描命中为 0。

#### P1：测试基线仍绑定旧协议
- 历史 EditMode / Node 测试中仍有旧链路依赖，当前通过“跳过/隔离”止血，尚未完成基于 SSOT 新契约的重建。

#### P1：L2 仍有旧写工具入口残留
- 旧写入口（`submit_unity_task/apply_visual_actions/set_ui_properties/...`）仍在主路由体系内，尚未切换到纯 SSOT 写入口组。

#### P1：运行时能力降级（符合当前“清道夫阶段”预期）
- 旧 Action Handler 被桩化后，相关旧动作会抛出 `Legacy pipeline deprecated`，当前目标是保证可编译与残留隔离，不是保证旧能力可用。

### 下一步（执行顺序约束）
1. 在 Unity Editor 内做一次真实编译确认，拿到“无红错”结果（命令行不可替代）。
2. 清理 `VisualActionContractParityBaselineTests.cs` 对已删除类的反射依赖。
3. 继续分批替换“桩化旧执行器”为 SSOT 新执行器，并同步收缩旧工具入口。
4. 最后统一清理测试：删除或重写所有依赖旧协议假设的断言与旧 EditMode 用例。

> 状态结论：当前仓库已进入“拆迁中间态”，尚未达到“可编译 + 可运行”的纯 SSOT 终态。
## 补充修订（2026-03-05）

### A. 旧链路 28 指令基线清单（后续迁移不得遗漏）
以下清单来自 `sidecar/src/ports/contracts.js` 的 `ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names`，作为迁移基线冻结：

1. `submit_unity_task`
2. `get_unity_task_status`
3. `cancel_unity_task`
4. `apply_script_actions`
5. `apply_visual_actions`
6. `set_ui_properties`
7. `set_serialized_property`
8. `get_current_selection`
9. `get_gameobject_components`
10. `get_hierarchy_subtree`
11. `list_assets_in_folder`
12. `get_scene_roots`
13. `find_objects_by_component`
14. `query_prefab_info`
15. `get_action_catalog`
16. `get_action_schema`
17. `get_tool_schema`
18. `get_write_contract_bundle`
19. `preflight_validate_write_payload`
20. `setup_cursor_mcp`
21. `verify_mcp_setup`
22. `capture_scene_screenshot`
23. `get_ui_overlay_report`
24. `get_ui_tree`
25. `get_serialized_property_tree`
26. `hit_test_ui_at_viewport_point`
27. `validate_ui_layout`
28. `hit_test_ui_at_screen_point`

说明：当前 SSOT 工具名与旧 28 清单尚未对齐（当前是并行试点态，不是全量替代态）。

### B. 当前 SSOT 新增 6 指令：用途、来源与审批约束
#### B1. 6 个试点指令用途
1. `modify_ui_layout`：修改 RectTransform 几何参数（坐标、宽高）。
2. `set_component_properties`：对单一对象单一组件属性执行显式写入。
3. `create_object`：在指定父节点下创建对象（含部分对象类型约束）。
4. `instantiate_prefab`：在指定父节点下实例化 prefab。
5. `delete_object`：删除指定锚点对象。
6. `get_scene_snapshot_for_write`：获取写入前快照信息与可用 read token。

#### B2. 为什么不是先做旧 28 个
- 这是“编译链路验证优先”的试点集合，用于先打通 SSOT 字典 -> L2 Schema/AJV -> L3 DTO/Router 的完整编译与运行机制。
- 该集合覆盖了 5 个高频写动作 + 1 个读入口，但不代表迁移完成。

#### B3. 审批与变更纪律（新增）
- 从本条起，新增/删除 SSOT 工具必须先在本文件登记“工具差异表 + 迁移原因 + 影响范围”，再执行代码变更。
- 未经你明确确认，不再新增工具名，只允许对现有工具字段做修复。
- 每次提交必须附带“旧 28 清单映射状态”（`未迁移/迁移中/已迁移`）以防漏项。

### C. 遗漏的废弃代码残留（待删除/替换清单）
以下为本次复查确认的残留（排除 docs 后）：

#### C1. 阻断级（先清）
1. `[已完成]` 删除类仍被运行时直接调用：
   - `Assets/Editor/Codex/Infrastructure/Actions/BuiltInVisualActionHandlers.cs`（已切断旧调用，改为桩化异常）
   - `Assets/Editor/Codex/Infrastructure/Actions/ValuePackVisualActionHandlers.cs`（已切断旧调用，改为桩化异常）
2. `[已完成]` 删除校验器仍被调用：
   - `Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs`（已移除依赖，当前直接放行）
3. `[已完成]` 旧线缆字段仍在运行时主链路读取：
   - `Assets/Editor/Codex/Infrastructure/Actions/McpVisualActionContext.cs`（已改为只读 `action_data`）
   - `Assets/Editor/Codex/Infrastructure/Actions/CompositeVisualActionHandler.cs`（已改为只写 `action_data`）
4. `[待确认]` Unity Editor 实机编译是否 0 红错（需 Editor 内确认）。

#### C2. 高优先级（紧随其后）
1. `[未完成]` 旧写入口仍在主路由暴露（28 指令体系仍是默认主链路）。
2. `[已完成]` `set_serialized_property` 旧 validator 已删除：
   - `sidecar/src/mcp/commands/set_serialized_property/validator.js`
3. `[已完成]` 生成物同步已接入编译流程：
   - `ssot/compiler/index.js` 已在 `ssot:build` 后自动同步 `ssot/artifacts/l3/*` 到 `Assets/Editor/Codex/Generated/Ssot/*`。

#### C3. 量化残留（排除 docs 的关键词扫描）
- `legacy_stringified_action_data`：0 处
- `legacy_marshaled_action_data`：0 处
- `LegacyPrimitiveHandlersDeprecated`：0 处
- `VisualActionContractValidator`：0 处

### D. 残留问题步骤化方案（补充）
#### Step R1：基线冻结与映射表落地
- 在本文件新增“旧 28 -> SSOT 映射矩阵”（状态字段：未迁移/迁移中/已迁移）。
- 所有迁移 PR 必须更新该矩阵。

#### Step R2：先恢复 Unity 可编译
- `[已完成]` 清空 `PendingActionCoordinator` 对已删除校验器的调用。
- `[已完成]` 替换 `BuiltIn/ValuePack` 中对 `LegacyPrimitiveHandlersDeprecated` 的引用（当前为桩化异常）。
- `[已完成]` 去除运行时链路里 `legacy_stringified_action_data/legacy_marshaled_action_data` 读取点。
- `[已完成-2026-03-06]` Unity Editor 侧编译 0 红错确认（`Editor.log` 最新段 `*** Tundra build success`，且成功点后 `error CS* = 0`；见 `docs/L3-Unity编译绿灯留证-2026-03-06.md`）。

#### Step R3：统一生成物与接入点
- `[已完成]` 强制 `ssot/artifacts/l3` 与 `Assets/Editor/Codex/Generated/Ssot` 同步。
- `[进行中]` 将 L2 主入口接入 SSOT 运行时校验注册表（Ajv 编译产物）。

#### Step R4：按批次迁移旧 28 指令
- 先迁移高频读入口（`get_current_selection/get_gameobject_components/get_hierarchy_subtree`）。
- 再迁移写入口与状态入口。
- 每批次迁移后执行“旧入口可见性收缩”。

#### Step R5：执行终态清退
- 删除旧 schema 组装、旧 validator、旧桥接字段相关代码。
- CI 增加反向扫描门禁：命中旧关键词即失败。

### E. “注册 Action 与指令耦合”受 SSOT 影响的原因（补充）
当前耦合仍高，原因不是 SSOT 概念本身，而是“新旧双轨并存且未闭环”：

1. L2 工具注册仍以旧 28 为主，SSOT 新工具未成为唯一来源。
2. L3 Action 注册仍由 `McpActionRegistryBootstrap` 手工注册，未由 SSOT 统一生成驱动。
3. L2 与 L3 之间存在“生成物不同步”与“命名空间并轨”问题，导致同名能力在两端含义可能漂移。
4. 旧桥接字段未清零，造成协议层与执行层存在双契约并存。

结论：只有在“工具定义、参数校验、DTO、执行器分发”全部由 SSOT 单源生成并成为默认主链路后，耦合度才会实质下降。

### F. 闭环判定补充：迁移 28 条后仍需满足的功能门槛
“残留清理 + 迁移旧 28 指令”是必要条件，但不是充分条件。以下门槛未达成前，系统仍是双轨并存态，不属于纯 SSOT 闭环。

#### F1. L1 工具定义必须切到 SSOT 产物主链
现状：`tools/list` 仍由旧 `commandRegistry` + 旧 manifest 驱动。  
证据：
- `sidecar/src/mcp/mcpServer.js`（`getToolsListCache` 仍为主路径）
- `sidecar/src/mcp/commandRegistry.js`（仍在执行 compact/full schema 裁剪）
- `sidecar/src/mcp/commands/legacyCommandManifest.js`

达标条件：
1. `tools/list` 默认输出来源切为 `ssot/artifacts/l2/mcp-tools.generated.json`。
2. 旧 manifest 不再是注册主入口，仅允许迁移期旁路对照。

#### F2. L2 参数校验必须由 SSOT-AJV 接管主调用链
现状：`ssotRuntime/validatorRegistry` 已存在，但主写链路仍依赖旧 validator。  
证据：
- `sidecar/src/application/ssotRuntime/validatorRegistry.js`（模块已就绪）
- `sidecar/src/application/mcpGateway/mcpEyesWriteService.js`（仍调用 legacy validator 族）

达标条件：
1. `tools/call` 进入后先命中 SSOT schema 校验（Ajv runtime compile + normalize）。
2. 旧 `validateMcp*` 仅保留兼容壳并逐步下线，不再承载主校验语义。

#### F3. L2 分发必须切为 SSOT tool-name 到 handler 的单映射
现状：`mcpServer` 仍包含旧工具硬编码调用入口（如 `submit_unity_task/apply_visual_actions`）。  
证据：
- `sidecar/src/mcp/mcpServer.js`（`callToolByName(...)` 旧入口仍在）

达标条件：
1. 工具分发路由由 SSOT 生成索引驱动，不再手工枚举旧工具名。
2. 旧 28 指令在迁移完成后进入“禁用/移除”序列。

#### F4. L2->L3 传输契约必须切到 SSOT DTO 入参
现状：主线仍使用 `unity.action.request` + `VisualLayerActionItem action` 结构。  
证据：
- `sidecar/src/application/unityDispatcher/runtimeUtils.js`
- `Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs`

达标条件：
1. Unity 接收的主 payload 以 SSOT DTO 路由（`tool_name + payload_json` 或等价 Fat DTO）为准。
2. `VisualLayerActionItem` 仅作为历史兼容桥，不再作为新链路标准载体。

#### F5. L3 反序列化路由必须成为真实执行入口
现状：`SsotRequestRouter` 已生成，但仍未接入统一执行主路径。  
证据：
- `Assets/Editor/Codex/Generated/Ssot/SsotBindings.generated.cs`

达标条件：
1. Unity 请求入口先执行 `TryDeserializeByToolName`。
2. 失败即 Fail-Fast 并返回结构化错误，不再回退到 legacy payload 解析。

#### F6. L3 Action 注册必须从手工注册切到 SSOT 驱动
现状：`McpActionRegistryBootstrap` 仍是手工注册核心。  
证据：
- `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`

达标条件：
1. 执行器注册表由 SSOT 生成（或由 SSOT 索引驱动绑定）。
2. 新增 action 不再允许手写双处注册（L2 一套、L3 一套）。

#### F7. 生成物同步必须自动化，消除“双版本漂移”
现状：`ssot:build` 仅输出到 `ssot/artifacts`，Unity 实际消费目录可能滞后。  
证据：
- `sidecar/package.json`（`ssot:build` out-dir 指向 `../ssot/artifacts`）
- `ssot/compiler/index.js`（未内置同步到 `Assets/Editor/Codex/Generated/Ssot`）

达标条件：
1. 构建后自动同步 `ssot/artifacts/l3/*` -> `Assets/Editor/Codex/Generated/Ssot/*`。
2. CI 增加一致性门禁：两处产物 hash 不一致即失败。

#### F8. 闭环验收判定（Definition of Done）
同时满足以下条件才视为“新链路闭环”：
1. L1：`tools/list` 仅暴露 SSOT 生成工具契约。
2. L2：主链路校验全部来自 SSOT-AJV，旧 validator 退役。
3. L2->L3：主线 payload 契约与 SSOT DTO 一致，无 legacy 双源桥接。
4. L3：`TryDeserializeByToolName` + 新执行器分发成为唯一执行入口。
5. 工程：生成物自动同步 + CI 一致性门禁 + 反向扫描门禁全部通过。

---

## 双轨制管线建设与单点迁移评估报告（2026-03-05）

范围：仅评估 `modify_ui_layout` 单点迁移到 SSOT 新管线；旧 `submit_unity_task` 管线继续承载未迁移指令。

### 1. 独立新管线的侵入性评估（Impact Assessment）

结论：**可控中低侵入**，比“一次性替换全链路”风险显著更低。

1. L2 侧侵入面：低  
   - 仅新增一个 tool-name 分支（`modify_ui_layout`）到 SSOT 专属分发器。  
   - 旧入口和旧队列不改语义，不改数据结构。
2. L3 侧侵入面：中低  
   - 新增 `SsotRequestDispatcher` 与单一执行器绑定，不要求改造旧 `PendingActionCoordinator` 核心流程。  
   - 旧执行链保持原状，避免牵一发而动全身。
3. 连环编译错误判断：**有风险但可预测**  
   - 主要风险来自命名冲突、路由注册冲突、DTO 引用缺失。  
   - 这些属于“局部编译错误”，不是系统性不可收敛风险。  
   - 只要坚持“单入口、单执行器、零旧链路回退注入”，不易触发大范围连锁报错。

### 2. 具体物理隔离方案（Isolation Design）

#### L2 端（Sidecar）

1. `callTool(modify_ui_layout)` 命中后，先走 SSOT-AJV 校验。  
2. 校验通过后，直接进入 `ssotRuntime` 专属 dispatch（例如 `dispatchSsotRequest`）。  
3. 明确禁止回退：该分支失败时直接返回 `E_SSOT_ROUTE_FAILED`，**不得**转发到 `apply_visual_actions/submit_unity_task`。  
4. 其他 27 个旧工具保持原分发路径，互不影响。

#### L3 端（Unity）

1. 不新增第二套传输协议栈，优先挂在现有 Query/WebSocket 处理链上的**新路由分支**（如 `query_type=ssot.request`）。  
2. 新分支入口仅做三件事：  
   - 读取 `tool_name + payload_json`  
   - 调用 `SsotBindings.TryDeserializeByToolName(...)`  
   - 分发到 `ModifyUiLayoutSsotExecutor`
3. 与旧 `PendingActionCoordinator` 井水不犯河水：  
   - 旧 coordinator 继续处理旧 task/action 队列。  
   - SSOT 分支不入旧队列、不依赖旧 action validator、不读取旧桥接字段。

### 3. 回滚成本（Rollback Cost）

结论：**回滚成本低**（前提是严格单点迁移，不改旧管线语义）。

1. 运行时回滚（分钟级）  
   - 关闭 `modify_ui_layout -> SSOT` 分支开关（或移除路由映射）。  
   - 重启 Sidecar/Unity 后即恢复旧行为。
2. 代码回滚（小改动集）  
   - 预计只涉及 L2 路由分支、L3 新 dispatcher 绑定、单执行器注册等少量文件。  
   - 可通过单次 revert 回退，不影响旧 28 指令主链。
3. 数据与协议回滚风险  
   - 因为是并行双轨，不删除旧协议结构，回滚不涉及数据迁移，风险较低。

> 评估结论：采用“旧链路保留 + `modify_ui_layout` 单点切新”的绞杀者模式，风险可控，具备可快速回退能力，适合作为 F4/F5 的最小闭环试点。

## 双轨制 SRP 施工图纸（`modify_ui_layout` 单点贯通）

约束：本施工图纸仅覆盖 `modify_ui_layout`；不迁移其余 27 条旧指令；旧 `submit_unity_task` 管线继续存活。

### Step S0：双轨开关与边界常量落地（先立边界，再写逻辑）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/featureFlags.js`（新建）  
   - `sidecar/src/application/ssotRuntime/queryTypes.js`（新建）  
   - `sidecar/src/application/ssotRuntime/index.js`（修改，导出新增模块）
2. 单一职责  
   - `featureFlags.js`：只管理 SSOT 单点开关（例如 `SSOT_MODIFY_UI_LAYOUT_ENABLED`）。  
   - `queryTypes.js`：只定义 `ssot.request` 等常量，禁止业务逻辑。  
   - `index.js`：只做导出聚合。
3. 隔离保证  
   - 开关默认 `off`，未显式启用前不影响旧链路。  
   - 新常量与旧 action 类型常量不共用命名空间，避免误路由。

### Step S1：L2 工具注册单点接入（只暴露一个新工具）

1. 涉及文件  
   - `sidecar/src/mcp/commands/definitions/modify_ui_layout.js`（新建）  
   - `sidecar/src/mcp/commands/definitions/index.js`（修改，追加一个 definition）  
   - `sidecar/src/mcp/commands/legacyCommandManifest.js`（修改，仅接线依赖）
2. 单一职责  
   - `definitions/modify_ui_layout.js`：只描述工具元数据（name/description/inputSchema/http mapping）。  
   - `definitions/index.js`：只维护 definition 列表顺序。  
   - `legacyCommandManifest.js`：只做依赖装配，不写业务规则。
3. 隔离保证  
   - 仅新增 `modify_ui_layout` 一条工具定义；旧 28 指令定义不改语义。  
   - 该工具独立 HTTP 路径（如 `/mcp/modify_ui_layout`），不复用旧写入口路径。

### Step S2：L2 校验层独立（AJV 只服务 SSOT 单点）

1. 涉及文件  
   - `sidecar/src/mcp/commands/modify_ui_layout/validator.js`（新建）  
   - `sidecar/src/application/ssotRuntime/validatorRegistry.js`（修改，增加 registry 单例获取接口）  
   - `sidecar/src/application/ssotRuntime/loadCompiledSchemas.js`（可选修改，仅当需要更清晰错误码）
2. 单一职责  
   - `modify_ui_layout/validator.js`：只调用 SSOT-AJV 做请求体校验与错误映射。  
   - `validatorRegistry.js`：只提供 schema->validate 能力，不做分发。  
   - `loadCompiledSchemas.js`：只负责产物读取与格式化。
3. 隔离保证  
   - 校验失败直接返回 `E_SSOT_SCHEMA_INVALID`，禁止回退旧 validator。  
   - 旧 `validateMcp*` 不参与此工具验证链。

### Step S3：L2 分发层独立（禁止进入旧 Action 队列）

1. 涉及文件  
   - `sidecar/src/mcp/commands/modify_ui_layout/handler.js`（新建）  
   - `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`（新建）  
   - `sidecar/src/application/turnService.js`（修改，仅新增 `modifyUiLayoutForMcp` 委派方法）
2. 单一职责  
   - `modify_ui_layout/handler.js`：只做 command->turnService 调用。  
   - `dispatchSsotRequest.js`：只做 `tool_name + payload_json` 封装并调用 query runtime。  
   - `turnService.js`：只新增门面方法，不承载具体校验/序列化细节。
3. 隔离保证  
   - `dispatchSsotRequest.js` 只允许走 `enqueueAndWaitForUnityQuery({ queryType: "ssot.request" })`。  
   - 明确禁止 fallback 到 `mcpGateway.submitUnityTask`、`mcpEyesWriteService.applyVisualActions`。  
   - 分支失败直接返回 `E_SSOT_ROUTE_FAILED`。

### Step S4：L3 Query 路由接入（挂在现有 Query 总线新分支）

1. 涉及文件  
   - `Assets/Editor/Codex/Infrastructure/Queries/IUnityQueryHandler.cs`（修改，新增 `UnityQueryTypes.SsotRequest`）  
   - `Assets/Editor/Codex/Infrastructure/Queries/Handlers/SsotRequestQueryHandler.cs`（新建）  
   - `Assets/Editor/Codex/Infrastructure/Queries/UnityQueryRegistryBootstrap.cs`（修改，注册新 handler）
2. 单一职责  
   - `IUnityQueryHandler.cs`：仅维护 query type 常量契约。  
   - `SsotRequestQueryHandler.cs`：仅处理 `query_type=ssot.request` 解析与分发调用。  
   - `UnityQueryRegistryBootstrap.cs`：仅注册 handler 列表。
3. 隔离保证  
   - 新分支走 `/unity/query/pull|report` 现有 Query 通道，不触碰 `PendingActionCoordinator`。  
   - 旧 `unity.action.request` 与 action 队列无任何新增依赖。

### Step S5：L3 SSOT Dispatcher 与单执行器（只实现一个工具）

1. 涉及文件  
   - `Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs`（新建）  
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/ModifyUiLayoutSsotExecutor.cs`（新建）  
   - `Assets/Editor/Codex/Generated/Ssot/SsotBindings.generated.cs`（已有生成物，直接消费，不手改）
2. 单一职责  
   - `SsotRequestDispatcher.cs`：只负责 `TryDeserializeByToolName` + executor 分发。  
   - `ModifyUiLayoutSsotExecutor.cs`：只做 RectTransform 定位与尺寸修改。  
   - `SsotBindings.generated.cs`：只提供生成的强类型路由，不承载业务逻辑。
3. 隔离保证  
   - Dispatcher 不引用 `McpActionRegistryBootstrap`、`CompositeVisualActionHandler`。  
   - Executor 不读取旧桥接字段，不写入旧 action 模型。

### Step S6：L2/L3 结果契约对齐（只定义 SSOT 单点响应）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`（修改，统一响应映射）  
   - `Assets/Editor/Codex/Infrastructure/Queries/Handlers/SsotRequestQueryHandler.cs`（修改，统一错误码输出）
2. 单一职责  
   - L2：只做 Unity query 响应到 MCP 响应的映射。  
   - L3：只做 handler 执行结果到 query report payload 的映射。
3. 隔离保证  
   - 响应映射不读取旧 job 状态机字段，不污染旧写任务状态。  
   - 错误码命名空间与旧 action 错误码可并存，但不互相依赖。

### Step S7：回滚开关与验收门禁（先可回退，再放量）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/featureFlags.js`（修改，增加默认关闭与环境读取）  
   - `docs/SSOT 字典架构方案与旧代码清退计划.md`（修改，记录启停流程与回滚指令）  
   - `sidecar/tests/application/ssot-modify-ui-layout-route.test.js`（新建）  
   - `Assets/Editor/Codex/Tests/EditMode/SsotRequestQueryHandlerTests.cs`（新建）
2. 单一职责  
   - feature flag：只决定是否启用新分支。  
   - 文档：只定义运维/回滚操作。  
   - 测试：只验证“新分支命中”与“不回退旧链路”。
3. 隔离保证  
   - 关闭开关后，`modify_ui_layout` 可直接不可用或切回旧实现（按策略二选一），不影响其他工具。  
   - 回滚不删除旧 28 指令，不触发全链路重构。

### 施工顺序硬约束（防耦合）

1. 必须按 `S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7` 顺序推进。  
2. 每一步提交前要求“只改本步骤文件集”，禁止跨步骤混改。  
3. 任一步出现编译或路由冲突，先回退该步骤提交，不得在下一步补丁式修复。  
4. 未通过 `S7` 的隔离测试前，不允许迁移第二个 SSOT 写工具。

---

## 28 指令 SSOT 迁移矩阵（Migration Matrix）

约束：
1. 本矩阵只覆盖“旧 28 指令”，不包含 6 个 SSOT 试点工具。  
2. 每批次最多 3 个指令。  
3. 迁移状态只使用：`未迁移 / 迁移中 / 已迁移`。  

进度汇总（2026-03-05）：
1. 已迁移：`21/28`（代码链路已完成并通过本地门禁，最终状态以实机留证为准）。  
2. 迁移中：`7/28`（Batch 8 + Batch 9 + Batch 10 已完成 SSOT 字典/L2 校验与路由切换，待实机正负例留证）。  
3. 未迁移：`0/28`。  

| 序号 | 旧指令 | 类型 | 批次 | 迁移状态 | 说明 |
|---|---|---|---|---|---|
| 1 | `get_current_selection` | Read | Batch 1 | 已迁移 | 已走 SSOT-AJV 校验 + `ssot.request` + L3 Executor |
| 2 | `get_gameobject_components` | Read | Batch 1 | 已迁移 | 已走 SSOT-AJV 校验 + `ssot.request` + L3 Executor |
| 3 | `get_hierarchy_subtree` | Read | Batch 1 | 已迁移 | 已走 SSOT-AJV 校验 + `ssot.request` + L3 Executor |
| 4 | `get_scene_roots` | Read | Batch 2 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 5 | `list_assets_in_folder` | Read | Batch 2 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 6 | `find_objects_by_component` | Read | Batch 2 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 7 | `query_prefab_info` | Read | Batch 3 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 8 | `get_ui_tree` | Read | Batch 3 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 9 | `get_ui_overlay_report` | Read | Batch 3 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 10 | `hit_test_ui_at_viewport_point` | Read | Batch 4 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 11 | `validate_ui_layout` | Read | Batch 4 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 12 | `get_serialized_property_tree` | Read | Batch 4 | 已迁移 | SSOT-AJV + `ssot.request` + L3 Executor 已实机通过 |
| 13 | `capture_scene_screenshot` | Read | Batch 5 | 已迁移 | 已完成 SSOT-AJV + `ssot.request` + L3 Executor 实机验收 |
| 14 | `get_action_catalog` | Meta-Read | Batch 5 | 已迁移 | 已按 Bucket B 处置为 Deprecated Stub（固定成功消息，不再访问 capabilityStore/L3） |
| 15 | `get_action_schema` | Meta-Read | Batch 5 | 已迁移 | 已按 Bucket B 处置为 Deprecated Stub（固定成功消息，不再访问 capabilityStore/L3） |
| 16 | `get_tool_schema` | Meta-Read | Batch 6 | 已迁移 | 已切换为 SSOT 静态产物读取模式（读取 `ssot/artifacts/l2/mcp-tools.generated.json`，不访问 capabilityStore/L3） |
| 17 | `get_write_contract_bundle` | Meta-Read | Batch 6 | 已迁移 | 已切换为 SSOT 静态产物读取模式（静态 write contract + 示例模板，不访问 capabilityStore/L3） |
| 18 | `preflight_validate_write_payload` | Meta-Write | Batch 6 | 已迁移 | 已按 Bucket A 贯通：仅走 SSOT validator registry + ssotTokenRegistry/revisionState 校验 |
| 19 | `setup_cursor_mcp` | Admin | Batch 7 | 已迁移 | 实机验收通过：SSOT-AJV + 原执行器复用可用 |
| 20 | `verify_mcp_setup` | Admin-Read | Batch 7 | 已迁移 | 实机验收通过：SSOT-AJV + 原执行器复用可用 |
| 21 | `get_unity_task_status` | Status | Batch 7 | 已迁移 | 实机验收通过：使用真实 job_id 可正常查询状态；不存在 job_id 返回 `E_JOB_NOT_FOUND`（预期） |
| 22 | `cancel_unity_task` | Status-Write | Batch 8 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + turnService 直连；`ssot-batch-route` 单测通过，待实机验收 |
| 23 | `submit_unity_task` | Write | Batch 8 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + turnService 直连；修复 `oneOf` 严格模式后 `ssot-batch-route` 单测通过，待实机验收 |
| 24 | `apply_script_actions` | Write | Batch 8 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + turnService 直连；`ssot-batch-route` 单测通过，待实机验收 |
| 25 | `apply_visual_actions` | Write | Batch 9 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + `turnServiceMethod`；L2 走 `dispatchSsotToolForMcp`，L3 在 SSOT dispatcher 中返回 `E_SSOT_TOOL_DEPRECATED`（不回退旧队列） |
| 26 | `set_ui_properties` | Write | Batch 9 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + `turnServiceMethod`；L2 走 `dispatchSsotToolForMcp`，L3 在 SSOT dispatcher 中返回 `E_SSOT_TOOL_DEPRECATED`（不回退旧队列） |
| 27 | `set_serialized_property` | Write | Batch 9 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + `turnServiceMethod`；L2 走 `dispatchSsotToolForMcp`，不再映射 legacy `apply_visual_actions` |
| 28 | `hit_test_ui_at_screen_point` | Read | Batch 10 | 迁移中 | 已切换 SSOT 字典 + SSOT-AJV validator + `turnServiceMethod`；L3 `HitTestUiAtScreenPointSsotExecutor` 已接入并走 viewport 命中链路 |

### 2026-03-05 进度同步（以《28 指令旧链路清除与 SSOT 闭环执行计划》为准）

1. Batch7：`setup_cursor_mcp` / `verify_mcp_setup` 已从 `execute` 改为 `turnServiceMethod`；对应 legacy handler 文件已删除。  
2. Batch8：`cancel_unity_task` / `submit_unity_task` / `apply_script_actions` 保持 `turnServiceMethod + validate`，统一走 SSOT 分发入口。  
3. Batch9：`set_ui_properties` / `set_serialized_property` 旧 handler 死文件已删除；四工具（含 `apply_visual_actions`）均保持 SSOT-only 路由。  
4. Batch10：`hit_test_ui_at_screen_point` 保持 `turnServiceMethod`，并由 SSOT executor 执行，不回退 legacy disabled handler。  
5. 本地门禁已通过：  
   - `ssot-batch-route.test.js`  
   - `protocol-write-consistency.test.js`  
   - `r12-tool-visibility-freeze.test.js`  
6. 状态口径收敛：已完成（矩阵与批次记录口径已对齐到《28 指令闭环执行计划》）。  
7. 当前剩余未完成项：  
   - MCP 实机正负例留证（Batch8~Batch10 仍待统一证据归档）；  
   - P2 全局扫尾（“全部批次实机验收后”的最终未引用 legacy 统一清理）尚未执行。  

Batch 6 实机验收补充结论（2026-03-05）：
1. `get_tool_schema`：已从动态查询改为静态产物读取模式（需按新返回结构复测）。  
2. `get_write_contract_bundle`：已从动态聚合改为静态合同模式（需按新返回结构复测）。  
3. `preflight_validate_write_payload`：通过，但具备严格新鲜度约束。旧 token 会因 `scene_revision` 漂移返回 `E_SCENE_REVISION_DRIFT`；最新读结果 token 可通过。  

Batch 7 实机验收补充结论（2026-03-05）：
1. `setup_cursor_mcp`：通过。  
2. `verify_mcp_setup`：通过。  
3. `get_unity_task_status`：通过（真实存在 job_id 返回任务状态；不存在 job_id 返回 `E_JOB_NOT_FOUND`，属于预期输入错误，不是路由故障）。  

Batch 8 当前进展（2026-03-05）：
1. `cancel_unity_task`：SSOT 字典 + L2 validator + definition/manifest 接线完成。  
2. `submit_unity_task`：SSOT 字典 + L2 validator + definition/manifest 接线完成；已修复 AJV `strictRequired` 阻断（`oneOf.required` 子项补齐 `properties`）。  
3. `apply_script_actions`：SSOT 字典 + L2 validator + definition/manifest 接线完成。  
4. 本地验证：`node --test sidecar/tests/application/ssot-batch-route.test.js` 全量通过（30/30）。  
5. 待办：MCP 实机验收（真实 Sidecar + Unity 环境）。  

Batch 9/10 当前进展（2026-03-05，同步后）：
1. `apply_visual_actions`：已切换到 `turnServiceMethod + SSOT-AJV`，L2 走 `dispatchSsotToolForMcp`。  
2. `set_ui_properties`：已切换到 `turnServiceMethod + SSOT-AJV`，L2 走 `dispatchSsotToolForMcp`。  
3. `set_serialized_property`：已切换到 `turnServiceMethod + SSOT-AJV`，L2 走 `dispatchSsotToolForMcp`，不再映射 legacy `apply_visual_actions`。  
4. `hit_test_ui_at_screen_point`：已切换到 `turnServiceMethod + SSOT-AJV`，L3 `HitTestUiAtScreenPointSsotExecutor` 已接入。  
5. Batch9 死代码清理：`sidecar/src/mcp/commands/set_ui_properties/handler.js`、`sidecar/src/mcp/commands/set_serialized_property/handler.js` 已删除。  
6. 本地门禁：`ssot-batch-route`、`protocol-write-consistency`、`r12-tool-visibility-freeze` 已通过。  

P2 全局扫尾（安全子集，2026-03-05）：
1. 已删除 manifest 内失联 helper：`validateGetUnityTaskStatusArgs`（无 definition 消费）。  
2. Sidecar 关键旧桥接关键字扫描结果：`action_data_json / action_data_marshaled / legacy_stringified_action_data / legacy_marshaled_action_data` 命中 `0`（`sidecar/src` 范围）。  
3. 说明：最终 P2 仍需在 Batch8~Batch10 实机留证完成后执行“全仓未引用 legacy 统一清理”。  

9 指令分类处置执行结果（2026-03-05，同步后）：
1. Bucket A（`preflight_validate_write_payload`）：已切到纯 SSOT 路径，仅依赖 SSOT validator metadata + token/revision 门禁。  
2. Bucket B（`get_action_catalog/get_action_schema`）：已改为 Deprecated Stub，固定成功消息，不访问 capabilityStore/L3。  
3. Transitional Static（`get_tool_schema/get_write_contract_bundle`）：已改为 SSOT 静态产物读取模式，不走动态能力查询。  
4. 原 Bucket C 结论已过期：`submit_unity_task/cancel_unity_task/get_unity_task_status/apply_script_actions` 现已在 L2 命令层统一走 `turnServiceMethod + validate`，以当前《28 指令闭环执行计划》记录为准。  

## Batch 9/10 收口项（同步后）

1. 已完成：Batch9/10 的 L2 路由已达到 SSOT-only（命令层无 legacy execute/fallback）。  
2. 已完成：Batch9 的两处失联 handler 死文件已物理删除。  
3. 待完成：Batch9 与 Batch10 的 MCP 实机正负例留证。  
4. 待完成：将 Batch9/10 迁移状态在矩阵中由 `迁移中` 收敛为最终状态（前提是实机留证补齐）。  

---

## SSOT 读写防重放与 Token 机制（Token Authority）

### 架构决议（强约束）

1. Sidecar（L2）是唯一 Token 签发与校验权威（Token Authority）。  
2. Unity（L3）不再签发可直接用于写入的 token；L3 只返回快照上下文（如 `scene_revision`、`target_object_id`、`target_path`、`scope`）。  
3. 所有 SSOT 写请求在进入 L3 之前，必须先在 L2 通过 Token 校验门禁。  
4. 禁止新增“新 token -> 旧 token”转化器；禁止在旧 Action 队列加 `if/else` 兼容分支。

### Token 契约（Authority v1）

1. Token 字符串格式：`ssot_rt_<opaque>`，最小长度 `24`。  
2. Token 仅由 L2 签发，签发输入来自 L3 读结果上下文，不使用 L3 生成 token。  
3. L2 Token Registry 存储字段（最小集合）：  
   - `token`  
   - `issued_at_ms`  
   - `expires_at_ms`  
   - `hard_max_age_ms`  
   - `scene_revision`  
   - `scope_kind`  
   - `object_id`  
   - `path`  
   - `source_tool_name`  
4. TTL 策略：  
   - 默认硬过期：`180000ms`（3 分钟）  
   - 超期即失效，不做自动续期  
5. 校验语义：  
   - `token` 必须存在且命中 registry  
   - 未过期  
   - `scene_revision` 与当前快照一致（防重放/防跨场景写入）

### 错误码分层（替代单一 `E_STALE_SNAPSHOT`）

1. `E_TOKEN_UNKNOWN`：token 未注册、伪造、格式非法或已被清理。  
2. `E_TOKEN_EXPIRED`：token 已超过 `hard_max_age_ms`。  
3. `E_SCENE_REVISION_DRIFT`：token 绑定的 `scene_revision` 与当前快照不一致。  
4. `E_STALE_SNAPSHOT`：仅保留给旧链路兼容期；SSOT 新链路不再主动返回该泛化码。

### SSOT 独立的 Scene Revision 追踪机制

#### 架构决定（强约束）

1. SSOT 运行时在 L2 维护独立状态 `latest_known_scene_revision`。  
2. 该状态不读取、不写入旧 `unitySnapshotService`；两套状态模型完全物理隔离。  
3. Token 校验的“当前 revision 基准值”只来自 SSOT 运行时状态。

#### 状态结构（Authority Runtime State）

1. `latest_known_scene_revision`: 当前 SSOT 已知最新场景版本。  
2. `updated_at_ms`: 最近一次接收并采纳 revision 的时间戳。  
3. `source_tool_name`: 最近一次更新该 revision 的工具名。  
4. `source_request_id`: 最近一次更新该 revision 的请求标识（可选）。

#### 状态更新触发时机

1. 读工具成功响应且 `data.scene_revision` 非空时：更新 `latest_known_scene_revision`。  
2. 写工具成功响应且 `data.scene_revision` 非空时：更新 `latest_known_scene_revision`。  
3. 失败响应不更新 revision（避免污染基准）。  
4. 若响应缺失 revision：保持上次有效值，不做降级回填旧链路。

#### 校验链路使用方式

1. `validateToken` 不再依赖旧快照服务读取 current revision。  
2. `validateToken` 直接读取 SSOT Runtime State 的 `latest_known_scene_revision`。  
3. 当基准为空时返回 `E_SCENE_REVISION_DRIFT`（`current revision unavailable`）；不回退到 `E_STALE_SNAPSHOT`。

### Revision 闭环 SRP 施工图纸（文件级）

#### Step R0：独立 revision 状态存储（State Store）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/ssotRevisionState.js`（新建）  
   - `sidecar/src/application/ssotRuntime/index.js`（修改，导出 singleton）  
2. 单一职责  
   - 维护 `latest_known_scene_revision` 的读写与时间戳。  
3. 物理隔离承诺  
   - 仅服务 SSOT Runtime，不依赖 `unitySnapshotService`、`mcpGateway`。

#### Step R1：响应拦截更新钩子（Update Hook）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`（修改）  
2. 单一职责  
   - 在 SSOT query 成功响应后提取 `data.scene_revision` 并写入 `ssotRevisionState`。  
3. 物理隔离承诺  
   - 仅拦截 `ssot.request` 分支，不改旧 action/query 分支逻辑。

#### Step R2：Token Registry 校验基准切换

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/ssotTokenRegistry.js`（修改）  
   - `sidecar/src/application/ssotRuntime/ssotWriteTokenGuard.js`（修改）  
2. 单一职责  
   - `validateToken` 的 current revision 输入改为 `ssotRevisionState.getLatestKnownSceneRevision()`。  
3. 物理隔离承诺  
   - 禁止从 `unitySnapshotService.getCurrentSceneRevision()` 读取基准。

#### Step R3：门禁接线（Preflight/写入口）

1. 涉及文件  
   - `sidecar/src/application/turnService.js`（修改）  
   - `sidecar/src/mcp/commands/preflight_validate_write_payload/handler.js`（修改）  
2. 单一职责  
   - 在 preflight 与 SSOT 写分发前调用 token guard；guard 内部使用 SSOT revision state。  
3. 物理隔离承诺  
   - 不在旧 `submit_unity_task/apply_visual_actions` 主链路增加 SSOT revision 兼容逻辑。

#### Step R4：闭环测试门禁

1. 涉及文件  
   - `sidecar/tests/application/ssot-revision-state.test.js`（新建）  
   - `sidecar/tests/application/ssot-dispatch-revision-update.test.js`（新建）  
   - `sidecar/tests/application/ssot-token-revision-guard.test.js`（新建）  
2. 单一职责  
   - 验证“读返回 revision -> state 更新 -> preflight 校验通过/失败”的闭环。  
3. 物理隔离承诺  
   - 测试中禁止 mock 旧 `unitySnapshotService` 作为 revision 基准。

### Token 机制 SRP 施工图纸（文件级）

#### Step T0：契约与常量先行（只定规则，不接业务）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/tokenContract.js`（新建）  
   - `sidecar/src/application/ssotRuntime/index.js`（修改，导出契约）  
2. 单一职责  
   - `tokenContract.js`：只定义 token 前缀、最小长度、TTL、错误码枚举。  
3. 物理隔离承诺  
   - 不引用 `mcpGateway`/`mcpEyesWriteService`/旧 validator，防止旧链路反向耦合。

#### Step T1：建立 L2 Token Registry（唯一签发与校验中心）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/ssotTokenRegistry.js`（新建）  
   - `sidecar/src/application/ssotRuntime/index.js`（修改，导出 singleton）  
2. 单一职责  
   - `issueToken(context)`：根据读上下文签发 token 并落库。  
   - `validateToken(token, currentSnapshot)`：只做存在性/过期/版本漂移校验。  
3. 物理隔离承诺  
   - registry 不读旧 `readTokensByValue`，不做新旧 token 双写。

#### Step T2：读链路签发钩子（Issuer Hook）

1. 涉及文件  
   - `sidecar/src/application/ssotRuntime/dispatchSsotRequest.js`（修改）  
   - `sidecar/src/application/ssotRuntime/readToolClassifier.js`（新建）  
2. 单一职责  
   - `dispatchSsotRequest.js`：识别读工具响应并调用 `issueToken`，将 L2 签发 token 注入返回 payload。  
   - `readToolClassifier.js`：只维护“哪些 SSOT 读工具产生 write-ready token”的名单。  
3. 物理隔离承诺  
   - 不透传 L3 的 `read_token_candidate`；统一替换为 L2 Authority token。  
   - 不回写旧 action 队列 token 存储。

#### Step T3：Preflight 门禁钩子（Validator Hook）

1. 涉及文件  
   - `sidecar/src/mcp/commands/preflight_validate_write_payload/handler.js`（修改）  
   - `sidecar/src/application/ssotRuntime/ssotWriteTokenGuard.js`（新建）  
2. 单一职责  
   - `ssotWriteTokenGuard.js`：只封装 `validateToken` 调用与错误码映射。  
   - `preflight handler`：只在 preflight 入口执行 token 校验并 fail-fast。  
3. 物理隔离承诺  
   - 不增加“校验失败后回退旧 preflight”的逻辑。  
   - 不产出旧格式错误对象适配器。

#### Step T4：SSOT 写入口统一门禁（全量写工具）

1. 涉及文件  
   - `sidecar/src/application/turnService.js`（修改）  
   - `sidecar/src/application/ssotRuntime/writeToolClassifier.js`（新建）  
2. 单一职责  
   - `writeToolClassifier.js`：只维护 SSOT 写工具名单。  
   - `turnService.js`：在 SSOT 写工具分发前统一调用 token guard。  
3. 物理隔离承诺  
   - 不在旧 `submit_unity_task/apply_visual_actions` 主链路里插入 SSOT token 兼容分支。

#### Step T5：L3 读返回契约收敛（只吐上下文，不吐 token）

1. 涉及文件  
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/SsotExecutorCommon.cs`（修改）  
   - `Assets/Editor/Codex/Infrastructure/Ssot/Executors/*Read*SsotExecutor.cs`（按需修改）  
2. 单一职责  
   - 统一补齐 `scene_revision/target_path/target_object_id/scope` 返回字段。  
   - 删除或废弃 `read_token_candidate` 返回字段。  
3. 物理隔离承诺  
   - L3 不感知 token 生命周期，不参与签发/校验决策。

#### Step T6：测试与门禁（先测后接线）

1. 涉及文件  
   - `sidecar/tests/application/ssot-token-registry.test.js`（新建）  
   - `sidecar/tests/application/ssot-dispatch-token-issuance.test.js`（新建）  
   - `sidecar/tests/application/ssot-preflight-token-gate.test.js`（新建）  
   - `Assets/Editor/Codex/Tests/EditMode/SsotReadContextContractTests.cs`（新建）  
2. 单一职责  
   - 验证签发、过期、漂移、未知 token 与错误码映射。  
3. 物理隔离承诺  
   - 测试仅覆盖 SSOT 新链路，不以“兼容旧链路通过”为通过条件。

#### 施工硬约束（无胶水）

1. 禁止新增“新 token <-> 旧 token”适配器文件。  
2. 禁止在旧 Action 队列逻辑里增加 SSOT token 分支。  
3. 新链路失败只能在新链路内失败，不得 fallback 到旧链路。  
4. 任一步出现耦合迹象，先回退该步，不允许补丁式混接。

---

## Action 迁移清单（意图驱动细粒度，3 个一组）

说明：`28 指令矩阵` 是 MCP 工具层；以下是 Unity Action 层。两层都要迁移，不能只迁工具不迁 action。  
Action 基线来源：`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`，当前注册 action 共 `29` 个（含 `composite_visual_action`）。

### 迁移原则（已生效）

1. 拒绝 God-Tool：不再使用 `set_object_state` / `set_transform` / `set_ui_style_properties` 这种“多意图大工具”。  
2. 单一意图单一工具：`rename_object`、`set_active`、`set_parent`、`add_component`、`remove_component` 等都保持独立。  
3. 只允许高门槛合并：仅在高频同改且校验规则一致时合并（如 `modify_ui_layout` 承载 `RectTransform` 几何组）。  
4. 每批次最多 3 个 action，先字典、再生成、再路由、再执行器。  

### Action 进度快照（2026-03-05，归纳版）

1. A1~A10 已全部完成 SSOT 工具连线（L1/L2/L3）。  
2. A1~A10 已完成 L2 入口收敛：统一为 `turnServiceMethod + validate`。  
3. A1~A10 对应旧 `handler.js` 已物理删除，legacy action registry 对应注册已移除。  
4. 当前缺口集中在“实机留证”和“全局扫尾”，不在功能连线本身。  

### 29 个 action 到 SSOT 工具映射（细粒度）

| 序号 | 旧 action | 目标 SSOT 工具 | 当前状态 | 备注 |
|---|---|---|---|---|
| 1 | `add_component` | `add_component` | 已连线（待实机） | 与属性修改分离，已补齐 L2/L3 连线 |
| 2 | `remove_component` | `remove_component` | 已连线（待实机） | 与属性修改分离，已补齐 L2/L3 连线 |
| 3 | `replace_component` | `replace_component` | 已连线（待实机） | 与 add/remove 分离，已补齐 L2/L3 连线 |
| 4 | `set_serialized_property` | `set_serialized_property` | 已连线（待实机） | 已切到 SSOT 直达 `ssot.request`，不再映射 legacy visual queue |
| 5 | `create_object` | `create_object` | 已连线（待实机） | 已补齐 L2/L3 连线与本地路由单测 |
| 6 | `set_active` | `set_active` | 已连线 | 新 executor 已接入 |
| 7 | `rename_object` | `rename_object` | 已连线 | 新 executor 已接入 |
| 8 | `destroy_object` | `delete_object` | 已连线（待实机） | 语义一一对应（仅命名变化），已补齐 L2/L3 连线 |
| 9 | `set_parent` | `set_parent` | 已连线 | 新 executor 已接入 |
| 10 | `set_sibling_index` | `set_sibling_index` | 已连线（待实机） | 保持独立工具，已补齐 L2/L3 连线 |
| 11 | `duplicate_object` | `duplicate_object` | 已连线（待实机） | 保持独立工具，已补齐 L2/L3 连线 |
| 12 | `set_local_position` | `set_local_position` | 已连线（待实机） | 与旋转/缩放分离，已补齐 L2/L3 连线 |
| 13 | `set_local_rotation` | `set_local_rotation` | 已连线（待实机） | 与位置/缩放分离，已补齐 L2/L3 连线 |
| 14 | `set_local_scale` | `set_local_scale` | 已连线（待实机） | 与位置/旋转分离，已补齐 L2/L3 连线 |
| 15 | `set_world_position` | `set_world_position` | 已连线（待实机） | 世界坐标独立，已补齐 L2/L3 连线 |
| 16 | `set_world_rotation` | `set_world_rotation` | 已连线（待实机） | 世界旋转独立，已补齐 L2/L3 连线 |
| 17 | `reset_transform` | `reset_transform` | 已连线（待实机） | 独立语义，不复用 set_*，已补齐 L2/L3 连线 |
| 18 | `set_rect_anchored_position` | `set_rect_anchored_position` | 已连线（待实机） | 已独立迁移为细粒度工具，不再依赖 `modify_ui_layout` |
| 19 | `set_rect_size_delta` | `set_rect_size_delta` | 已连线（待实机） | 已独立工具，不再挂靠 `modify_ui_layout` |
| 20 | `set_rect_pivot` | `set_rect_pivot` | 已连线（待实机） | 不并入通用 set_ui_* |
| 21 | `set_rect_anchors` | `set_rect_anchors` | 已连线（待实机） | 不并入通用 set_ui_* |
| 22 | `set_canvas_group_alpha` | `set_canvas_group_alpha` | 已连线（待实机） | 保持独立工具 |
| 23 | `set_layout_element` | `set_layout_element` | 已连线（待实机） | 保持独立工具 |
| 24 | `set_ui_image_color` | `set_ui_image_color` | 已连线（待实机） | 保持独立工具 |
| 25 | `set_ui_image_raycast_target` | `set_ui_image_raycast_target` | 已连线（待实机） | 保持独立工具 |
| 26 | `set_ui_text_content` | `set_ui_text_content` | 已连线（待实机） | 保持独立工具 |
| 27 | `set_ui_text_color` | `set_ui_text_color` | 已连线（待实机） | 保持独立工具 |
| 28 | `set_ui_text_font_size` | `set_ui_text_font_size` | 已连线（待实机） | 保持独立工具 |
| 29 | `composite_visual_action` | `execute_unity_transaction` | 已连线（待实机） | 承载跨工具原子事务 |

### Action 分批计划（每批 <= 3）

| 批次 | 工具（细粒度） | 批次状态 | 备注 |
|---|---|---|---|
| A1 | `rename_object` / `set_active` / `set_parent` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A2 | `create_object` / `delete_object` / `set_sibling_index` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A3 | `duplicate_object` / `add_component` / `remove_component` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A4 | `replace_component` / `set_serialized_property` / `set_local_position` | 已完成并清理旧注册（待实机） | `replace_component`/`set_local_position` 已切为 `turnServiceMethod + validate` 并删除旧 `handler.js`；`set_serialized_property` 继续保持 SSOT 直达 |
| A5 | `set_local_rotation` / `set_local_scale` / `set_world_position` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A6 | `set_world_rotation` / `reset_transform` / `set_rect_anchored_position` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A7 | `set_rect_size_delta` / `set_rect_pivot` / `set_rect_anchors` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A8 | `set_canvas_group_alpha` / `set_layout_element` / `set_ui_image_color` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A9 | `set_ui_image_raycast_target` / `set_ui_text_content` / `set_ui_text_color` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |
| A10 | `set_ui_text_font_size` / `execute_unity_transaction` | 已完成并清理旧注册（待实机） | 已切为 `turnServiceMethod + validate`，对应 legacy `handler.js` 已删除 |

迁移纪律：
1. 先迁细粒度工具，再删除对应旧 action handler。  
2. 每迁完一个批次，必须更新“批次状态 + 映射状态”。  
3. `apply_visual_actions` 仅作过渡兜底，直到 action 映射表全部完成并验收后退役。  
4. 禁止把多个意图重新折叠回单工具（禁止回到 God-Tool 方案）。

---

## Action 旧链路清除与 SSOT 闭环执行计划（A1~A10）

日期：2026-03-05  
范围：仅覆盖 Action 迁移批次 A1~A10 的“删旧 + 闭环”；不覆盖 28 指令工具层迁移细节。

---

### 1. 目标与边界
#### 1.1 目标
1. 让 A1~A10 对应 Action 全部达到 `SSOT-only`。  
2. 彻底移除这些 Action 对 legacy action registry / legacy visual queue / legacy bridge 字段的运行时依赖。  
3. 建立“每批次迁移后必须删旧并留证”的闭环，禁止长期并存。

#### 1.2 强制纪律
1. 禁止最小补丁式兼容：不新增新旧格式转换器，不加 fallback。  
2. 每批次最多 3 个 Action，必须按“迁移 + 删旧 + 双测 + 文档回填”完成。  
3. 遵循 SRP：L1 只管契约，L2 只管门禁与分发，L3 只管 DTO 与执行。  
4. 任一批次未达到 `SSOT-only`，不得推进下一批。

---

### 2. 完成定义（DoD）
每个 Action 从“迁移中”到“已完成”必须同时满足：

1. L1：字典契约已落地，`tools/list` 仅暴露 SSOT 生成 schema。  
2. L2：请求只走 `validatorRegistry -> dispatchSsotToolForMcp(query_type=ssot.request)`。  
3. L3：请求只走 `SsotRequestDispatcher -> 对应 SsotExecutor`，不进入 legacy action registry。  
4. 删旧计数：该 Action 相关 legacy 注册、legacy handler 调用、`action_data_*` 读取命中为 0。  
5. 验收双测：
   - Node 路由与门禁单测通过。  
   - MCP 实机正例 + fail-fast 负例通过并留证。

---

### 3. A1~A10 批次清单（每批 <= 3）
1. A1：`rename_object` / `set_active` / `set_parent`  
2. A2：`create_object` / `delete_object` / `set_sibling_index`  
3. A3：`duplicate_object` / `add_component` / `remove_component`  
4. A4：`replace_component` / `set_serialized_property` / `set_local_position`  
5. A5：`set_local_rotation` / `set_local_scale` / `set_world_position`  
6. A6：`set_world_rotation` / `reset_transform` / `set_rect_anchored_position`  
7. A7：`set_rect_size_delta` / `set_rect_pivot` / `set_rect_anchors`  
8. A8：`set_canvas_group_alpha` / `set_layout_element` / `set_ui_image_color`  
9. A9：`set_ui_image_raycast_target` / `set_ui_text_content` / `set_ui_text_color`  
10. A10：`set_ui_text_font_size` / `execute_unity_transaction`

---

### 4. 优先级排序（从当前状态继续）
#### P0（最高）
1. A1~A10 的 MCP 实机正/负例留证补齐（当前主要缺口）。  
2. 对实机失败批次优先定位并修复，禁止跳批。

#### P1
1. 按批次执行 legacy 清理复核：L2 路由、L3 注册、桥接字段读取均为 0。  
2. 逐批更新迁移矩阵状态到“已完成（SSOT-only）”。

#### P2
1. 全局扫尾：删除 Action 迁移后失联的 legacy 文件、测试与注入代码。  
2. 统一做一次关键词零命中审计并归档。

---

### 5. 批次执行步骤（标准流水线）
每个批次统一执行以下 7 步：

1. 冻结边界：只改本批 1~3 个 Action，不跨批混改。  
2. L1 契约核对：`tools.json` required/description/examples 与语义一致。  
3. L2 门禁与分发：仅使用 SSOT validator 与 `dispatchSsotToolForMcp`。  
4. L3 直达执行：`SsotRequestDispatcher` 直达本批 executor，不触发 legacy 队列。  
5. 物理删旧：删除本批 legacy 注册、legacy handler 分支、bridge 字段读写。  
6. 双测门禁：Node 单测 + MCP 实机正/负例。  
7. 文档回填：同步状态、删旧清单与测试留证。

---

### 6. 旧链路“彻底铲除”判定规则
每个已完成批次必须满足以下硬条件：

1. `McpActionRegistryBootstrap` 不再注册该批 Action。  
2. 该批 Action 在 L2 不再命中 legacy gateway / legacy write service 分支。  
3. 该批链路中不再读取或写入 `action_data_json` / `action_data_marshaled`。  
4. 不存在“新链路失败后回退旧链路”的 `if/else`。  
5. 不存在仅为兼容旧链路保留的适配层。

---

### 7. 风险控制与回滚
1. 回滚粒度：仅按批次回滚，不做全局回滚。  
2. 回滚触发：
   - Unity 编译阻断且定位到本批改动；  
   - MCP 实机持续失败且短期无法定位。  
3. 回滚策略：
   - 回退本批提交；  
   - 状态恢复为“迁移中”；  
   - 禁止带病推进下一批。

---

### 8. 当前执行记录（A1~A10，归纳版）
1. A1~A10 已完成“代码迁移 + 旧入口收敛 + 旧 handler 删除”的实现层工作。  
2. 当前主缺口是“按批次 MCP 实机正负例留证”，尚未形成完整验收档案。  
3. 当前主任务是“全局旧链路扫尾 + 闭环留证”，而不是继续扩展新实现。  
4. 达到“已完成（SSOT-only）”仍需同时满足 DoD 的删旧计数与实机双测留证。  

---

## 收敛归纳（2026-03-05）

### 未完成内容总结
1. A1~A10 的 MCP 实机正例与 fail-fast 负例留证未按批次完整归档。  
2. 28 指令与 A1~A10 的统一验收口径（`SSOT-only` 证据模板）尚未完全对齐。  
3. P2 全局扫尾未完成：仍需做未引用旧代码、旧测试、旧注入点的统一清理与复核。  
4. L3 侧“无旧链路参与”的编译与运行态回归证据仍需补齐并归档。  

### L1 旧链路待清除（归纳）
1. `[已完成-2026-03-06]` `tools/list` 中与 SSOT 主产物无关的历史口径与临时 fallback 描述残留。  
2. `[已完成-2026-03-06]` 已废弃动态 schema 发现路径的历史对外叙述与入口语义残留。  
3. `[未完成]` 主文档中历史草案内容仍会干扰当前唯一契约认知。  

### L2 旧链路待清除（归纳）
1. `[已完成-2026-03-06]` `/mcp/heartbeat`、`/mcp/metrics`、`/mcp/stream` 已从 Router 活跃入口移除并并入 `deprecated_http_routes`（统一返回 `410 E_GONE`）。  
2. `[已完成-2026-03-06]` `turnService` 已移除未被 Router 使用的 job/stream 兼容方法：`submitUnityTask/getUnityTaskStatus/cancelUnityTask/heartbeatMcp/getMcpMetrics/registerMcpStreamSubscriber/unregisterMcpStreamSubscriber/refreshMcpJobs/drainMcpQueue`；并继续清除失联旧入口：`startSession/sendTurn/getTurnStatus/cancelTurn/applyFileActions/reportUnityConsoleSnapshot/reportUnityQueryComponentsResult/submitUnityQueryAndWait`。  
3. `[已完成-2026-03-06]` `turnServiceMethod + validate` 单入口约束已落地：`commandRegistry` 在构造期强制拒绝 `execute/handler` 历史字段，并由 `ssot-command-dispatch-contract.test.js` 持续守护。  
4. `[已完成-2026-03-06]` `legacyCommandManifest` 已重命名为 `commandDefinitionManifest`，旧命名残留完成清理。  
5. `[已完成-2026-03-06]` 旧 `mcpGateway` 存量回调链路已完成物理清除：`/unity/compile/result`、`/unity/action/result` 已统一并入 `deprecated_http_routes`（`410 E_GONE`）；`turnService` 已移除 `reportCompileResult/reportUnityActionResult` 与失联快照兼容方法；`mcpGateway` 已移除 `handleUnityCompileResult/handleUnityActionResult/handleUnityRuntimePing/touchLeaseByJobId/touchLeaseByThreadId`，并删除失联模块 `mcpGateway/unityCallbacks.js`、`mcpGateway/leaseFacade.js`。`/unity/runtime/ping` 改为 `turnService` 本地最小应答，仅用于连接活性上报，不再耦合旧 job 恢复链。  
6. `[已完成-2026-03-06]` 旧桥接字段、旧错误口径已完成全局归零复核：`legacy_stringified_action_data/legacy_marshaled_action_data/action_data_json/action_data_marshaled/tool_schema_ref/action_schema_ref` 在 `sidecar/src` 与 `Assets/Editor/Codex` 命中为 0；并新增守护测试 `ssot-legacy-detox-guard.test.js`（含旧符号扫描与旧路由 `410` 拦截）。  
7. `[已完成-2026-03-06]` `issueReadToken` 旧口径测试批次已完成退役：`job-lease-janitor/mcp-command-unknown-action-fail-closed/mcp-write-readiness-and-error-taxonomy/occ-write-guard` 等 legacy job 测试已删除，不再以旧写入口维持兼容断言。  
8. `[已完成-2026-03-06]` `turnService/mcpGateway` 失联旧兼容方法完成物理删除：`buildUnityActionRequestEnvelope*`、`normalizeWriteOutcome`、`resolveApprovalModeByRequestId`、`resolveRequestIdByJobId`、`normalizeUnityCompileResultBody`、`normalizeUnityActionResultBody` 以及 `unityReportNormalizer`、`jobLifecycle`、`mcpStreamHub` 等残块均已移除。  

### L3 旧链路待清除（归纳）
1. `[已完成-2026-03-06]` legacy action registry / handler 体系已物理清除：`Assets/Editor/Codex/Infrastructure/Actions/*`、`UnityVisualActionExecutor`、`IUnityVisualActionExecutor`、`PendingActionCoordinator`、`OperationHistoryStore` 已删除；`ConversationController/CodexChatWindow` 不再保留 pending-action 确认入口。  
2. `[已完成-2026-03-06]` legacy coordinator / validator 辅助链路已退场：`TurnStateCoordinator` 删除 `TryCapturePendingUnityActionRequest` 与 `unity.query.components.result` 兼容分支；`ISidecarGateway/HttpSidecarGateway` 删除 `ReportUnityActionResultAsync`、`ReportUnityComponentsQueryResultAsync` 及对应 normalize 逻辑。  
3. `[已完成-2026-03-06]` 旧协议字段口径已收口：`UnityQueryExecutionContext` 仅接受 `query_payload_json`（移除 `pulledQuery.payload` 回退）；`UnityPulledQuery` 删除 `payload` 字段与 `UnityPulledQueryPayload` DTO；`TurnRuntimeState` 删除 `ActionConfirmPending`，并将 `action_confirm_pending` 统一映射到 `ActionExecuting`。  

### L1 闭环待补充（归纳）
1. `[已完成-2026-03-06]` SSOT 字典、编译产物、`tools/list` 三者一致性留证已补齐：新增 `ssot-l1-closure-evidence.test.js`，对 active 工具集合执行 dictionary/artifacts/tools-list 三端一致性断言，并校验 `tools/list` schema 与 `ssot/artifacts/l2/mcp-tools.generated.json` 同步。  
2. `[已完成-2026-03-06]` deprecated/retired 工具对外口径已统一并可追踪：`instantiate_prefab` 已标记为 `deprecated`（字典+产物），并纳入 `deprecated_mcp_tool_names`；守护测试验证 deprecated 工具不出现在 `tools/list`，且 `tools/call` 直接拒绝（phase6 removed）。  
3. `[已完成-2026-03-06]` 读写工具 examples 覆盖留证已补齐：为 `get_scene_snapshot_for_write` 补充 examples 并重建产物；守护测试强制 active 工具在 `mcp-tools.generated.json` 中必须具备可复用 `examples.request`。  
4. `[已完成-2026-03-06]` `tools/list` 全量 schema token 预算与可用性留证已补齐：守护测试对 `tools/list` 全量 JSON payload 建立预算上限（`<=128KB`）并校验每个工具具备 `name/description/inputSchema`。  
5. `[已完成-2026-03-06]` Sidecar 启动前 SSOT 产物 fail-fast 门禁已落地：新增 `startupArtifactsGuard`，在 `bootstrap` 启动阶段强制校验 `mcp-tools.generated.json` 与 `ajv-schemas.generated.json` 存在、可解析、非空；缺失/损坏立即启动失败。  

### L2 闭环待补充（归纳）
1. `[已完成-2026-03-06]` 所有写工具统一门禁（schema + token + revision）生效范围留证已补齐：新增 `ssot-l2-closure-evidence.test.js`，对全量 write 命令逐一验证 `schema(400/E_SSOT_SCHEMA_INVALID)`、`token(409/E_TOKEN_UNKNOWN)`、`revision(409/E_SCENE_REVISION_DRIFT)` 三段门禁。  
2. `[已完成-2026-03-06]` 所有工具“单路径分发、无 fallback”证据化留证已补齐：同测试对全量 expose 命令在缺失 `turnServiceMethod` 场景下统一断言 `500/E_INTERNAL`（`handler not found for command`），证明无兼容回退链路。  
3. `[已完成-2026-03-06]` 状态码/错误码/观测字段一致性口径留证已补齐：同测试对 `ssot.request` 命令统一断言成功包络（`200 + ok + status=succeeded + query_type=ssot.request + tool_name`）以及 `recordMcpToolInvocation` 观测字段（`command_name/command_kind/command_lifecycle/request_meta`）一致。  

### L3 闭环待补充（归纳）
1. `[已完成-2026-03-06]` Unity C# 编译阻断项已完成收口并通过实机留证：`ConversationController.Helpers` 已补齐 `BuildAssemblyQualifiedName`，`IUnityQueryHandler/SsotRequestQueryHandler` 已统一 `UnityPulledQuery` 类型口径；`Editor.log` 最新编译段为 `*** Tundra build success` 且后续 `error CS* = 0`（见 `docs/L3-Unity编译绿灯留证-2026-03-06.md`）。  
2. `[已完成-2026-03-06]` Sidecar 旧事件字段与旧执行链已物理清除：`unity_action_request`、`unity_query_components_request`、`unity_query_components_result` 命中归零；`application/unityDispatcher/*`、`writeReceiptFormatter.js` 及对应旧测试已删除。  
3. `[已完成-2026-03-06]` `mcpGateway` 存量核心耦合已收口：`turnService` 不再持有 `mcpGateway` 运行态；`application/mcpGateway/*` 与 `application/jobRuntime/*` 残块已清空并从运行路径移除，错误反馈模块已迁移到 `application/errorFeedback/mcpErrorFeedback.js`。  
4. `[已完成-2026-03-06]` 旧口径文案与 fail-fast 已统一：`resources/list|read` 继续硬失败；旧建议文本（如 `resources/list`、`ENABLE_MCP_EYES/ENABLE_MCP_ADAPTER` 指向）已从错误模板清理，Router 对 `/mcp/heartbeat|metrics|stream` 与 `/unity/compile/result|action/result` 统一 `410 E_GONE`。  
5. `[已完成-2026-03-06]` L3 留证三联已闭环：代码扫描（`ssot-legacy-detox-guard.test.js` 守护旧符号 0 命中）、自动化测试（`npm test`/`test:r20:qa` 通过）、实机编译日志（`docs/L3-Unity编译绿灯留证-2026-03-06.md`）三项齐备。  

---

## 历史草案归档状态
历史性 Batch 草案与样例已从主执行正文移除，不再作为当前迁移决策依据。
