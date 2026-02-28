/**
 * Phase 3 Anchor Hard-Cut 手动测试脚本
 * 
 * 这个脚本可以帮助你在 Cursor 中手动测试 Phase 3 的验收场景。
 * 你可以复制这些请求到 Cursor 的 MCP 工具调用中，或者使用 HTTP 客户端测试。
 * 
 * 使用前请确保：
 * 1. Sidecar 服务正在运行
 * 2. Unity 编辑器已连接
 * 3. 你已经获取了一个有效的 read_token
 */

// ============================================
// 前置条件：获取 read_token
// ============================================
// 首先，你需要调用读工具获取 read_token，例如：
// - get_scene_roots()
// - get_current_selection()
// 
// 从响应中提取 read_token，然后替换下面所有示例中的 "YOUR_READ_TOKEN_HERE"

const READ_TOKEN = "YOUR_READ_TOKEN_HERE"; // 替换为实际的 token
const SIDECAR_URL = "http://127.0.0.1:46321";

// ============================================
// 场景 P3-E2E-01-A: Mutation 缺少 target_anchor
// ============================================
const testA_MutationMissingTargetAnchor = {
  endpoint: `${SIDECAR_URL}/mcp/apply_visual_actions`,
  method: "POST",
  body: {
    based_on_read_token: READ_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        // ❌ 缺少 target_anchor
        component_assembly_qualified_name: "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  },
  expected: {
    statusCode: 400,
    error_code: "E_ACTION_SCHEMA_INVALID",
    suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
    shouldHaveJobId: false,
  },
};

// ============================================
// 场景 P3-E2E-01-B: Create 缺少 parent_anchor
// ============================================
const testB_CreateMissingParentAnchor = {
  endpoint: `${SIDECAR_URL}/mcp/apply_visual_actions`,
  method: "POST",
  body: {
    based_on_read_token: READ_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "create_gameobject",
        // ❌ 缺少 parent_anchor
        name: "NewGameObject",
      },
    ],
  },
  expected: {
    statusCode: 400,
    error_code: "E_ACTION_SCHEMA_INVALID",
    suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
    shouldHaveJobId: false,
  },
};

// ============================================
// 场景 P3-E2E-01-C: Union 不匹配
// ============================================
const testC_UnionMismatch = {
  endpoint: `${SIDECAR_URL}/mcp/apply_visual_actions`,
  method: "POST",
  body: {
    based_on_read_token: READ_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "create_gameobject",
        // ❌ create_gameobject 应该用 parent_anchor，而不是 target_anchor
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        name: "NewGameObject",
      },
    ],
  },
  expected: {
    statusCode: 400,
    error_code: "E_ACTION_SCHEMA_INVALID",
    suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
    shouldHaveJobId: false,
  },
};

// ============================================
// 场景 P3-E2E-01-D: Anchor 冲突
// ============================================
// 注意：这个测试需要 object_id 和 path 解析到不同的场景对象
// 你需要根据实际场景调整 object_id 和 path
const testD_AnchorConflict = {
  endpoint: `${SIDECAR_URL}/mcp/apply_visual_actions`,
  method: "POST",
  body: {
    based_on_read_token: READ_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        // ❌ object_id 和 path 解析到不同的对象（冲突）
        target_anchor: {
          object_id: "go_object1", // 这个 object_id 对应一个对象
          path: "Scene/DifferentObject", // 但这个 path 对应另一个对象
        },
        component_assembly_qualified_name: "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  },
  expected: {
    error_code: "E_TARGET_ANCHOR_CONFLICT",
    suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
    shouldHaveJobId: false,
  },
};

// ============================================
// 场景 P3-E2E-01-E: 合法写入
// ============================================
const testE_LegalWrite = {
  endpoint: `${SIDECAR_URL}/mcp/apply_visual_actions`,
  method: "POST",
  body: {
    based_on_read_token: READ_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        // ✅ 正确的 target_anchor，object_id 和 path 匹配
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        component_assembly_qualified_name: "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  },
  expected: {
    statusCode: 200,
    shouldHaveJobId: true,
    shouldHaveError: false,
  },
};

// ============================================
// 使用说明
// ============================================
console.log(`
Phase 3 测试脚本使用说明：

1. 首先获取 read_token：
   - 调用 get_scene_roots() 或 get_current_selection()
   - 从响应中提取 read_token
   - 替换上面 READ_TOKEN 的值

2. 测试场景 A（Mutation 缺少 target_anchor）：
   ${JSON.stringify(testA_MutationMissingTargetAnchor, null, 2)}

3. 测试场景 B（Create 缺少 parent_anchor）：
   ${JSON.stringify(testB_CreateMissingParentAnchor, null, 2)}

4. 测试场景 C（Union 不匹配）：
   ${JSON.stringify(testC_UnionMismatch, null, 2)}

5. 测试场景 D（Anchor 冲突）：
   ${JSON.stringify(testD_AnchorConflict, null, 2)}

6. 测试场景 E（合法写入）：
   ${JSON.stringify(testE_LegalWrite, null, 2)}

在 Cursor 中使用：
- 你可以直接使用 MCP 工具 apply_visual_actions，传入对应的 body
- 或者使用 HTTP 客户端（如 curl、Postman）发送 POST 请求到对应的 endpoint

验证要点：
- 场景 A-D 应该被拒绝，返回相应的错误码和固定建议消息
- 场景 E 应该成功，返回 job_id
- 所有失败场景不应该创建新的 job_id
`);

// 导出测试用例（如果需要在 Node.js 环境中运行）
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    testA_MutationMissingTargetAnchor,
    testB_CreateMissingParentAnchor,
    testC_UnionMismatch,
    testD_AnchorConflict,
    testE_LegalWrite,
  };
}
