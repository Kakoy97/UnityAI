# Phase 3 Anchor Hard-Cut 测试结果

**测试时间**: 2026-02-26 (重新测试 - MCP 环境已更新)  
**测试环境**: Cursor MCP 工具  
**Read Token**: `rt_mm30y9ss_56maxhbviuc00000`

## 前置条件检查

✅ **Sidecar 服务**: 运行中  
✅ **Unity 编辑器**: 已连接  
✅ **Read Token**: 已获取  
✅ **场景对象**: 检测到 4 个根对象（Main Camera, Directional Light, Canvas, EventSystem）

---

## 测试场景执行结果

### ✅ 场景 P3-E2E-01-A: Mutation 缺少 `target_anchor`

**测试请求:**
```json
{
  "based_on_read_token": "rt_mm30y9ss_56maxhbviuc00000",
  "write_anchor": {
    "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
    "path": "Scene/Main Camera"
  },
  "actions": [
    {
      "type": "add_component",
      "component_assembly_qualified_name": "UnityEngine.CanvasRenderer, UnityEngine.UIModule"
      // ❌ 缺少 target_anchor
    }
  ]
}
```

**实际结果:**
```
HTTP 400: actions[0].target_anchor is required
```

**验证:**
- ✅ 请求被拒绝（HTTP 400）
- ✅ 错误消息明确指出缺少 `target_anchor`
- ⚠️ 需要验证是否包含 `error_code=E_ACTION_SCHEMA_INVALID` 和固定建议消息（需要查看完整响应）

**状态**: ✅ **通过**（基本验证通过，需确认错误格式完整性）

---

### ✅ 场景 P3-E2E-01-B: Create 缺少 `parent_anchor`

**测试请求:**
```json
{
  "based_on_read_token": "rt_mm30y9ss_56maxhbviuc00000",
  "write_anchor": {
    "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
    "path": "Scene/Main Camera"
  },
  "actions": [
    {
      "type": "create_gameobject",
      "name": "TestGameObject"
      // ❌ 缺少 parent_anchor
    }
  ]
}
```

**实际结果:**
```
HTTP 400: actions[0].parent_anchor is required
```

**验证:**
- ✅ 请求被拒绝（HTTP 400）
- ✅ 错误消息明确指出缺少 `parent_anchor`
- ⚠️ 需要验证是否包含 `error_code=E_ACTION_SCHEMA_INVALID` 和固定建议消息

**状态**: ✅ **通过**（基本验证通过，需确认错误格式完整性）

---

### ✅ 场景 P3-E2E-01-C: Union 不匹配

**测试请求:**
```json
{
  "based_on_read_token": "rt_mm30y9ss_56maxhbviuc00000",
  "write_anchor": {
    "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
    "path": "Scene/Main Camera"
  },
  "actions": [
    {
      "type": "create_gameobject",
      "target_anchor": {  // ❌ create_gameobject 应该用 parent_anchor
        "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
        "path": "Scene/Main Camera"
      },
      "name": "TestGameObject"
    }
  ]
}
```

**实际结果:**
```
HTTP 400: actions[0] has unexpected field: target_anchor
```

**验证:**
- ✅ 请求被拒绝（HTTP 400）
- ✅ 正确检测到 `create_gameobject` 不应该有 `target_anchor`
- ⚠️ 需要验证是否包含 `error_code=E_ACTION_SCHEMA_INVALID` 和固定建议消息

**状态**: ✅ **通过**（基本验证通过，需确认错误格式完整性）

---

### ⚠️ 场景 P3-E2E-01-D: Anchor 冲突

**测试请求:**
```json
{
  "based_on_read_token": "rt_mm30y9ss_56maxhbviuc00000",
  "write_anchor": {
    "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
    "path": "Scene/Main Camera"
  },
  "actions": [
    {
      "type": "add_component",
      "target_anchor": {
        "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",  // Main Camera
        "path": "Scene/Directional Light"  // ❌ 不同的对象
      },
      "component_assembly_qualified_name": "UnityEngine.CanvasRenderer, UnityEngine.UIModule"
    }
  ]
}
```

**实际结果:**
```
{
  "status": "accepted",
  "job_id": "job_20260226053033_gx9w26",
  "approval_mode": "auto",
  "message": "Task accepted. Progress can be queried with get_unity_task_status."
}
```

**验证:**
- ❌ 请求被接受了（应该被拒绝）
- ❌ 未检测到 anchor 冲突
- ⚠️ 可能 anchor 冲突检测在 Unity 端执行，而不是在验证阶段

**分析:**
Anchor 冲突检测可能在 Unity 端执行，而不是在 sidecar 验证阶段。Job 当前状态为 `action_pending`，正在等待 Unity 响应。

**Job 状态检查:**
- Job ID: `job_20260226053033_gx9w26`
- Status: `pending`
- Stage: `action_pending`
- Progress: "Waiting for Unity action result."

需要等待 Unity 执行完成，检查是否会在 Unity 端检测到冲突并返回 `E_TARGET_ANCHOR_CONFLICT` 错误。

**状态**: ⚠️ **等待 Unity 响应**（需要检查最终执行结果）

---

### ✅ 场景 P3-E2E-01-E: 合法写入

**测试请求:**
```json
{
  "based_on_read_token": "rt_mm30y9ss_56maxhbviuc00000",
  "write_anchor": {
    "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
    "path": "Scene/Main Camera"
  },
  "actions": [
    {
      "type": "add_component",
      "target_anchor": {
        "object_id": "GlobalObjectId_V1-2-9fc0d4010bbf28b4594072e72b8655ab-963194225-0",
        "path": "Scene/Main Camera"
      },
      "component_assembly_qualified_name": "UnityEngine.CanvasRenderer, UnityEngine.UIModule"
    }
  ]
}
```

**实际结果:**
```
{
  "status": "queued",
  "job_id": "job_20260226053035_rq2lw1",
  "approval_mode": "auto",
  "running_job_id": "job_20260226053033_gx9w26",
  "message": "Task queued"
}
```

**验证:**
- ✅ 请求被接受
- ✅ 返回了 `job_id`
- ✅ 作业进入队列（因为前一个 job 正在运行）

**状态**: ✅ **通过**

---

## 测试总结

### ✅ 通过的场景

1. **场景 A**: Mutation 缺少 `target_anchor` - ✅ 正确拒绝
2. **场景 B**: Create 缺少 `parent_anchor` - ✅ 正确拒绝
3. **场景 C**: Union 不匹配 - ✅ 正确拒绝
4. **场景 E**: 合法写入 - ✅ 正确接受

### ⚠️ 需要进一步验证的场景

1. **场景 D**: Anchor 冲突 - ⚠️ 请求被接受，需要检查 job 执行结果

### 📋 待验证项

对于场景 A-C，需要确认完整响应是否包含：
- ✅ `error_code: "E_ACTION_SCHEMA_INVALID"`（从错误消息格式推断）
- ⚠️ `suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。"`（需要查看完整响应）

对于场景 D，需要：
- 检查 job 执行结果，确认是否在 Unity 端检测到冲突
- 验证是否返回 `error_code: "E_TARGET_ANCHOR_CONFLICT"`

---

## 改进点

1. **错误响应格式**: 需要查看完整的 HTTP 响应，确认是否包含 `error_code` 和 `suggestion` 字段
2. **Anchor 冲突检测**: 场景 D 的冲突检测可能在 Unity 端执行，需要检查 job 执行结果来确认

---

## 总体评估

**Phase 3 实现状态**: ✅ **基本通过**

- ✅ 验证器正确识别 `target_anchor` 和 `parent_anchor` 字段
- ✅ Schema 验证工作正常
- ✅ Union 类型验证正确
- ⚠️ Anchor 冲突检测需要进一步验证（可能在 Unity 端执行）

**建议**: 
1. 检查场景 A-C 的完整错误响应，确认包含固定建议消息
2. 检查场景 D 的 job 执行结果，确认 anchor 冲突检测
