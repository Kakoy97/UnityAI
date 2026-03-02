# Codex-Unity 具身代理架构重构总蓝图

**文档定位**: Master Blueprint（宪法级约束文档）  
**适用范围**: Codex-Unity L1/L2/L3 全链路重构与后续迭代  
**重构策略**: Strangler Fig Pattern（先增后删、先读后写、外层包裹、逐步替换）

---

## 1. 架构目标与三层职责

### 1.1 总体目标

1. 将 Codex-Unity 升级为可持续演进的具身代理架构，形成稳定的“感知 -> 决策 -> 执行 -> 反馈”闭环。
2. 明确 L1/L2/L3 的职责边界，杜绝跨层耦合与职责漂移。
3. 通过强制 OCC、双锚点、自动僵尸清理等机制，把安全约束从“建议”提升为“硬规则”。
4. 保持开发节奏可控，先在外层完成能力替换，再拆除旧路径。

### 1.2 三层职责边界

#### L1 大脑层（Cursor / MCP Client）

1. 唯一决策者：任务拆解、工具编排、推理与重试策略。
2. 必须遵循“先感知后操作”：任何写操作前必须先获得 `read_token`。
3. 只通过 MCP 与 L2 通信，不允许直连 L3。

#### L2 脊髓/网关层（Node.js Sidecar）

1. 协议与状态中枢：MCP 协议转换、任务排队、并发互斥、状态流推送。
2. 安全执行闸：强制 OCC 校验、双锚点一致性校验、错误清洗、僵尸 Job 自动清理。
3. 异步恢复中枢：维持 `WAITING_FOR_UNITY_REBOOT` 与 `unity.runtime.ping` 恢复链路。

#### L3 物理层（Unity C# Editor）

1. 主线程执行器：执行受控视觉动作，提供高质量读接口。
2. 只负责“事实采样与动作执行”，不承担任务决策与调度策略。
3. `query_prefab_info` 使用安全临时加载作用域并强制 Dispose，防止内存泄漏。

### 1.3 禁止事项（强约束）

1. 禁止 L1 直连 L3。
2. 禁止 L2 绕过 OCC 或双锚点规则放行写操作。
3. 禁止保留“不带 token 的旧写 API”兼容路径（Phase 2 起硬切）。
4. 禁止以人工恢复作为僵尸 Job 默认处理方式（默认必须自动清理）。

---

## 2. 核心数据结构与 JSON Schema

> 说明：以下为实现与测试的单一真相来源（Single Source of Truth）。

### 2.1 通用请求信封

```json
{
  "$id": "codex.unity.schema.envelope",
  "type": "object",
  "required": ["event", "request_id", "thread_id", "timestamp", "payload"],
  "properties": {
    "event": { "type": "string", "minLength": 1 },
    "request_id": { "type": "string", "minLength": 1 },
    "thread_id": { "type": "string", "minLength": 1 },
    "turn_id": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "payload": { "type": "object" }
  },
  "additionalProperties": false
}
```

### 2.2 `read_token` 结构（OCC 核心）

```json
{
  "$id": "codex.unity.schema.read_token",
  "type": "object",
  "required": ["token", "issued_at", "hard_max_age_ms", "revision_vector", "scope"],
  "properties": {
    "token": { "type": "string", "minLength": 24 },
    "issued_at": { "type": "string", "format": "date-time" },
    "hard_max_age_ms": { "type": "integer", "minimum": 1000 },
    "revision_vector": {
      "type": "object",
      "required": ["scene_revision"],
      "properties": {
        "scene_revision": { "type": "string", "minLength": 1 },
        "asset_revision": { "type": "string" },
        "compile_epoch": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "scope": {
      "type": "object",
      "required": ["kind"],
      "properties": {
        "kind": { "type": "string", "enum": ["scene", "asset", "prefab"] },
        "object_id": { "type": "string" },
        "path": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 2.3 L3 灵动之眼读接口（Pull-based）

#### 2.3.1 `list_assets_in_folder`

```json
{
  "$id": "codex.unity.schema.read.list_assets_in_folder.request",
  "type": "object",
  "required": ["folder_path"],
  "properties": {
    "folder_path": { "type": "string", "minLength": 1 },
    "recursive": { "type": "boolean", "default": false },
    "include_meta": { "type": "boolean", "default": false },
    "limit": { "type": "integer", "minimum": 1 }
  },
  "additionalProperties": false
}
```

#### 2.3.2 `get_scene_roots`

```json
{
  "$id": "codex.unity.schema.read.get_scene_roots.request",
  "type": "object",
  "properties": {
    "scene_path": { "type": "string" },
    "include_inactive": { "type": "boolean", "default": true }
  },
  "additionalProperties": false
}
```

#### 2.3.3 `find_objects_by_component`

```json
{
  "$id": "codex.unity.schema.read.find_objects_by_component.request",
  "type": "object",
  "required": ["component_query"],
  "properties": {
    "component_query": { "type": "string", "minLength": 1 },
    "scene_path": { "type": "string" },
    "under_path": { "type": "string" },
    "include_inactive": { "type": "boolean", "default": true },
    "limit": { "type": "integer", "minimum": 1 }
  },
  "additionalProperties": false
}
```

#### 2.3.4 `query_prefab_info`（动态预算）

```json
{
  "$id": "codex.unity.schema.read.query_prefab_info.request",
  "type": "object",
  "required": ["prefab_path", "max_depth"],
  "properties": {
    "prefab_path": { "type": "string", "minLength": 1 },
    "max_depth": { "type": "integer", "minimum": 0 },
    "node_budget": { "type": "integer", "minimum": 1 },
    "char_budget": { "type": "integer", "minimum": 256 },
    "include_components": { "type": "boolean", "default": true },
    "include_missing_scripts": { "type": "boolean", "default": true }
  },
  "additionalProperties": false
}
```

**约束**:

1. `max_depth` 必须由 L1 每次请求显式传入，后端禁止写死默认深度。
2. 后端仅允许配置“上限保护阈值”，禁止在业务逻辑中硬编码替代 L1 预算。

#### 2.3.5 统一读响应骨架

```json
{
  "$id": "codex.unity.schema.read.common.response",
  "type": "object",
  "required": ["ok", "data", "read_token", "captured_at"],
  "properties": {
    "ok": { "type": "boolean", "const": true },
    "data": { "type": "object" },
    "read_token": { "$ref": "codex.unity.schema.read_token" },
    "captured_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 2.4 写接口契约（强制 OCC + 强制双锚点 + 联合类型）

#### 2.4.1 锚点结构

```json
{
  "$id": "codex.unity.schema.write.anchor",
  "type": "object",
  "required": ["object_id", "path"],
  "properties": {
    "object_id": { "type": "string", "minLength": 1 },
    "path": { "type": "string", "minLength": 1 }
  },
  "additionalProperties": false
}
```

#### 2.4.2 `actions[]` 联合类型修正（按 `type` 分支）

```json
{
  "$id": "codex.unity.schema.write.action_item",
  "type": "object",
  "oneOf": [
    {
      "title": "ComponentMutationAction",
      "required": ["type", "target_anchor"],
      "properties": {
        "type": { "type": "string", "enum": ["add_component", "remove_component", "replace_component"] },
        "target_anchor": { "$ref": "codex.unity.schema.write.anchor" },
        "component_name": { "type": "string" },
        "component_assembly_qualified_name": { "type": "string" },
        "source_component_assembly_qualified_name": { "type": "string" }
      },
      "not": { "required": ["parent_anchor"] },
      "additionalProperties": false
    },
    {
      "title": "CreateGameObjectAction",
      "required": ["type", "parent_anchor", "name"],
      "properties": {
        "type": { "type": "string", "const": "create_gameobject" },
        "parent_anchor": { "$ref": "codex.unity.schema.write.anchor" },
        "name": { "type": "string", "minLength": 1 },
        "primitive_type": { "type": "string" },
        "ui_type": { "type": "string" }
      },
      "not": { "required": ["target_anchor"] },
      "additionalProperties": false
    }
  ]
}
```

#### 2.4.3 写请求骨架

```json
{
  "$id": "codex.unity.schema.write.apply_actions.request",
  "type": "object",
  "required": ["thread_id", "idempotency_key", "based_on_read_token", "write_anchor", "actions"],
  "properties": {
    "thread_id": { "type": "string", "minLength": 1 },
    "idempotency_key": { "type": "string", "minLength": 1 },
    "based_on_read_token": { "type": "string", "minLength": 24 },
    "write_anchor": { "$ref": "codex.unity.schema.write.anchor" },
    "approval_mode": { "type": "string", "enum": ["auto", "require_user"], "default": "auto" },
    "actions": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "codex.unity.schema.write.action_item" }
    },
    "preconditions": { "type": "array", "items": { "type": "object" } },
    "dry_run": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

**强制规则**:

1. 不带 `based_on_read_token` 的写请求直接拒绝。
2. 不带双锚点的写请求直接拒绝。
3. 不存在 Soft Check，不保留旧写接口兼容分支。

### 2.5 Job Lease 与自动清理

```json
{
  "$id": "codex.unity.schema.job.lease",
  "type": "object",
  "required": ["owner_client_id", "last_heartbeat_at", "heartbeat_timeout_ms", "max_runtime_ms"],
  "properties": {
    "owner_client_id": { "type": "string", "minLength": 1 },
    "last_heartbeat_at": { "type": "string", "format": "date-time" },
    "heartbeat_timeout_ms": { "type": "integer", "minimum": 1000 },
    "max_runtime_ms": { "type": "integer", "minimum": 1000 },
    "orphaned": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

### 2.6 LLM 友好错误结构

```json
{
  "$id": "codex.unity.schema.error.feedback",
  "type": "object",
  "required": ["error_code", "error_message", "recoverable", "suggestion"],
  "properties": {
    "error_code": { "type": "string", "minLength": 1 },
    "error_message": { "type": "string", "minLength": 1 },
    "recoverable": { "type": "boolean" },
    "suggestion": { "type": "string", "minLength": 1 },
    "next_tools": { "type": "array", "items": { "type": "string" } },
    "context": { "type": "object" }
  },
  "additionalProperties": false
}
```

---

## 3. 五大核心工程防线

### 3.1 防线 A：RAG 按需感知

1. 感知从“被动推送”升级为“主动拉取”。
2. 标准读工具：`list_assets_in_folder`、`get_scene_roots`、`find_objects_by_component`、`query_prefab_info`。
3. `query_prefab_info` 必须在安全加载作用域中执行并强制 Dispose。

### 3.2 防线 B：强制 OCC 乐观锁

1. 所有写操作强制携带 `based_on_read_token`。
2. 入队前统一校验 token 有效性（TTL + revision）。
3. 过期/无效直接 `E_STALE_SNAPSHOT`。
4. suggestion 必须可执行，指导 L1 先读后写。

### 3.3 防线 C：双锚点防误杀

1. 写操作必须同时提供 `object_id + path`。
2. L2 预校验、L3 执行时二次校验。
3. 不一致返回 `E_TARGET_ANCHOR_CONFLICT`。

### 3.4 防线 D：LLM 友好错误反馈

1. L2 统一清洗堆栈，避免原始长堆栈污染 LLM 上下文。
2. 固定输出 `error_code/error_message/suggestion/recoverable`。
3. 关键错误提供可执行下一步。

### 3.5 防线 E：异步安全与自动僵尸清理

1. 保留 `WAITING_FOR_UNITY_REBOOT` 与 `unity.runtime.ping`。
2. 默认启用 heartbeat + TTL 自动取消。
3. 超时后自动释放锁、终结 job、推进队列。

---

## 4. 分阶段执行计划（Strangler Fig 路线图）

| Phase | 目标 | 关键动作 | 强制约束 | 退出标准 |
|---|---|---|---|---|
| Phase 1 | 只读能力闭环 | 构建 L1->L2->L3->L2 读链路，统一读响应 + read_token | 不改写链路行为 | 4 个读工具稳定可用，`query_prefab_info` 支持动态 `max_depth` |
| Phase 2 | 强制 OCC 硬切 | 所有写接口强制 token，入队前 OCC 拦截 | 禁止 Soft Check/旧兼容路径 | 无 token 或过期 token 100% 被拒绝 |
| Phase 3 | 双锚点硬切 | 写动作强制双锚点 + 联合类型校验 | 禁止单锚点回退 | 锚点冲突 100% 被拒绝 |
| Phase 4 | 自动僵尸清理上线 | heartbeat + TTL + reboot timeout 自动清理 | 默认自动，无人工依赖 | 无永久 pending、无锁泄漏 |
| Phase 5 | 错误反馈标准化 | 统一 error 清洗 + suggestion 模板 | 禁止长堆栈透传 LLM | 自愈重试链路稳定 |
| Phase 6 | 绞杀完成 | 清理旧接口和兼容代码，收口文档/测试/监控 | 不允许双实现长期并存 | 仅保留新架构路径 |

---

## 5. Phase 1（只读能力闭环）详细任务拆分与验收标准

### 5.1 范围与边界

1. 仅实现读通道与读契约，不改变写执行行为。
2. 输出统一响应骨架：`ok/data/read_token/captured_at`。
3. 为 Phase 2 OCC 提供稳定 token 与 revision 基线。

### 5.2 任务拆分（模块 -> 文件 -> 交付）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P1-L3-01 | L3 读契约定义 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 新增 4 类读请求/响应 DTO + `read_token` DTO | 字段与第 2 章一致，序列化通过 |
| P1-L3-02 | L3 读服务骨架 | `Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs` | 实现 4 个读接口骨架 | 返回结构化 `data` |
| P1-L3-03 | Prefab 安全加载作用域 | `Assets/Editor/Codex/Infrastructure/PrefabReadScope.cs` | 安全加载/卸载 + Dispose 保障 | `dispose_count == open_count` |
| P1-L3-04 | L3 查询网关扩展 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | pull/report 查询 API | Query 往返稳定 |
| P1-L3-05 | L3 调度接线 | `Assets/Editor/Codex/Application/ConversationController.cs` | 查询轮询与执行接线 | 不影响现有 compile/action 流程 |
| P1-L2-01 | L2 Query Runtime | `sidecar/src/application/queryRuntime/queryStore.js`、`queryCoordinator.js` | Query 生命周期 + timeout + 结果映射 | 可追踪、可超时、可回放 |
| P1-L2-02 | L2 查询路由 | `sidecar/src/api/router.js` | `/unity/query/pull`、`/unity/query/report` | 可被 L3 正确调用 |
| P1-L2-03 | L2 校验器 | `sidecar/src/domain/validators.js` | 4 个读接口参数校验 | 非法请求被拒绝 |
| P1-L2-04 | MCP 读工具暴露 | `sidecar/src/mcp/mcpServer.js` | 注册 4 个读工具 | MCP 可发现并调用 |
| P1-L2-05 | 读服务接入 | `sidecar/src/application/mcpGateway/mcpEyesReadService.js`、`turnService.js` | 接 query runtime 并统一响应 | 包含 `ok/data/read_token/captured_at` |
| P1-L2-06 | token 签发 | `sidecar/src/application/unitySnapshotService.js` | 签发标准 read_token | 含 revision 向量 |
| P1-L2-07 | 观测指标 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`mcpStreamHub.js` | 读链路指标上报 | metrics 可见新增项 |
| P1-QA-01 | Sidecar 单测 | `sidecar/tests/*` | 覆盖校验/调度/token/异常路径 | 关键分支通过 |
| P1-QA-02 | Unity EditMode | `Assets/Editor/Codex/Tests/EditMode/*` | 覆盖 prefab 查询与 Dispose | 异常场景通过 |
| P1-QA-03 | E2E 联调 | `Assets/Docs` 验证记录 + smoke 脚本 | 4 个读工具闭环联调 | 返回字段满足 Schema |

### 5.3 验收标准

1. 4 个读工具稳定返回统一骨架。
2. `query_prefab_info.max_depth` 由 L1 显式传入并生效。
3. Prefab 查询异常时仍可正确 Dispose。
4. 不引发 v3.0 写链路回归。

---

## 6. Phase 2（强制 OCC 硬切）详细任务拆分与验收标准

### 6.1 Phase 2 范围与边界

1. 目标：将写链路从“可选 token”升级为“硬必填 token + 入队前 OCC 拦截”。
2. 覆盖入口：`submit_unity_task`、`apply_script_actions`、`apply_visual_actions`，包括 HTTP 直连与 MCP 调用两条通路。
3. 硬拦截条件：缺 token、短 token、无效 token、过期 token、revision 漂移，全部在 L2 直接拒绝。
4. 固定错误：校验失败统一返回 `E_STALE_SNAPSHOT`，且 `suggestion` 必须精确为 `请先调用读工具获取最新 token。`。
5. 零兼容：不保留旧 API 旁路，不保留 Soft Check，不保留任何“禁用 token 校验”的开关语义。
6. L3 职责：同步 DTO 契约并确保 token 在写请求路径中不丢失，不在 L3 做兜底放行。
7. 不在本 Phase 处理：双锚点全量硬切放在 Phase 3，Phase 2 仅保证 OCC 硬切可独立生效。

### 6.2 任务拆分（按 P2-L3-xx / P2-L2-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P2-L3-01 | L3 写请求 DTO 契约同步 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 写请求 payload 新增 `based_on_read_token` 字段，类型与反序列化映射正确 | Unity 编译通过；反序列化后字段非空可读 |
| P2-L3-02 | L3 写请求透传一致性 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 保证 token 随请求完整透传到 Sidecar，不被中间层覆盖或丢弃 | 抓包/日志可见 token 随请求到达 L2 |
| P2-L2-01 | Validator 硬拦截 | `sidecar/src/domain/validators.js`、`sidecar/src/mcp/mcpServer.js` | 三个写工具 schema 强制 `based_on_read_token` required，校验长度至少 24 | 缺 token 或短 token 100% 在校验层拒绝 |
| P2-L2-02 | OCC 核心校验服务 | `sidecar/src/application/unitySnapshotService.js`（或 `occTokenGuard.js`） | 实现统一 OCC 校验：token 解析、TTL 校验、`scene_revision` 一致性校验 | 任一失败均返回 `E_STALE_SNAPSHOT` |
| P2-L2-03 | 入队前统一接线 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/turnService.js` | 在创建 job 与入队之前强制调用 OCC 校验 | OCC 失败请求不得进入队列，不得触发 Unity |
| P2-L2-04 | split-write 链路收敛 | `sidecar/src/application/mcpGateway/mcpEyesWriteService.js` | `apply_script_actions` 与 `apply_visual_actions` 统一走同一 OCC 校验器 | 两条写路径行为一致、错误码一致 |
| P2-L2-05 | 错误反馈标准化 | `sidecar/src/utils/turnUtils.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 标准化 stale 响应结构和 suggestion 文案，避免堆栈透传 | suggestion 文本精确匹配，不含变体 |
| P2-L2-06 | 路由与协议一致性检查 | `sidecar/src/api/router.js`、`sidecar/src/mcp/mcpServer.js` | HTTP 与 MCP 两侧写入口全部接入 Validator + OCC，消除 bypass | 任意入口都无法绕过硬拦截 |
| P2-L2-07 | 软开关清理与启动参数收敛 | `sidecar/src/index.js`、`sidecar/src/adapters/argAdapter.js`、`sidecar/src/ports/contracts.js` | 删除 `ENABLE_STRICT_READ_TOKEN`、`MCP_SUBMIT_REQUIRE_READ_TOKEN` 等语义及分支 | 启动参数中不存在关闭校验的有效路径 |
| P2-QA-01 | Sidecar 单元测试补齐 | `sidecar/tests/domain/*`、`sidecar/tests/application/*` | 覆盖缺 token、短 token、过期 token、revision 漂移、suggestion 精确匹配 | 测试全绿；关键失败路径均被覆盖 |
| P2-QA-02 | Unity EditMode 契约测试 | `Assets/Editor/Codex/Tests/EditMode/*` | 验证 `based_on_read_token` 的 C# DTO 反序列化与字段保真 | 字段不丢失，无序列化回归 |
| P2-E2E-01 | 端到端硬切验收文档 | `Assets/Docs/Phase2-OCC-Acceptance.md` | 固化四条链路：缺 token、短 token、过期 token、有效 token | 前三条必须拒绝且返回固定 suggestion；最后一条可进入执行链路 |

### 6.3 Phase 2 验收标准

1. 协议硬切：三个写工具均要求 `based_on_read_token`，无旧兼容通道。
2. 校验前置：OCC 校验发生在“建 job/入队/通知 Unity”之前。
3. 拒绝完备：缺 token、短 token、过期 token、revision 漂移全部被拒绝，错误码统一为 `E_STALE_SNAPSHOT`。
4. 提示一致：`suggestion` 必须精确等于 `请先调用读工具获取最新 token。`。
5. 零旁路：HTTP 与 MCP 两侧写入口返回行为一致，不存在 bypass。
6. 零软开关：仓库内不存在可关闭 token 校验的运行时参数和分支。
7. L3 契约一致：Unity DTO 可稳定接收 `based_on_read_token`，并保持透传一致。
8. 测试闭环：Sidecar 单测、Unity EditMode 契约测试、Phase2 E2E 验收文档三项齐备且通过后，方可进入 Phase 3。

---

## 7. Phase 3（双锚点硬切）详细任务拆分与验收标准

### 7.1 范围与边界

1. 目标：将写链路从“仅 OCC 硬切”升级为“`based_on_read_token` + 双锚点（`object_id + path`）双重硬切”。
2. 覆盖入口：`submit_unity_task`、`apply_script_actions`、`apply_visual_actions`，包含 HTTP 直连与 MCP 两条通路。
3. 强制规则：所有写请求必须同时满足 Phase 2 的 OCC 校验与 Phase 3 的双锚点校验，任一失败直接拒绝。
4. 联合类型规则：
   1. 组件修改/删除类动作（如 `add_component`、`remove_component`、`replace_component`）必须携带 `target_anchor`。
   2. 创建类动作（`create_gameobject`）必须携带 `parent_anchor`。
   3. 严禁通过兼容分支放行“锚点缺失”或“锚点错位”的旧负载。
5. 二次校验：L2 做入队前校验，L3 执行前做目标对象复核；L3 发现 `object_id` 与 `path` 不一致时返回 `E_TARGET_ANCHOR_CONFLICT`。
6. 错误反馈：锚点相关失败必须返回可执行 suggestion，推荐固定为 `请先调用读工具获取目标 object_id 与 path，再重试写操作。`。
7. 不在本 Phase 处理：僵尸 Job 自动清理、全链路错误模板统一属于 Phase 4/5 重点。

### 7.2 任务拆分（按 P3-L3-xx / P3-L2-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P3-L3-01 | L3 锚点 DTO 契约同步 | `Assets/Editor/Codex/Domain/SidecarContracts.cs` | 写请求与 action DTO 明确 `target_anchor` / `parent_anchor` 模型，支持联合类型反序列化 | Unity 编译通过，锚点字段可稳定读取 |
| P3-L3-02 | L3 锚点解析与定位器 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`（必要时新增 `UnityAnchorResolver.cs`） | 实现 `object_id + path` 解析与定位能力，输出标准冲突结果 | 锚点命中率稳定，冲突可判定 |
| P3-L3-03 | L3 执行前二次校验 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 在真正执行动作前复核双锚点一致性 | 锚点冲突时 100% 拒绝且不执行任何写动作 |
| P3-L3-04 | L3 错误回传标准化 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | 回传 `E_TARGET_ANCHOR_CONFLICT` / `E_ACTION_SCHEMA_INVALID` 的标准化 payload | L2 可稳定识别并映射为统一错误结构 |
| P3-L2-01 | Validator 双锚点硬拦截 | `sidecar/src/domain/validators.js`、`sidecar/src/mcp/mcpServer.js` | 三个写入口强制 `write_anchor.object_id` 与 `write_anchor.path` 同时存在且合法 | 缺任一锚点字段即拒绝 |
| P3-L2-02 | `actions[]` 联合类型硬校验 | `sidecar/src/domain/validators.js` | 实现按 `type` 分支校验：mutation 仅 `target_anchor`；create 仅 `parent_anchor` | 错位锚点/缺锚点请求 100% 拒绝 |
| P3-L2-03 | 入队前双闸接线 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/mcpEyesWriteService.js`、`sidecar/src/application/turnService.js` | 固化“先 OCC 后 Anchor”校验顺序，失败即终止 | 不落库、不排队、不通知 Unity |
| P3-L2-04 | 路由一致性与旁路清理 | `sidecar/src/api/router.js`、`sidecar/src/mcp/mcpServer.js` | 确保 HTTP/MCP 两侧写入口都走同一 Validator + OCC + Anchor 链路 | 任意入口行为一致，无 bypass |
| P3-L2-05 | 锚点错误码与 suggestion 统一 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/utils/turnUtils.js` | 统一 `E_TARGET_ANCHOR_CONFLICT`、`E_ACTION_SCHEMA_INVALID` 的错误格式与 suggestion 文案 | 返回文案可执行、结构稳定 |
| P3-L2-06 | 旧字段兼容清理 | `sidecar/src/ports/contracts.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/application/turnPolicies.js` | 清理单锚点或隐式目标定位的旧字段语义与映射分支 | 仓库中无“单锚点可执行”有效路径 |
| P3-QA-01 | Sidecar 单元测试补齐 | `sidecar/tests/domain/*`、`sidecar/tests/application/*` | 覆盖双锚点缺失、联合类型错位、旁路拦截、错误 suggestion | 关键分支全绿，回归通过 |
| P3-QA-02 | Unity EditMode 锚点测试 | `Assets/Editor/Codex/Tests/EditMode/*` | 覆盖 DTO 反序列化、锚点解析、冲突拒绝、合法命中 | 冲突不执行写入，合法路径可执行 |
| P3-E2E-01 | 端到端硬切验收文档 | `Assets/Docs/Phase3-Anchor-Acceptance.md`（新增） | 固化 5 条链路：mutation 缺 `target_anchor`、create 缺 `parent_anchor`、联合类型错位、锚点冲突、合法写入 | 前四条拒绝，最后一条通过 |

### 7.3 Phase 3 验收标准

1. 三个写入口同时满足：`based_on_read_token`（Phase 2）+ 双锚点（Phase 3）硬约束。
2. `actions[]` 联合类型校验生效：mutation 必须 `target_anchor`，create 必须 `parent_anchor`。
3. 入队前完成 OCC 与双锚点校验，失败请求不得创建 job、不得入队、不得触发 Unity。
4. L3 执行前二次复核生效：`object_id` 与 `path` 冲突时返回 `E_TARGET_ANCHOR_CONFLICT`，且不执行写动作。
5. HTTP 与 MCP 两条通路返回行为一致，不存在旁路放行。
6. 锚点错误反馈结构统一，suggestion 可被 L1 直接执行（先读后写、重定位锚点）。
7. 仓库内不存在“单锚点可执行”的兼容分支或隐藏映射。
8. Sidecar 单测、Unity EditMode、Phase3 E2E 验收文档齐备并通过后，方可进入 Phase 4。

---

## 8. Phase 4（自动僵尸清理上线）详细任务拆分与验收标准

### 8.1 Phase 4 范围与边界

1. 目标：上线 `Heartbeat + TTL + Reboot Timeout` 三重自动清理机制，默认自动取消（Auto-cancel），不依赖人工恢复。
2. 覆盖对象：所有 `pending/queued/running/WAITING_FOR_UNITY_REBOOT` 的非终态 Job。
3. 强制规则：只要出现“客户端断联心跳超时、运行总时长超限、重载挂起超时”任一条件，L2 必须自动终结 Job 并释放锁。
4. 保留机制：继续保留 `WAITING_FOR_UNITY_REBOOT` 挂起与 `unity.runtime.ping` 唤醒链路；仅在超时后强制降级为自动取消。
5. 一致性要求：HTTP 与 MCP 两条入口的 Job 生命周期行为必须一致，取消原因和状态回写一致。
6. 不在本 Phase 处理：全量错误文案模板治理与堆栈清洗策略升级（Phase 5）。
7. 前置依赖：Phase 2（OCC 硬切）与 Phase 3（双锚点硬切）已生效；Phase 4 不得回退其硬约束。

### 8.2 任务拆分（按 P4-L3-xx / P4-L2-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P4-L3-01 | L3 全局恢复心跳固化 | `Assets/Editor/Codex/Application/ConversationController.cs`、`Assets/Editor/Codex/Infrastructure/UnityRuntimeReloadPingBootstrap.cs` | 将恢复 ping 与挂起态探活保持在全局 Editor 生命周期，不依赖窗口焦点 | Chat 窗口关闭或失焦时，`unity.runtime.ping` 仍可触发恢复；无“窗口关闭即停摆” |
| P4-L3-02 | L3 自动取消回执对齐 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 同步解析新的自动取消错误码与状态字段（lease/reboot timeout）并正确解锁本地 Busy 状态 | 收到自动取消后 UI 状态可回收，不残留“假忙碌” |
| P4-L2-01 | Job Lease 数据模型落地 | `sidecar/src/application/jobRuntime/jobStore.js`、`sidecar/src/ports/contracts.js` | 为 Job 增加 `lease` 结构：`owner_client_id/last_heartbeat_at/heartbeat_timeout_ms/max_runtime_ms/orphaned` | 新建 Job 自动带 lease；快照持久化与恢复后字段不丢失 |
| P4-L2-02 | 心跳来源接线 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/mcpStreamHub.js`、`sidecar/src/api/router.js`、`sidecar/src/domain/validators.js` | 统一将 SSE 活跃、状态查询、显式 heartbeat（如新增）接入 lease 心跳更新时间 | 心跳持续时 Job 不被误杀；断联后可进入超时判定 |
| P4-L2-03 | 僵尸清理引擎（Janitor） | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/jobLifecycle.js`、`sidecar/src/application/jobRuntime/jobRecovery.js`（必要时新增 `jobLeaseJanitor.js`） | 实现周期巡检：心跳超时、最大运行时长超时、挂起重载超时三类自动取消 | 任一超时命中后立即终结 Job、释放锁、写入终态 |
| P4-L2-04 | `WAITING_FOR_UNITY_REBOOT` 超时闭环 | `sidecar/src/application/unityDispatcher/unityDispatcher.js`、`sidecar/src/application/mcpGateway/unityCallbacks.js` | 保留 ping 恢复路径，同时加入 `reboot_wait_timeout_ms` 超时兜底自动取消 | 正常 ping 可恢复；超时则转 `cancelled` 且不永久挂起 |
| P4-L2-05 | 自动取消错误码与建议语统一 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/utils/turnUtils.js`、`sidecar/src/application/turnPolicies.js` | 固化 `E_JOB_HEARTBEAT_TIMEOUT`、`E_JOB_MAX_RUNTIME_EXCEEDED`、`E_WAITING_FOR_UNITY_REBOOT_TIMEOUT` 的标准反馈 | 返回结构稳定，suggestion 可执行，且无长堆栈直透 |
| P4-L2-06 | 锁释放与队列推进原子化 | `sidecar/src/application/mcpGateway/jobLifecycle.js`、`sidecar/src/application/jobRuntime/lockManager.js`、`sidecar/src/application/jobRuntime/jobQueue.js` | 自动取消后保证“仅一次释放锁 + 立即尝试 promote 下一个 queued job” | 无锁泄漏；无“队列卡死” |
| P4-L2-07 | 启动参数收敛（强制自动清理） | `sidecar/src/index.js`、`sidecar/src/adapters/argAdapter.js`、`sidecar/src/ports/contracts.js` | 新增超时参数并给出安全默认值；禁止关闭自动清理 | 启动后不存在“禁用自动清理”的有效路径 |
| P4-L2-08 | 指标与可观测性 | `sidecar/src/application/mcpGateway/mcpStreamHub.js`、`sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/api/router.js` | 暴露 `auto_cancel_total`、分类超时计数、锁释放计数、队列推进计数 | `/mcp/metrics` 可观测到清理行为且计数正确增长 |
| P4-QA-01 | Sidecar 自动化测试补齐 | `sidecar/tests/application/*`、`sidecar/tests/domain/*`（必要时新增 `sidecar/tests/jobRuntime/*`） | 覆盖三类超时自动取消、锁释放、队列推进、错误反馈一致性 | 核心分支全绿，超时相关回归可复现可防回归 |
| P4-QA-02 | Unity EditMode 稳定性测试 | `Assets/Editor/Codex/Tests/EditMode/*` | 覆盖全局 ping 恢复、自动取消后本地状态回收、无窗口依赖 | 失焦/重载场景下不出现“永远 Busy” |
| P4-E2E-01 | 端到端验收文档固化 | `Assets/Docs/Phase4-Zombie-Cleanup-Acceptance.md`（新增） | 固化 5 条链路：心跳丢失、最大运行超时、重载挂起超时、持续心跳保活、自动取消后队列推进 | 前三条自动拒绝并终结；后两条按预期通过 |

### 8.3 Phase 4 验收标准

1. 所有非终态 Job 均持有可追踪 lease 信息，且持久化/恢复不丢失。
2. `Heartbeat Timeout`、`Max Runtime Timeout`、`Reboot Wait Timeout` 三类条件任一命中，均自动取消，无需人工干预。
3. 自动取消必须发生在 L2，并确保“不落悬挂锁、不留永久 pending”。
4. 自动取消后队列可继续推进，下一个 `queued` Job 能被拉起执行。
5. `WAITING_FOR_UNITY_REBOOT` 与 `unity.runtime.ping` 恢复链路在超时前可正常工作，超时后可安全降级。
6. HTTP 与 MCP 两条路径对同一 Job 的状态、错误码、suggestion 一致。
7. 启动参数层面不存在关闭自动清理的有效路径（零软开关）。
8. `/mcp/metrics` 能反映清理触发、分类原因、锁释放与队列推进计数。
9. Sidecar 单测、Unity EditMode 测试、Phase 4 E2E 验收文档三项齐备并通过后，方可进入 Phase 5。

---

## 9. Phase 5（错误反馈标准化）详细任务拆分与验收标准

### 9.1 Phase 5 范围与边界

1. 目标：将全链路错误反馈升级为“LLM 可执行、语义稳定、无脏堆栈泄漏”的标准输出体系。
2. 覆盖范围：MCP 同步响应、SSE/流式状态事件、Job 状态查询、Unity 回调（compile/action/query/report）全路径。
3. 强制规则：`error_code/error_message/suggestion/recoverable` 四字段为统一最小集，缺一不可。
4. 清洗规则：禁止将多行原始堆栈、绝对路径、内部实现细节直接透传给 L1；调试细节仅保留在本地日志/指标通道。
5. 模板规则：同一 `error_code` 必须映射为稳定 suggestion；`E_STALE_SNAPSHOT` 的 suggestion 必须精确为 `请先调用读工具获取最新 token。`。
6. 一致性规则：HTTP 与 MCP 两条路径对同一错误输入返回一致的 `error_code`、`error_message`、`suggestion`、`recoverable`。
7. 不在本 Phase 处理：OCC 判定逻辑、双锚点判定逻辑、自动僵尸清理策略本身；仅做错误反馈层标准化，不回退 Phase 2/3/4 硬约束。

### 9.2 任务拆分（按 P5-L3-xx / P5-L2-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P5-L3-01 | L3 错误回执契约收敛 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`、`Assets/Editor/Codex/Ports/ISidecarGateway.cs`、`Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs` | 对齐 Unity -> Sidecar 错误回执字段语义，保证 `error_code/error_message` 稳定且可反序列化；保留必要扩展字段但不影响主契约 | Unity 编译通过；回执字段无空洞/错位 |
| P5-L3-02 | L3 错误消息清洗 | `Assets/Editor/Codex/Infrastructure/UnityConsoleErrorTracker.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 对 Unity 侧错误文本做单行清洗与长度控制，避免原始长堆栈直接进入回执 payload | Sidecar 接收的错误消息不含多行堆栈 |
| P5-L3-03 | L3 错误码规范化映射 | `Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs`、`Assets/Editor/Codex/Infrastructure/UnityRagReadService.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 将常见失败映射到标准错误码（如 `E_TARGET_ANCHOR_CONFLICT`、`E_ACTION_SCHEMA_INVALID`、`E_ACTION_EXECUTION_FAILED`），避免随机字符串错误码 | 同类错误跨场景返回同一 `error_code` |
| P5-L2-01 | L2 错误词典与模板中心化 | `sidecar/src/utils/turnUtils.js`、`sidecar/src/application/turnPolicies.js`、`sidecar/src/application/mcpGateway/mcpErrorFeedback.js` | 建立单一错误映射源（code -> message/suggestion/recoverable），禁止多处分叉定义 | 任一 `error_code` 的 suggestion 只有一个有效来源 |
| P5-L2-02 | 回调入口统一归一化 | `sidecar/src/application/mcpGateway/unityCallbacks.js`、`sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/turnService.js` | Unity compile/action/query 回调在入库前统一走 `withMcpErrorFeedback` 归一化 | 无回调路径绕过错误归一化 |
| P5-L2-03 | 多入口响应一致性接线 | `sidecar/src/api/router.js`、`sidecar/src/mcp/mcpServer.js`、`sidecar/src/application/mcpGateway/mcpStreamHub.js` | 保证 HTTP 返回、MCP tool 返回、stream 事件三路输出字段与语义一致 | 同一失败在三路输出中结构一致 |
| P5-L2-04 | 堆栈与敏感信息过滤器 | `sidecar/src/application/mcpGateway/mcpErrorFeedback.js`、`sidecar/src/utils/turnUtils.js` | 清洗多行堆栈、截断超长错误、去除绝对路径/内部细节；保留可执行错误摘要 | L1 可见错误不含敏感路径与长堆栈 |
| P5-L2-05 | suggestion 强模板硬校验 | `sidecar/src/domain/validators.js`、`sidecar/src/utils/turnUtils.js`、`sidecar/src/application/unitySnapshotService.js` | 关键错误 suggestion 固化（尤其 `E_STALE_SNAPSHOT`），并对关键回执做文案一致性保护 | `E_STALE_SNAPSHOT` suggestion 精确匹配且无乱码 |
| P5-L2-06 | 指标与诊断分流 | `sidecar/src/application/mcpGateway/mcpStreamHub.js`、`sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/api/router.js` | 增加错误归一化指标（如 `error_feedback_normalized_total`、`error_stack_sanitized_total`、按 code 分类计数） | `/mcp/metrics` 可观测错误清洗与分类命中 |
| P5-QA-01 | Sidecar 单元/契约测试 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | 覆盖 suggestion 精确匹配、多行堆栈清洗、三入口一致性、关键错误 recoverable 判定 | 测试全绿，关键断言稳定 |
| P5-QA-02 | Unity EditMode 错误回执测试 | `Assets/Editor/Codex/Tests/EditMode/*` | 覆盖 L3 错误码映射、回执字段完整性、清洗后消息输出 | 无字段丢失，无回执格式回归 |
| P5-E2E-01 | 端到端验收文档固化 | `Assets/Docs/Phase5-Error-Feedback-Acceptance.md`（新增） | 固化 5 条链路：`E_STALE_SNAPSHOT` 固定 suggestion、锚点冲突、Unity 异常堆栈清洗、自动取消错误模板、未知错误兜底 | 关键链路输出结构一致且可执行 |

### 9.3 Phase 5 验收标准

1. 任意错误返回都包含 `error_code/error_message/suggestion/recoverable`，且字段语义稳定。
2. `E_STALE_SNAPSHOT` 的 suggestion 必须精确为 `请先调用读工具获取最新 token。`，无编码乱码、无变体。
3. 同一 `error_code` 在 HTTP/MCP/Stream 三条路径返回一致文案与 recoverable 判定。
4. L1 可见 `error_message` 不包含多行原始堆栈、绝对路径、内部实现噪声。
5. L3 回执错误码映射稳定，不再出现随机或临时错误码污染。
6. `E_TARGET_ANCHOR_CONFLICT`、`E_ACTION_SCHEMA_INVALID`、自动取消类错误均有可执行 suggestion，指导下一步动作明确。
7. 未知错误具备稳定兜底模板，不因异常文本差异导致 suggestion 漂移。
8. `/mcp/metrics` 可追踪错误清洗与模板命中情况，支持回归定位。
9. Sidecar 单测、Unity EditMode 测试、Phase 5 E2E 验收文档三项齐备并通过后，方可进入 Phase 6（绞杀收口）。

---

## 10. Phase 6（绞杀收口与基线冻结）详细任务拆分与验收标准

### 10.1 Phase 6 范围与边界

1. 目标：完成 Strangler Fig 最后一公里，彻底下线旧路径与兼容分支，仅保留 L1-L2-L3 新架构主通路。
2. 覆盖范围：L2 路由/契约/启动参数、L3 DTO/调度入口、文档与脚本资产、测试与监控基线。
3. 强制原则：不允许“双实现长期并存”；凡已被新链路替代的旧接口、旧字段、旧开关必须清理或硬拒绝。
4. 稳定性约束：Phase 2/3/4/5 的硬防线不得被 Phase 6 清理动作削弱（OCC、双锚点、自动清理、错误模板必须保持强制）。
5. 交付目标：形成可发布的“冻结基线”，确保新成员仅按新契约开发，不再依赖历史隐式行为。
6. 不在本 Phase 处理：新增功能扩展（如新写动作类型、新读工具类型），仅做收口与去冗余。

### 10.2 任务拆分（按 P6-L3-xx / P6-L2-xx）

| 任务ID | 模块 | 文件级改动清单 | 交付内容 | 验收标准 |
|---|---|---|---|---|
| P6-L3-01 | L3 旧契约字段清理 | `Assets/Editor/Codex/Domain/SidecarContracts.cs`、`Assets/Editor/Codex/Application/ConversationController.cs` | 清理仅用于旧链路的冗余字段与分支，保留并固化 `based_on_read_token`、`write_anchor`、`action.target_anchor/parent_anchor` 主契约 | Unity 侧不存在“无 token/无锚点也可执行”的隐式路径 |
| P6-L3-02 | L3 调度入口收敛 | `Assets/Editor/Codex/Infrastructure/UnityRagQueryPollingBootstrap.cs`、`Assets/Editor/Codex/Infrastructure/UnityRuntimeReloadPingBootstrap.cs`、`Assets/Editor/Codex/UI/CodexChatWindow.cs` | 轮询与恢复逻辑仅保留全局 bootstrap 驱动；移除 UI 焦点依赖与历史兼容触发入口 | Unity 任意窗口状态下，查询轮询与 runtime ping 行为一致稳定 |
| P6-L3-03 | L3 回执标准冻结 | `Assets/Editor/Codex/Infrastructure/HttpSidecarGateway.cs`、`Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs` | 冻结 Unity -> Sidecar 的成功/失败回执最小字段集，移除旧别名写回与临时错误码透传 | 回执结构稳定，不再出现旧别名字段回流 |
| P6-L2-01 | 路由与协议最终收口 | `sidecar/src/api/router.js`、`sidecar/src/mcp/mcpServer.js`、`sidecar/src/ports/contracts.js` | 明确并冻结可用入口：MCP 写入口、MCP 读入口、Unity 回调入口；对旧入口维持统一硬拒绝或彻底移除 | 仓库内无可绕过新链路的可执行旧入口 |
| P6-L2-02 | 兼容映射分支清理 | `sidecar/src/domain/validators.js`、`sidecar/src/utils/turnUtils.js`、`sidecar/src/application/turnPayloadBuilders.js`、`sidecar/src/application/preconditionService.js` | 清理历史 payload 别名兜底与旧结构自动纠偏逻辑，保留唯一标准 schema | 非标准旧 payload 100% 被拒绝，且错误码明确 |
| P6-L2-03 | 启动参数与运行开关冻结 | `sidecar/src/index.js`、`sidecar/src/adapters/argAdapter.js`、`sidecar/src/ports/contracts.js` | 统一参数面，删除已废弃开关语义；保留仅与新架构运行相关的必要参数 | 不存在“回退旧模式/关闭硬校验”的有效参数 |
| P6-L2-04 | 监控与指标基线冻结 | `sidecar/src/application/mcpGateway/mcpGateway.js`、`sidecar/src/application/mcpGateway/mcpStreamHub.js`、`sidecar/src/api/router.js` | 冻结 `/mcp/metrics` 与 stream 事件关键字段，补齐字段说明与版本注记 | 指标字段稳定，升级不会无提示破坏消费方 |
| P6-L2-05 | 脚本与文档资产收口 | `sidecar/scripts/*`、`sidecar/README.md`、`Assets/Docs/*.md`（蓝图/验收文档索引） | 清理废弃脚本，保留新链路 smoke/验收脚本；建立 Phase 1-6 文档索引与执行顺序 | 新成员仅按收口后的脚本和文档即可完成联调 |
| P6-QA-01 | Sidecar 回归矩阵 | `sidecar/tests/application/*`、`sidecar/tests/domain/*` | 建立“强约束不回退”回归集：OCC、双锚点、自动清理、错误反馈、路由一致性 | 核心守护用例常态化全绿，且失败时可直接定位阶段 |
| P6-QA-02 | Unity EditMode 收口测试 | `Assets/Editor/Codex/Tests/EditMode/*` | 建立 L3 收口用例：契约反序列化、调度入口唯一性、回执字段稳定性 | Unity 编译与 EditMode 测试均通过，无旧路径回归 |
| P6-E2E-01 | 终局验收文档固化 | `Assets/Docs/Phase6-Strangler-Closure-Acceptance.md`（新增） | 固化 Phase 6 终局链路：旧入口拒绝、新入口可用、关键防线不回退、指标可观测 | 满足“仅保留新架构路径”的发布门槛 |

### 10.3 Phase 6 验收标准

1. 架构路径唯一：L1->L2->L3 新主链路为唯一有效路径，旧执行路径不可用或统一硬拒绝。
2. 契约唯一：写请求与回执使用唯一标准 schema，不再接受历史别名结构或隐式纠偏。
3. 强约束不回退：OCC、双锚点、自动僵尸清理、错误反馈模板四大硬防线保持强制生效。
4. 开关清零：仓库内不存在可关闭硬校验、回退旧模式、绕过新链路的运行参数或隐藏分支。
5. 监控稳定：`/mcp/metrics` 与 stream 关键字段稳定可观测，可支撑故障定位与回归分析。
6. 资产收口：文档、脚本、测试与 README 均以新架构为唯一权威来源，无互相冲突说明。
7. 发布门槛：P6-QA-01、P6-QA-02、P6-E2E-01 三项全部通过后，方可标记“总蓝图重构完成”。
