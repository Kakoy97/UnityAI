# Phase 3 Anchor Hard-Cut 测试指南

本指南说明如何在 Cursor 中测试 Phase 3 的验收场景。

## 前置条件

1. **启动 Sidecar 服务**
   ```bash
   cd sidecar
   npm start
   # 或
   node src/mcp/mcpServer.js
   ```

2. **确保 Unity 编辑器已连接**
   - Unity 编辑器需要运行并连接到 Sidecar
   - 确保至少有两个场景对象用于 anchor 冲突验证

3. **获取有效的 read_token**
   - 需要先调用读工具（如 `get_scene_roots` 或 `get_current_selection`）获取 `read_token`
   - 这个 token 将用于后续的写操作

## 测试方法

### 方法 1: 使用 Cursor 的 MCP 工具（推荐）

在 Cursor 中，你可以直接使用 MCP 工具进行测试。以下是每个测试场景的步骤：

#### 场景 P3-E2E-01-A: Mutation 缺少 `target_anchor`

**测试步骤：**
1. 先获取一个有效的 `read_token`（通过调用读工具）
2. 调用 `apply_visual_actions`，使用 `add_component` 操作，但**不包含** `target_anchor`

**预期结果：**
- HTTP 400 状态码
- `error_code: "E_ACTION_SCHEMA_INVALID"`
- `suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。"`
- 没有创建新的 `job_id`

#### 场景 P3-E2E-01-B: Create 缺少 `parent_anchor`

**测试步骤：**
1. 先获取一个有效的 `read_token`
2. 调用 `apply_visual_actions`，使用 `create_gameobject` 操作，但**不包含** `parent_anchor`

**预期结果：**
- HTTP 400 状态码
- `error_code: "E_ACTION_SCHEMA_INVALID"`
- `suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。"`
- 没有创建新的 `job_id`

#### 场景 P3-E2E-01-C: Union 不匹配

**测试步骤：**
1. 先获取一个有效的 `read_token`
2. 调用 `apply_visual_actions`，使用 `create_gameobject` 操作，但错误地携带了 `target_anchor`（应该用 `parent_anchor`）

**预期结果：**
- HTTP 400 状态码
- `error_code: "E_ACTION_SCHEMA_INVALID"`
- `suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。"`
- 没有创建新的 `job_id`

#### 场景 P3-E2E-01-D: Anchor 冲突

**测试步骤：**
1. 先获取一个有效的 `read_token`
2. 调用 `apply_visual_actions`，使用一个 schema 有效的操作，但 `object_id` 和 `path` 解析到不同的场景对象

**预期结果：**
- `error_code: "E_TARGET_ANCHOR_CONFLICT"`
- `suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。"`
- L3 不执行任何写副作用

#### 场景 P3-E2E-01-E: 合法写入

**测试步骤：**
1. 先获取一个有效的 `read_token`
2. 调用 `apply_visual_actions`，使用 schema 有效的操作，`object_id` 和 `path` 匹配，token 有效

**预期结果：**
- 请求被接受
- 返回 `job_id`
- 作业进入执行链
- 没有 anchor 错误
- 操作可以成功完成

### 方法 2: 使用 HTTP 端点直接测试

你也可以使用 HTTP 客户端（如 curl 或 Postman）直接测试 HTTP 端点：

```bash
# 测试端点
POST http://127.0.0.1:46321/mcp/apply_visual_actions
POST http://127.0.0.1:46321/mcp/apply_script_actions
POST http://127.0.0.1:46321/mcp/submit_unity_task
```

### 方法 3: 运行自动化测试脚本

项目已经包含了自动化测试。运行：

```bash
cd sidecar
npm test -- anchor-write-guard.test.js
npm test -- anchor-error-feedback.test.js
npm test -- protocol-write-consistency.test.js
```

## 在 Cursor 中测试的具体步骤

### 步骤 1: 获取 read_token

首先，你需要获取一个有效的 `read_token`。在 Cursor 中，你可以：

1. 使用 MCP 工具 `get_scene_roots` 或 `get_current_selection`
2. 从响应中提取 `read_token`

### 步骤 2: 测试失败场景（A-D）

对于每个失败场景，构造相应的请求并验证：

- 状态码是否为 400（对于 A-C）或相应的错误码（对于 D）
- `error_code` 是否正确
- `suggestion` 是否完全匹配固定消息
- 是否没有创建新的 `job_id`

### 步骤 3: 测试成功场景（E）

构造一个合法的请求并验证：

- 请求被接受
- 返回了 `job_id`
- 作业可以正常执行

### 步骤 4: 验证 HTTP 和 MCP 路径一致性

对于至少场景 A、D、E：

1. 通过 HTTP 端点发送请求
2. 通过 MCP 工具发送等效请求
3. 验证两者的响应行为一致

## 测试检查清单

- [ ] 场景 A: Mutation 缺少 `target_anchor` - 被拒绝
- [ ] 场景 B: Create 缺少 `parent_anchor` - 被拒绝
- [ ] 场景 C: Union 不匹配 - 被拒绝
- [ ] 场景 D: Anchor 冲突 - 被拒绝
- [ ] 场景 E: 合法写入 - 成功
- [ ] 所有失败场景返回固定 anchor 建议
- [ ] HTTP 和 MCP 路径行为一致
- [ ] 没有绕过路径可以执行单 anchor 或隐式目标写入

## 注意事项

1. **固定建议消息**：所有 anchor schema 或 anchor 冲突失败，响应中的 `suggestion` 必须完全匹配：
   ```
   请先调用读工具获取目标 object_id 与 path，再重试写操作。
   ```

2. **无绕过路径**：确保没有从 HTTP 或 MCP 入口的绕过路径可以执行单 anchor 或隐式目标写入。

3. **Job 创建**：失败场景（A-D）不应该创建或排队任何作业。

4. **一致性**：HTTP 路径和 MCP 路径必须显示一致的行为。
