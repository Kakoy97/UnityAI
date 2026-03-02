# Codex-Unity MCP 扩展性解耦重构施工蓝图

## 0. 目标与约束

### 0.1 总目标
在不削弱 OCC + 双锚点防线的前提下，将视觉动作链路从“固定动作硬编码”升级为“可扩展、可注册、可动态同步能力”的 SDK 架构。

### 0.2 不可退让约束
1. 所有写入口必须继续强制 `based_on_read_token`。
2. 顶层 `write_anchor(object_id + path)` 必须继续硬校验。
3. 动作级锚点必须继续做结构硬校验（`target_anchor` / `parent_anchor` 的 object_id + path）。
4. LLM 友好错误反馈能力必须保留，并对新增错误码给出明确可恢复建议。

### 0.3 迁移原则
1. 先“放通协议”再“切执行器”再“开动态能力”。
2. 维持旧动作兼容（`add_component/remove_component/replace_component/create_gameobject`）直到新注册中心稳定。
3. 每阶段有明确开关和回滚点。

---

## 1. 阶段一：L2 数据透传与校验解绑 (Gateway Relaxation)

### 1.1 阶段目标
1. Sidecar 接收并转发未知 `action_type`。
2. Sidecar 保留 OCC + 锚点硬校验，放宽动作业务字段枚举。
3. `action_data` 在 L1 -> L2 -> L3 -> L2（result）链路中不丢字段。

### 1.2 核心修改文件
1. `sidecar/src/domain/validators.js`
2. `sidecar/src/application/unityDispatcher/runtimeUtils.js`
3. `sidecar/src/application/mcpGateway/mcpGateway.js`
4. `sidecar/src/mcp/mcpServer.js`
5. `sidecar/src/ports/contracts.js`
6. 测试：
`sidecar/tests/domain/validators.anchor-hardcut.test.js`
`sidecar/tests/domain/validators.unity-action-result.test.js`
`sidecar/tests/application/anchor-write-guard.test.js`

### 1.3 数据结构新约定
动作统一包络改为：

```json
{
  "type": "set_rect_transform",
  "target_anchor": { "object_id": "...", "path": "Scene/..." },
  "parent_anchor": null,
  "action_data": {
    "anchored_position": { "x": 0, "y": 16 },
    "size_delta": { "x": 320, "y": 80 }
  }
}
```

说明：
1. `type` 保留必填字符串。
2. `action_data` 作为开放对象透传（推荐必填，兼容旧动作可缺省）。
3. `target_anchor/parent_anchor` 至少一个存在；存在时必须完整 (`object_id + path`)。
4. 允许同时存在两个锚点（为未来“源-目标”类动作预留）。

### 1.4 关键设计难点与落地方案

#### 难点 A：`validators.js` 放宽 payload，保留硬防线
实施要点：
1. `validateMcpSplitWriteBase` 不动 OCC 和顶层 `write_anchor` 逻辑，仅新增 `action_data` 类型要求（对象或缺省）。
2. `validateMcpApplyVisualActions` 调整为：
   - 不再限制 `type` 枚举；
   - 校验动作是对象、`type` 非空；
   - 校验锚点至少一个存在，且存在即完整；
   - 保留 legacy anchor 字段禁用策略（避免歧义）。
3. 旧内建动作可保留“增强校验分支”（可选），但放在“兼容层”，不得阻断扩展动作。

#### 难点 B：`runtimeUtils.js` 白名单导致字段丢失
当前 `buildVisualActionPayload` 是白名单复制，`action_data` 与未知字段会丢失。
实施要点：
1. 增加 `normalizeVisualActionForRuntime()`，显式保留：
   - `type`
   - `target_anchor` / `parent_anchor`
   - `action_data`（深拷贝）
   - `result_data`（用于回执增强，后续阶段使用）
2. `buildUnityActionRequest` 使用新归一化对象，而不是固定字符串字段数组。
3. 对旧字段（如 `component_assembly_qualified_name`）兼容映射到 `action_data`，避免旧客户端立刻失效。

#### 难点 C：放开 `unity.action.result` 回调类型拦截
当前 `validateUnityActionResult` 按固定动作枚举拦截。
实施要点：
1. 仅要求 `payload.action_type` 为非空字符串。
2. 仅对“已知旧动作”保留历史字段约束，未知动作走通用分支：
   - `success` 必须布尔；
   - `error_code/error_message` 合法；
   - 可选 `result_data` 为对象。
3. 移除“非 create 必须 target ref”这类对未知动作不安全的硬约束。

### 1.5 阶段验收
1. `apply_visual_actions` 能提交未知动作并成功入队。
2. `unity.action.result` 能接受未知 `action_type` 回执。
3. OCC + `write_anchor` + 动作锚点缺失仍被拒绝。
4. 透传链路中 `action_data` 字段值前后完全一致。

### 1.6 阶段卡点
1. `WRITE_ANCHOR_GUARD_CONTRACT.action_anchor_union` 当前是固定动作定义，需要同步升级为“锚点策略可配置”。
2. 旧测试大量依赖固定枚举，需先改断言再改实现，避免误判回归。

---

## 2. 阶段二：L2 & L3 错误反馈体系扩容 (Error Taxonomy Expansion)

### 2.1 阶段目标
1. 避免扩展动作失败都被折叠为 `E_ACTION_EXECUTION_FAILED`。
2. 每类扩展错误有稳定 `error_code + suggestion + recoverable`。

### 2.2 核心修改文件
1. `sidecar/src/application/turnPolicies.js`
2. `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`
3. `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
4. `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`
5. `Assets/Editor/Codex/Application/ConversationController.cs`
6. 测试：
`sidecar/tests/application/anchor-error-feedback.test.js`
`Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs`

### 2.3 新增错误码建议（第一版）
1. `E_ACTION_HANDLER_NOT_FOUND`
说明：注册中心无对应 handler。
suggestion：刷新 capability 清单或改用已注册动作名。

2. `E_ACTION_DESERIALIZE_FAILED`
说明：`action_data` 反序列化失败。
suggestion：按该动作 schema 修正字段类型/必填项后重试。

3. `E_ACTION_PAYLOAD_INVALID`
说明：`action_data` 通过反序列化但语义校验失败。
suggestion：检查数值范围与互斥字段（例如同时给绝对和相对参数）。

4. `E_ACTION_CAPABILITY_MISMATCH`
说明：客户端缓存能力与 Unity 当前能力版本不一致。
suggestion：触发 tools 刷新后重试。

5. `E_ACTION_RESULT_SCHEMA_INVALID`
说明：Unity 回执结构缺字段或类型不合法。
suggestion：检查 handler 回执构造逻辑并重放任务。

### 2.4 关键设计难点与落地方案

#### 难点 A：Sidecar 模板扩容后仍保持一致反馈
实施要点：
1. 在 `turnPolicies.js` 的 `MCP_ERROR_FEEDBACK_TEMPLATES` 注册上述错误码。
2. `mcpErrorFeedback.js` 继续统一执行 sanitize 与固定 suggestion 逻辑。
3. 未知错误码仍保留 fallback，不中断流程。

#### 难点 B：Unity 端安全捕获反序列化与执行错误
实施要点：
1. 将反序列化与 handler 执行分层捕获：
   - `DeserializeException` -> `E_ACTION_DESERIALIZE_FAILED`
   - `ValidationException` -> `E_ACTION_PAYLOAD_INVALID`
   - handler 未注册 -> `E_ACTION_HANDLER_NOT_FOUND`
   - 未分类异常 -> `E_ACTION_EXECUTION_FAILED`
2. 所有错误消息单行化、长度裁剪、去堆栈路径（沿用当前 sanitize 风格）。
3. `HttpSidecarGateway.NormalizeActionErrorCode()` 不再把新增细分码折叠回通用码。

### 2.5 阶段验收
1. 每类扩展错误在状态接口里能看到稳定 `error_code`。
2. LLM 收到的 `suggestion` 与错误语义匹配。
3. 错误聚合指标 `error_feedback_by_code` 可区分新增码。

### 2.6 阶段卡点
1. Unity JsonUtility 报错信息质量有限，可能需要自定义前置字段校验补足可读性。
2. `NormalizeExecutionErrorCode` 现有白名单逻辑会吞码，必须优先改。

---

## 3. 阶段三：L3 显式注册中心 + 类型化 Handler (Registry & Typed Handlers)

### 3.1 阶段目标
1. 去除 `switch-case` 主执行路径。
2. 每个动作通过显式注册接入，不依赖全量反射扫描。
3. 处理器内部保持 DTO 类型安全。

### 3.2 核心修改文件
1. 新增：
`Assets/Editor/Codex/Infrastructure/Actions/IMcpVisualActionHandler.cs`
`Assets/Editor/Codex/Infrastructure/Actions/McpVisualActionContext.cs`
`Assets/Editor/Codex/Infrastructure/Actions/McpVisualActionResult.cs`
`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`
`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs`
2. 改造：
`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`
`Assets/Editor/Codex/Application/ConversationController.cs`
`Assets/Editor/Codex/Ports/IUnityVisualActionExecutor.cs`（可选增补能力查询接口）

### 3.3 接口定义草案

```csharp
public interface IMcpVisualActionHandler
{
    string ActionType { get; }
    McpVisualActionExecutionResult Execute(McpVisualActionContext context);
}

public abstract class McpVisualActionHandler<TActionData> : IMcpVisualActionHandler
    where TActionData : class, new()
{
    public abstract string ActionType { get; }

    public McpVisualActionExecutionResult Execute(McpVisualActionContext context)
    {
        if (!context.TryDeserializeActionData<TActionData>(out var dto, out var error))
        {
            return McpVisualActionExecutionResult.Fail("E_ACTION_DESERIALIZE_FAILED", error);
        }
        return ExecuteTyped(context, dto);
    }

    protected abstract McpVisualActionExecutionResult ExecuteTyped(
        McpVisualActionContext context,
        TActionData data);
}
```

`McpVisualActionContext` 建议包含：
1. `VisualLayerActionItem RawAction`
2. `string ActionDataJson`
3. `GameObject Selected`
4. `IAnchorResolver AnchorResolver`
5. `IActionExecutionUtilities Utilities`（Undo、Dirty、PrefabRecord、SceneDirty）

### 3.4 注册中心草案

```csharp
public sealed class McpActionRegistry
{
    private readonly Dictionary<string, IMcpVisualActionHandler> _handlers =
        new Dictionary<string, IMcpVisualActionHandler>(StringComparer.Ordinal);

    public void Register<THandler>(string actionType)
        where THandler : IMcpVisualActionHandler, new()
    {
        // 检查 actionType 非空、重复注册冲突
        _handlers[actionType] = new THandler();
    }

    public bool TryGet(string actionType, out IMcpVisualActionHandler handler)
    {
        return _handlers.TryGetValue(actionType, out handler);
    }

    public IReadOnlyCollection<McpActionCapability> GetCapabilities()
    {
        // 返回 ActionType + Schema + AnchorPolicy
    }
}
```

显式注册示例（Bootstrap）：
1. `Register<AddComponentHandler>("add_component")`
2. `Register<RemoveComponentHandler>("remove_component")`
3. `Register<ReplaceComponentHandler>("replace_component")`
4. `Register<CreateGameObjectHandler>("create_gameobject")`
5. 项目扩展动作同样在启动阶段调用 Register。

### 3.5 `UnityVisualActionExecutor` 迁移策略
1. 第一步：保留旧逻辑，先引入 registry 与 handler 适配层。
2. 第二步：`Execute()` 改为：
   - 读取 `action.type`
   - registry 查 handler
   - 未命中 -> `E_ACTION_HANDLER_NOT_FOUND`
   - 构建 `McpVisualActionContext`
   - 调用 handler 并归一化错误
3. 第三步：将现有 `ExecuteAdd/Remove/Replace/Create` 拆分成四个 handler。
4. 第四步：删除 switch 分支与重复校验逻辑。

### 3.6 对 `ConversationController` 的同步要求
当前 `IsActionPayloadValid` 仍是固定动作规则。需要改为：
1. 仅做通用最小校验（type + 锚点基本完整性）。
2. 详细语义校验交给具体 handler。
3. 拒绝原因使用细分错误码返回。

### 3.7 阶段验收
1. 旧四动作全部由 handler 驱动并通过现有测试。
2. 新增一个扩展示例动作（如 `set_ui_image_color`）无需改 executor 主逻辑即可接入。
3. 执行器代码不再出现动作类型 switch。

### 3.8 阶段卡点
1. Unity `JsonUtility` 不支持字典和多态，复杂 `action_data` 需要 wrapper DTO 或自定义序列化器。
2. Domain Reload 后 registry 重建顺序要稳定（Bootstrap 时机必须可控）。

---

## 4. 阶段四：L1 动态能力上报与 Schema 同步 (Dynamic Capability Sync)

### 4.1 阶段目标
1. Unity 决定当前可用动作集合。
2. Sidecar 按 Unity 上报能力动态构建 MCP 工具描述。
3. Cursor 在能力变更后可收到工具刷新信号。

### 4.2 核心修改文件
1. Unity 侧：
`Assets/Editor/Codex/Application/ConversationController.cs`
`Assets/Editor/Codex/Domain/SidecarContracts.cs`
`Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`
2. Sidecar 侧：
`sidecar/src/api/router.js`
`sidecar/src/application/turnService.js`
`sidecar/src/application/mcpGateway/mcpGateway.js`
`sidecar/src/mcp/mcpServer.js`
3. 可选新增：
`sidecar/src/application/capabilityStore.js`

### 4.3 能力上报协议建议

建议新增独立接口（优于塞进 runtime ping）：
`POST /unity/capabilities/report`

请求体草案：

```json
{
  "event": "unity.capabilities.report",
  "request_id": "req_cap_...",
  "thread_id": "t_default",
  "timestamp": "2026-02-28T12:00:00.000Z",
  "payload": {
    "capability_version": "sha256:ab12...",
    "actions": [
      {
        "type": "set_ui_image_color",
        "anchor_policy": "target_required",
        "description": "Set Image color on target GameObject",
        "action_data_schema": {
          "type": "object",
          "required": ["r", "g", "b", "a"],
          "properties": {
            "r": { "type": "number" },
            "g": { "type": "number" },
            "b": { "type": "number" },
            "a": { "type": "number" }
          }
        }
      }
    ]
  }
}
```

### 4.4 Sidecar 动态重写策略
1. `capabilityStore` 保存最近一次 Unity 上报与 `capability_version`。
2. `mcpServer.getToolDefinitions()` 读取 capabilityStore，动态构造 `apply_visual_actions` 的：
   - description（列出当前支持动作）
   - actions item schema（按 action type 生成 `oneOf`）
3. 若 capability 未上报，回退到“宽松通用 schema + 安全提示”。

### 4.5 通知 Cursor 刷新工具能力
1. 当 `capability_version` 变化时，MCP Server 发出：
`notifications/tools/list_changed`
2. 下一次 `tools/list` 返回新的动态 schema。
3. 若客户端未实现通知，仍可依赖 `tools/list` 拉取获得最新能力（兼容模式）。

### 4.6 阶段验收
1. Unity 新注册动作后，不改 `mcpServer.js` 静态代码即可在 tools/list 显示。
2. Cursor 收到能力变更后能刷新提示并按新 schema 生成参数。
3. 能力版本不一致时返回 `E_ACTION_CAPABILITY_MISMATCH`，并给出刷新建议。

### 4.7 阶段卡点
1. 部分 MCP 客户端对 `tools/list_changed` 支持不一致，需要保留“拉取兜底”。
2. 动态 schema 过大时会影响 token 与响应体大小，需要做动作数量与 schema 深度上限。

---

## 5. 分阶段执行顺序与门禁

### 5.1 推荐顺序
1. 阶段一：先打通协议透传。
2. 阶段二：再补齐错误分类，避免观测失真。
3. 阶段三：切执行器架构。
4. 阶段四：最后启用动态能力同步。

### 5.2 每阶段出入口门禁
1. 所有现有 OCC/Anchor 回归测试必须保持通过。
2. 新增能力必须带最少 1 组成功 + 1 组失败测试。
3. `error_feedback_by_code` 监控中，新错误码出现后必须有模板建议。

### 5.3 回滚策略
1. 保留 `USE_DYNAMIC_ACTION_REGISTRY` 开关（默认灰度开启）。
2. 保留 `USE_DYNAMIC_CAPABILITY_SYNC` 开关（阶段四单独灰度）。
3. 任一阶段异常可回滚到上一阶段，不影响已通过的 OCC 与锚点硬约束。

---

## 6. 首批落地任务拆分（建议）

### 6.1 Sprint A（阶段一）
1. 改 validators 放宽动作枚举。
2. 改 runtimeUtils 保留 `action_data`。
3. 改 unity.action.result 校验。
4. 更新 domain/application 测试。

### 6.2 Sprint B（阶段二）
1. 扩充错误码模板与建议。
2. Unity 错误码归一化逻辑改造（不吞码）。
3. 新增错误反馈验收用例。

### 6.3 Sprint C（阶段三）
1. 引入 registry + handler 基础设施。
2. 将四个内建动作拆分 handler。
3. executor 主路径切换为 registry 查找。

### 6.4 Sprint D（阶段四）
1. 能力上报接口与 store。
2. `tools/list` 动态 schema 生成。
3. `tools/list_changed` 通知与版本控制。

---

## 7. 最终交付定义 (DoD)
1. 新增一个项目自定义动作，L1/L2/L3 无需三处硬编码同步即可生效。
2. 写链路仍强制 OCC + 双锚点，且拦截测试全部通过。
3. 扩展动作失败能返回可诊断、可恢复的细分错误码。
4. Cursor 能看到 Unity 上报的最新动作能力并刷新工具描述。

---

## 8. 风险修订与强制约束（覆盖性修订）

本节为执行期强制约束，若与前文存在冲突，以本节为准。

### 8.1 修订一：`JsonUtility` 兼容策略强制收口

#### 8.1.1 问题确认
Unity 原生 `JsonUtility` 无法稳定反序列化开放结构（如 `object`、`Dictionary<string, object>`、未知嵌套对象），会导致 `action_data` 为空或失败。

#### 8.1.2 强制协议
1. L2 内部可保留 `action_data` 为 JSON Object。
2. L2 下发 Unity 时必须同时生成 `action_data_json`（String，内容为 `JSON.stringify(action_data)`）。
3. L3 Handler 主路径仅使用 `action_data_json` 做类型化反序列化，不依赖 `JsonUtility` 直接吃开放对象。
4. `action_data` 在 Unity DTO 中仅作为兼容保留字段，不作为执行依据。

#### 8.1.3 阶段改动覆盖
1. 阶段一新增字段契约：`action_data_json: string`（推荐必填）。
2. 阶段三 `IMcpVisualActionHandler` / `McpVisualActionContext` 必须内建 `TryDeserializeActionData<T>(string actionDataJson)` 能力。
3. 若未来引入 Newtonsoft.Json，视为阶段三后续增强，不作为阶段一前置依赖。

### 8.2 修订二：动态 Schema 防 Token 爆炸策略

#### 8.2.1 问题确认
若把全部动作全量 JSON Schema 直接塞入 `tools/list`，会造成 token 膨胀、上下文污染、LLM 注意力劣化。

#### 8.2.2 强制策略
1. `tools/list` 默认返回极简能力：
   - `action_type` 列表
   - 每个动作一句描述
   - 不内嵌完整深层参数 schema
2. 新增按需查询读工具：`get_action_schema(action_type)`。
3. `E_ACTION_PAYLOAD_INVALID` 错误反馈中返回：
   - `schema_id` 或 `action_type`
   - 明确提示“先调用 get_action_schema 再重试”
   - 不在 suggestion 中内嵌完整 schema 正文

#### 8.2.3 阶段改动覆盖
1. 阶段四动态 schema 机制改为“两层分发”：
   - 层 1：`tools/list` 极简索引
   - 层 2：`get_action_schema` 按需详情
2. 为 capabilityStore 增加 schema 索引缓存（按 `action_type` 或 `schema_id`）。

### 8.3 修订三：Sidecar 孤岛启动与连接态治理

#### 8.3.1 问题确认
存在 “Cursor/Sidecar 已启动，但 Unity 未连接” 的空能力窗口；若不治理会出现误调用、超时和错误预期。

#### 8.3.2 强制策略
1. capabilityStore 增加 `unity_connection_state`：
   - `offline`
   - `connecting`
   - `ready`
   - `stale`
2. 在 `unity_connection_state != ready` 时：
   - 写工具执行前 fast-fail（如 `E_UNITY_NOT_CONNECTED`），不进入执行队列。
   - `tools/list` description 显式附加状态警告。
3. 能力上报超时后从 `ready` 自动降级为 `stale`，并触发工具能力提示刷新。

#### 8.3.3 阶段改动覆盖
1. 阶段四不仅做能力上报，还必须做连接态心跳与失效判定。
2. 新增错误码建议：
   - `E_UNITY_NOT_CONNECTED`
   - `E_UNITY_CAPABILITY_STALE`
3. 在 `turnPolicies.js` 注册对应 suggestion，保证 LLM 恢复路径明确。

### 8.4 追加验收门禁（在原门禁基础上新增）
1. 任意扩展动作都能在 L2 -> L3 传输中获得非空 `action_data_json`。
2. `tools/list` 响应体大小和 token 成本在动作数增长时保持线性可控（不携带全量深 schema）。
3. Unity 未连接时，写工具必须在网关层快速失败，不能进入排队执行。
4. `E_ACTION_PAYLOAD_INVALID` 必须引导 LLM 走 `get_action_schema`，而不是给泛化建议。

---

## 9. 重构详细任务拆分与验收标准（执行矩阵）

### 9.1 范围与边界
1. 目标：完成 L2-L3 解耦主改造与 L1 动态能力同步，形成可扩展 SDK 基线。
2. 覆盖范围：L2 校验与调度、L3 契约与执行器、L1 工具描述、连接态治理、错误反馈体系、测试与文档资产。
3. 强制原则：扩展性升级不得削弱 OCC + 双锚点 + 自动清理 + 错误模板四条硬防线。
4. 稳定性约束：未知动作可透传，但非标准锚点、无 token、无 `write_anchor` 必须继续硬拒绝。
5. 交付目标：实现“新增动作无需改 executor 主流程”和“能力清单可动态同步”。
6. 不在本轮处理：大规模新动作业务开发，仅实现 1 个扩展示例动作作为接入证明。

### 9.2 任务拆分（按 R9-L2-xx / R9-L3-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| R9-L2-01 | L2 写校验解耦 | `sidecar/src/domain/validators.js`、`sidecar/src/ports/contracts.js` | 放开 `action.type` 枚举依赖，保留 OCC + 顶层 `write_anchor` + 动作锚点硬校验 | 未知动作可入队；缺 token/缺锚点仍 100% 拒绝 |
| R9-L2-02 | L2 调度透传 | `sidecar/src/application/unityDispatcher/runtimeUtils.js`、`sidecar/src/application/mcpGateway/mcpGateway.js` | 保留并透传 `action_data`；下发 Unity 时强制生成 `action_data_json` | L2->L3 传输中 `action_data_json` 非空且内容与原对象一致 |
| R9-L2-03 | Unity 回调放宽 | `sidecar/src/domain/validators.js`、`sidecar/src/application/mcpGateway/unityCallbacks.js` | 放开 `unity.action.result` 的固定动作枚举拦截，支持未知 `action_type` 回执 | 未知动作失败回执可被正常接收并进入状态机 |
| R9-L2-04 | 兼容分支收口 | `sidecar/src/utils/turnUtils.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/application/preconditionService.js` | 清理多余历史别名自动纠偏，仅保留当前标准结构与必要兼容桥接 | 非标准旧 payload 拒绝路径可预测且错误码明确 |
| R9-L2-05 | 动态工具最小化 | `sidecar/src/mcp/mcpServer.js` | `tools/list` 改为极简能力索引；新增 `get_action_schema(action_type)` 读工具 | 工具描述 token 成本可控，按需拉取 schema 正常可用 |
| R9-L2-06 | 能力与连接态存储 | `sidecar/src/application/capabilityStore.js`（新增）、`sidecar/src/api/router.js`、`sidecar/src/application/turnService.js` | 增加 `unity_connection_state` 与 capability 版本缓存 | 能区分 `offline/connecting/ready/stale`，状态可查询 |
| R9-L2-07 | 写入口快失败治理 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js` | Unity 非 ready 时写入口 fast-fail（`E_UNITY_NOT_CONNECTED`） | Unity 离线时写请求不进队列、不超时阻塞 |
| R9-L2-08 | 错误分类扩容 | `sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 新增扩展错误码模板：`E_ACTION_HANDLER_NOT_FOUND`、`E_ACTION_DESERIALIZE_FAILED`、`E_ACTION_PAYLOAD_INVALID`、`E_ACTION_CAPABILITY_MISMATCH` 等 | 每个新增错误码都有 recoverable 与 suggestion，LLM 可恢复 |
| R9-L2-09 | L2 兼容桥接删除 | `sidecar/src/application/unityDispatcher/runtimeUtils.js`、`sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/domain/validators.js` | 删除旧桥接分支：`task_allocation` fallback、`payload.action.type -> action_type` fallback、`mcpJobsById` 兜底读取等 | 旧结构输入 100% 被拒绝或无效；L2 不再包含旧桥接兜底分支 |
| R9-L3-01 | L3 DTO 契约升级 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 动作契约新增 `action_data_json`、能力上报 DTO（`unity.capabilities.report`） | Unity 端反序列化不丢字段，`JsonUtility` 可稳定接收 |
| R9-L3-02 | Handler 抽象层 | `Assets/Editor/Codex/Infrastructure/Actions/IMcpVisualActionHandler.cs`（新增）、`McpVisualActionContext.cs`（新增）、`McpVisualActionResult.cs`（新增） | 建立类型化 handler 基础接口与 `TryDeserializeActionData<T>()` 标准能力 | 新 handler 可在不改 executor 主逻辑下接入 |
| R9-L3-03 | 显式注册中心 | `Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistry.cs`（新增）、`McpActionRegistryBootstrap.cs`（新增） | 显式 `Register<THandler>(actionType)` 与能力枚举导出 | 重复注册/空类型受控失败，能力列表可稳定导出 |
| R9-L3-04 | 执行器主路径迁移 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Ports/IUnityVisualActionExecutor.cs` | 从 `switch-case` 迁移到 registry 查字典，保留四内建动作为首批 handler | executor 不再依赖动作类型 switch，旧四动作行为不回归 |
| R9-L3-05 | 执行前校验收敛 | `Assets/Editor/Codex/Application/ConversationController.cs` | `IsActionPayloadValid` 降为通用最小校验，详细校验下沉到 handler | 无硬编码动作分支阻断扩展动作 |
| R9-L3-06 | 回执错误码保真 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`、`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 移除细分错误码折叠为 `E_ACTION_EXECUTION_FAILED` 的吞码逻辑 | `E_ACTION_DESERIALIZE_FAILED` 等码可端到端透传 |
| R9-L3-07 | 能力上报发送 | `Assets/Editor/Codex/Application/ConversationController.cs`、`Assets/Editor/Codex/Infrastructure/UnityRuntimeReloadPingBootstrap.cs` | Unity 启动/重载后自动上报 capability + version | Sidecar 能在 Unity 重载后刷新能力缓存 |
| R9-L3-08 | L3 旧实现删除 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Application/ConversationController.cs`、`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | 删除旧 `switch-case` 与 `ExecuteAdd/Remove/Replace/Create` 路径；删除固定动作硬编码校验分支；删除错误码折叠白名单 | L3 仅保留 registry + typed handler 主路径，旧入口不可触发 |
| R9-QA-01 | Sidecar 回归矩阵 | `sidecar/tests/domain/*`、`sidecar/tests/application/*` | 建立“扩展可用 + 硬防线不退让”回归集 | OCC、锚点、fast-fail、错误模板、动态工具用例常态全绿 |
| R9-QA-02 | Unity EditMode 回归 | `Assets/Editor/Codex/Tests/EditMode/*` | 建立 registry、handler、DTO、回执码保真、能力上报用例 | Unity 编译通过且 EditMode 全绿 |
| R9-QA-03 | 收口删除门禁扫描 | `sidecar/tests/*`、`Assets/Editor/Codex/Tests/EditMode/*`、CI 脚本（新增） | 新增“旧分支不存在”守卫：关键关键词扫描 + 旧 payload 反向用例 | CI 能在旧兼容分支回流时立即失败 |
| R9-ASSET-01 | 文档脚本资产收口 | `docs/*.md`、`Assets/Docs/*.md`、`sidecar/scripts/*`、`README*.md` | 清理/归档历史文档与废弃脚本，保留唯一执行入口与索引 | 新成员仅按主索引文档和白名单脚本可完成联调 |
| R9-E2E-01 | 终局验收文档固化 | `Assets/Docs/` 下新增验收文档（建议 `Phase7-Extensibility-Decoupling-Acceptance.md`） | 固化从未知动作提交到动态 schema 拉取的端到端流程 | 满足“可扩展且守卫不退让”的发布门槛 |

### 9.3 总体验收标准
1. 架构解耦生效：新增动作接入只需新增 handler + registry 注册，不需改 executor 主流程。
2. 契约可扩展：未知动作在写入与回执链路可流转，不再被固定枚举拦截。
3. `JsonUtility` 风险可控：Unity 执行主路径依赖 `action_data_json`，不依赖开放对象直反序列化。
4. 强约束不回退：OCC、双锚点、自动清理、错误模板四大硬防线保持强制。
5. 连接态可治理：Unity 未连接时写入口快失败，状态明确，不产生排队超时假象。
6. 动态能力可用且节流：`tools/list` 极简，schema 按需查询，token 成本不随动作数量失控。
7. 错误反馈可恢复：新增错误码有稳定 suggestion，LLM 能根据提示完成下一步修复动作。

### 9.4 发布门槛
1. `R9-L2-09`、`R9-L3-08`、`R9-QA-03`、`R9-ASSET-01`、`R9-E2E-01` 五项全部通过。
2. 关键指标无回退：`error_feedback_by_code` 可区分新增错误码，写入口离线快失败命中率符合预期。
3. 文档、脚本、测试三类资产同步完成且不互相冲突。
4. 满足以上条件后方可标记“扩展性解耦重构基线冻结完成”。

### 9.5 代码与文件收口删除清单（强制执行）

| 删除包ID | 触发条件 | 需删除的代码/文件 | 删除动作 | 验收信号 |
|---|---|---|---|---|
| D-R9-L2-01 | `R9-L2-05~08` 完成并稳定 | `sidecar/src/application/unityDispatcher/runtimeUtils.js` | 删除 `task_allocation` 回退读取；删除旧锚点字段（`target_object_path/target_object_id/object_id/parent_*`）在 runtime 下发路径的兼容映射 | runtime 下发仅包含标准锚点 + `action_data_json`，旧字段不再被读取 |
| D-R9-L2-02 | `R9-L2-09` 开始 | `sidecar/src/application/mcpGateway/mcpGateway.js` | 删除 `normalizeUnityActionResultBody` 中 `payload.action.type -> payload.action_type` 兼容分支；删除 `resolveApprovalModeByRequestId` 中 `mcpJobsById` 兼容兜底循环 | `mcpGateway.js` 不再包含旧桥接注释与兼容分支；仅走统一 jobStore 链路 |
| D-R9-L2-03 | `R9-L2-09` 完成 | `sidecar/src/domain/validators.js` | 删除仅为旧写结构保留的自动纠偏/别名容忍；保留“明确报错+恢复建议”，不保留隐式修正 | 旧 payload 全量硬拒绝，错误码稳定且可预测 |
| D-R9-L3-01 | `R9-L3-04` 完成 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 删除 `switch (actionType)` 与 `ExecuteAdd/ExecuteRemove/ExecuteReplace/ExecuteCreate` 旧路径 | L3 执行仅经 `registry -> typed handler`，文件内不再出现动作分支 switch |
| D-R9-L3-02 | `R9-L3-05` 完成 | `Assets/Editor/Codex/Application/ConversationController.cs` | 删除 `IsActionPayloadValid` 固定动作硬编码分支，保留最小通用校验 | 扩展动作不会被固定分支提前拦截 |
| D-R9-L3-03 | `R9-L3-06` 完成 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | 删除 `NormalizeActionErrorCode` 的错误码折叠白名单 | `E_ACTION_DESERIALIZE_FAILED` 等细分码端到端可见 |
| D-R9-ASSET-01 | `R9-ASSET-01` 完成 | `docs/*.md`、`Assets/Docs/*.md`、`sidecar/scripts/*` | 历史文档迁移到 `Assets/Docs/archive/`；README 与索引仅保留唯一主入口；删除废弃脚本或改为 `archive/` | 新成员只看主索引即可联调，无多版本冲突指引 |

### 9.6 删除门禁与自动化防回流
1. 新增“收口扫描”到 CI（对应 `R9-QA-03`），对以下关键字做 fail-fast 检测：`task_allocation`、`payload.action.type`（回调兼容桥接）、`mcpJobsById` 兼容兜底、`switch (actionType)`（执行器旧分支）。
2. 增加反向回归用例：向新链路输入历史旧 payload，预期必须返回固定错误码（如 `E_SCHEMA_INVALID` / `E_ACTION_SCHEMA_INVALID`），不得自动纠偏成功。
3. 增加文档门禁：PR 合并前校验“主索引文档唯一且版本一致”，避免旧蓝图与新蓝图并行作为权威来源。
