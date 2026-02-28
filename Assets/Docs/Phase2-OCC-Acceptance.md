# Phase 2 OCC 硬切端到端验收说明

## 1. 目的

本文件用于验收 Phase 2 的 OCC 硬切结果，验证写链路在入队前完成强制拦截，并输出固定可执行建议。

固定建议文案（必须逐字匹配）：

`请先调用读工具获取最新 token。`

## 2. 验收前置条件

1. Sidecar 以 `ENABLE_MCP_ADAPTER=true` 启动。
2. Unity Editor 已连接并可提供读工具返回。
3. 使用任一写入口进行验收：
`/mcp/submit_unity_task`、`/mcp/apply_script_actions`、`/mcp/apply_visual_actions`。
4. 先通过读工具拿到一个可用 `read_token`，用于“过期 token”和“有效 token”场景。

## 3. 端到端验收链路

### 3.1 链路 A：缺 token

请求特征：
写请求完全不携带 `based_on_read_token` 字段。

预期结果：
1. 预期被拒绝。
2. 返回 `error_code = E_SCHEMA_INVALID`（参数校验层）或 `E_STALE_SNAPSHOT`（OCC 层）中的拒绝结果，但不得进入排队执行。
3. 若返回 OCC 错误体，`suggestion` 必须为：`请先调用读工具获取最新 token。`
4. 不产生 `job_id`，不落库，不入队，不触发 Unity 执行。

### 3.2 链路 B：短 token（长度 < 24）

请求特征：
`based_on_read_token` 字段存在，但长度不足 24。

预期结果：
1. 预期被拒绝。
2. 返回 `error_code = E_SCHEMA_INVALID`（长度校验失败）或 OCC 拒绝结果；不得进入排队执行。
3. 若走 OCC 拒绝，`suggestion` 必须为：`请先调用读工具获取最新 token。`
4. 不产生 `job_id`，不落库，不入队，不触发 Unity 执行。

### 3.3 链路 C：过期 token

请求特征：
携带历史 token，已超过 `issued_at + hard_max_age_ms`。

预期结果：
1. 预期被拒绝且必须返回 `error_code = E_STALE_SNAPSHOT`。
2. `suggestion` 必须逐字匹配：`请先调用读工具获取最新 token。`
3. 返回状态码为 409。
4. 不产生 `job_id`，不落库，不入队，不触发 Unity 执行。

### 3.4 链路 D：有效 token

请求特征：
携带最新读工具签发 token，未过期，且 `scene_revision` 与当前快照一致。

预期结果：
1. 预期通过 OCC，进入正常写链路（可返回 `accepted/queued`）。
2. 允许生成 `job_id` 并按队列状态推进。
3. 不出现 `E_STALE_SNAPSHOT`。

## 4. 人工验收记录模板

| 链路 | 请求入口 | 结果状态码 | error_code | suggestion | 是否创建 job | 结论 |
|---|---|---:|---|---|---|---|
| A 缺 token | `/mcp/submit_unity_task` |  |  |  | 否 |  |
| B 短 token | `/mcp/apply_script_actions` |  |  |  | 否 |  |
| C 过期 token | `/mcp/apply_visual_actions` |  |  | 必须为固定文案 | 否 |  |
| D 有效 token | 任一写入口 |  |  |  | 是 |  |

## 5. 判定标准

满足以下全部条件即 Phase 2 OCC 硬切验收通过：

1. 三条拒绝链路（A/B/C）全部不能进入排队执行。
2. 过期 token 场景（C）必须返回 `E_STALE_SNAPSHOT` + 固定建议文案。
3. 有效 token 场景（D）可以正常入队执行。
4. 全链路不存在任何关闭 token 校验的开关路径或旁路入口。

