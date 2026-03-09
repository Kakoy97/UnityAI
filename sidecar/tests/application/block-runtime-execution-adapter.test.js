"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateBlockResult,
  BLOCK_TYPE,
} = require("../../src/application/blockRuntime/contracts");
const {
  createExistingRuntimeBridge,
  createExecutionChannelAdapter,
} = require("../../src/application/blockRuntime/execution");

function buildReadBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
    ...overrides,
  };
}

function buildReadSelectionByComponentBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_selection_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.selection.by_component",
    input: {
      component_query: "UnityEngine.RectTransform",
      include_inactive: false,
      limit: 5,
    },
    ...overrides,
  };
}

function buildReadSceneRootsBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_scene_roots_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.scene_roots",
    input: {
      include_inactive: true,
      scene_path: "Assets/Scenes/SampleScene.unity",
    },
    ...overrides,
  };
}

function buildReadComponentsBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_components_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.components",
    input: {},
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Panel",
    },
    ...overrides,
  };
}

function buildReadSerializedPropertyTreeBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_components_serialized_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.components.serialized_property_tree",
    input: {
      component_assembly_qualified_name:
        "UnityEngine.RectTransform, UnityEngine.CoreModule",
      include_value_summary: true,
      depth: 2,
      node_budget: 80,
      char_budget: 2000,
      page_size: 10,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Panel",
    },
    ...overrides,
  };
}

function buildReadAssetsBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_assets_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets",
    input: {
      folder_path: "Assets/Prefabs",
      recursive: true,
      include_meta: false,
      limit: 25,
    },
    ...overrides,
  };
}

function buildReadPrefabInfoBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_assets_prefab_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets.prefab_info",
    input: {
      prefab_path: "Assets/Prefabs/Widget.prefab",
      max_depth: 2,
      include_components: true,
      include_missing_scripts: false,
      node_budget: 80,
      char_budget: 3000,
    },
    ...overrides,
  };
}

function buildWriteBlockSpec(overrides = {}) {
  return {
    block_id: "block_mutate_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteRectLayoutBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_rect_layout_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_rect_layout_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteUiStyleBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_ui_style_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Label",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_ui_style_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteTransformLocalBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_transform_local_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Model",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_transform_local_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteTransformWorldBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_transform_world_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Model",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_transform_world_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteHierarchyBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_hierarchy_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Item",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_hierarchy_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteComponentLifecycleBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_component_lifecycle_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Item",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_component_lifecycle_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteObjectLifecycleBlockSpec(intentKey, input, overrides = {}) {
  return {
    block_id: `block_write_object_lifecycle_${intentKey.replace(/[^a-z0-9]+/gi, "_")}`,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: intentKey,
    input: { ...input },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Item",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_object_lifecycle_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteTransactionBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_transaction_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transaction.execute",
    input: {
      transaction_id: "txn_adapter_f12_001",
      steps: [
        {
          step_id: "step_1",
          tool_name: "set_active",
          payload: {
            target_object_id: "GlobalObjectId_V1-target",
            target_path: "Scene/Canvas/Panel",
            active: true,
          },
        },
      ],
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_transaction_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteSaveSceneBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_save_scene_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_scene",
    input: {
      scene_path: "Assets/Scenes/SampleScene.unity",
      save_as_new: false,
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_save_scene_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteSavePrefabBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_save_prefab_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_prefab",
    input: {
      prefab_path: "Assets/Prefabs/MyButton.prefab",
      save_as_new: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Button",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_save_prefab_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteAsyncSubmitTaskBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_async_submit_task_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.submit_task",
    input: {
      thread_id: "thread_adapter_async_1",
      user_intent: "Execute async workflow",
      file_actions: [],
      approval_mode: "auto",
      context: {
        source: "execution-adapter-test",
      },
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_async_submit_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteAsyncGetTaskStatusBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_async_get_status_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.get_task_status",
    input: {
      job_id: "job_adapter_async_1",
      thread_id: "thread_adapter_async_1",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_async_status_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildWriteAsyncCancelTaskBlockSpec(overrides = {}) {
  return {
    block_id: "block_write_async_cancel_task_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.cancel_task",
    input: {
      job_id: "job_adapter_async_2",
      thread_id: "thread_adapter_async_1",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_async_cancel_123",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildCreateBlockSpec(overrides = {}) {
  return {
    block_id: "block_create_1",
    block_type: BLOCK_TYPE.CREATE,
    intent_key: "create.object",
    input: {
      new_object_name: "ImageContainer",
      object_kind: "ui_panel",
      set_active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-canvas",
      path: "Scene/Canvas",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_456",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildMutateComponentPropertiesBlockSpec(overrides = {}) {
  return {
    block_id: "block_mutate_component_props_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.component_properties",
    input: {
      component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      property_path: "m_Spacing",
      value_kind: "number",
      value_number: 100,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Container",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: {
      idempotency_key: "idp_789",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    fallback_context: {
      specialized_attempted: true,
      serialized_property_tree_checked: true,
      preflight_validate_checked: false,
    },
    ...overrides,
  };
}

test("S2A-T4 ExistingRuntimeBridge normalizes successful runtime response", async () => {
  const bridge = createExistingRuntimeBridge({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              echoed_payload: payload,
              scene_revision: "ssot_rev_1",
              read_token_candidate: "ssot_rt_2",
            },
          },
        };
      },
    },
  });

  const outcome = await bridge.executeMappedToolPlan({
    tool_name: "get_scene_snapshot_for_write",
    payload: { scope_path: "Scene/Canvas" },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.scene_revision, "ssot_rev_1");
  assert.equal(outcome.read_token_candidate, "ssot_rt_2");
  assert.equal(outcome.error, null);
});

test("S2A-T4 ExistingRuntimeBridge normalizes failed runtime response", async () => {
  const bridge = createExistingRuntimeBridge({
    runtimePort: {
      async executeToolPlan() {
        return {
          ok: false,
          status_code: 409,
          tool_name: "set_active",
          body: {
            error_code: "E_SCENE_REVISION_DRIFT",
            message: "scene revision drift",
            suggested_action: "get_scene_snapshot_for_write",
            retry_policy: { can_retry: true },
          },
        };
      },
    },
  });

  const outcome = await bridge.executeMappedToolPlan({
    tool_name: "set_active",
    payload: { active: true },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.error.suggested_action, "get_scene_snapshot_for_write");
  assert.equal(outcome.error.recoverable, true);
});

test("S2A-T4 ExecutionChannelAdapter returns succeeded BlockResult on runtime success", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: true,
          tool_name: "get_scene_snapshot_for_write",
          status_code: 200,
          output_data: {
            scene_revision: "ssot_rev_2",
            read_token_candidate: "ssot_rt_3",
          },
          scene_revision: "ssot_rev_2",
          read_token_candidate: "ssot_rt_3",
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildReadBlockSpec(), {
    channel: "execution",
    shape: "single_step",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.scene_revision, "ssot_rev_2");
  assert.equal(result.read_token_candidate, "ssot_rt_3");
  assert.equal(result.execution_meta.channel, "execution");
  assert.equal(result.execution_meta.shape, "single_step");
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("F1 Read.Selection ExecutionChannelAdapter dispatches read.selection.by_component via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_selection",
              read_token_candidate: "ssot_rt_read_selection",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildReadSelectionByComponentBlockSpec(),
    {}
  );
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "find_objects_by_component");
  assert.equal(calls[0].payload.component_query, "UnityEngine.RectTransform");
  assert.equal(calls[0].payload.limit, 5);
});

test("F2 Read.SceneRoots ExecutionChannelAdapter dispatches read.scene_roots via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_roots",
              read_token_candidate: "ssot_rt_read_roots",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildReadSceneRootsBlockSpec(), {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_roots");
  assert.equal(calls[0].payload.include_inactive, true);
  assert.equal(calls[0].payload.scene_path, "Assets/Scenes/SampleScene.unity");
});

test("F3 Read.Components ExecutionChannelAdapter dispatches read.components via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_components",
              read_token_candidate: "ssot_rt_read_components",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildReadComponentsBlockSpec(), {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_gameobject_components");
  assert.equal(calls[0].payload.target_object_id, "GlobalObjectId_V1-target");
  assert.equal(calls[0].payload.target_path, "Scene/Canvas/Panel");
});

test("F3 Read.Components ExecutionChannelAdapter dispatches read.components.serialized_property_tree via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_components_serialized",
              read_token_candidate: "ssot_rt_read_components_serialized",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildReadSerializedPropertyTreeBlockSpec(),
    {}
  );
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_serialized_property_tree");
  assert.equal(
    calls[0].payload.component_assembly_qualified_name,
    "UnityEngine.RectTransform, UnityEngine.CoreModule"
  );
  assert.equal(calls[0].payload.depth, 2);
  assert.equal(calls[0].payload.node_budget, 80);
});

test("F4 Read.Assets ExecutionChannelAdapter dispatches read.assets via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_assets",
              read_token_candidate: "ssot_rt_read_assets",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildReadAssetsBlockSpec(), {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "list_assets_in_folder");
  assert.equal(calls[0].payload.folder_path, "Assets/Prefabs");
  assert.equal(calls[0].payload.recursive, true);
  assert.equal(calls[0].payload.limit, 25);
});

test("F4 Read.Assets ExecutionChannelAdapter dispatches read.assets.prefab_info via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_read_prefab_info",
              read_token_candidate: "ssot_rt_read_prefab_info",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildReadPrefabInfoBlockSpec(), {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "query_prefab_info");
  assert.equal(calls[0].payload.prefab_path, "Assets/Prefabs/Widget.prefab");
  assert.equal(calls[0].payload.max_depth, 2);
  assert.equal(calls[0].payload.include_components, true);
});

test("F5 Write.RectLayout ExecutionChannelAdapter dispatches write.rect_layout families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_rect_layout",
              read_token_candidate: "ssot_rt_write_rect_layout",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteRectLayoutBlockSpec("write.rect_layout.anchored_position", {
      x: 10,
      y: 20,
    }),
    buildWriteRectLayoutBlockSpec("write.rect_layout.size_delta", {
      x: 160,
      y: 48,
    }),
    buildWriteRectLayoutBlockSpec("write.rect_layout.pivot", {
      x: 0.5,
      y: 0.5,
    }),
    buildWriteRectLayoutBlockSpec("write.rect_layout.anchors", {
      min_x: 0,
      min_y: 0,
      max_x: 1,
      max_y: 1,
    }),
    buildWriteRectLayoutBlockSpec("write.rect_layout.layout_element", {
      min_width: 100,
      min_height: 24,
      preferred_width: 160,
      preferred_height: 40,
      flexible_width: 0,
      flexible_height: 0,
      ignore_layout: false,
    }),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 5);
  assert.equal(calls[0].toolName, "set_rect_anchored_position");
  assert.equal(calls[1].toolName, "set_rect_size_delta");
  assert.equal(calls[2].toolName, "set_rect_pivot");
  assert.equal(calls[3].toolName, "set_rect_anchors");
  assert.equal(calls[4].toolName, "set_layout_element");
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F6 Write.UIStyle ExecutionChannelAdapter dispatches write.ui_style families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_ui_style",
              read_token_candidate: "ssot_rt_write_ui_style",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteUiStyleBlockSpec("write.ui_style.canvas_group_alpha", {
      alpha: 0.6,
    }),
    buildWriteUiStyleBlockSpec("write.ui_style.image_color", {
      r: 1,
      g: 0.2,
      b: 0.2,
      a: 1,
    }),
    buildWriteUiStyleBlockSpec("write.ui_style.image_raycast_target", {
      raycast_target: false,
    }),
    buildWriteUiStyleBlockSpec("write.ui_style.text_content", {
      text: "Play",
    }),
    buildWriteUiStyleBlockSpec("write.ui_style.text_color", {
      r: 1,
      g: 1,
      b: 1,
      a: 1,
    }),
    buildWriteUiStyleBlockSpec("write.ui_style.text_font_size", {
      font_size: 30,
    }),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 6);
  assert.equal(calls[0].toolName, "set_canvas_group_alpha");
  assert.equal(calls[1].toolName, "set_ui_image_color");
  assert.equal(calls[2].toolName, "set_ui_image_raycast_target");
  assert.equal(calls[3].toolName, "set_ui_text_content");
  assert.equal(calls[4].toolName, "set_ui_text_color");
  assert.equal(calls[5].toolName, "set_ui_text_font_size");
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F7 Write.Transform.Local ExecutionChannelAdapter dispatches write.transform.local families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_transform_local",
              read_token_candidate: "ssot_rt_write_transform_local",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteTransformLocalBlockSpec("write.transform.local.position", {
      x: 1,
      y: 2,
      z: 3,
    }),
    buildWriteTransformLocalBlockSpec("write.transform.local.rotation", {
      x: 0,
      y: 90,
      z: 0,
    }),
    buildWriteTransformLocalBlockSpec("write.transform.local.scale", {
      x: 1,
      y: 1,
      z: 1,
    }),
    buildWriteTransformLocalBlockSpec("write.transform.local.reset", {}),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 4);
  assert.equal(calls[0].toolName, "set_local_position");
  assert.equal(calls[1].toolName, "set_local_rotation");
  assert.equal(calls[2].toolName, "set_local_scale");
  assert.equal(calls[3].toolName, "reset_transform");
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F8 Write.Hierarchy ExecutionChannelAdapter dispatches write.hierarchy families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_hierarchy",
              read_token_candidate: "ssot_rt_write_hierarchy",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteHierarchyBlockSpec("write.hierarchy.parent", {
      parent_object_id: "GlobalObjectId_V1-new-parent",
      parent_path: "Scene/Canvas/NewParent",
    }),
    buildWriteHierarchyBlockSpec("write.hierarchy.sibling_index", {
      sibling_index: 3,
    }),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].toolName, "set_parent");
  assert.equal(calls[0].payload.parent_object_id, "GlobalObjectId_V1-new-parent");
  assert.equal(calls[0].payload.parent_path, "Scene/Canvas/NewParent");
  assert.equal(calls[1].toolName, "set_sibling_index");
  assert.equal(calls[1].payload.sibling_index, 3);
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F9 Write.ComponentLifecycle ExecutionChannelAdapter dispatches write.component_lifecycle families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_component_lifecycle",
              read_token_candidate: "ssot_rt_write_component_lifecycle",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteComponentLifecycleBlockSpec(
      "write.component_lifecycle.add_component",
      {
        component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      }
    ),
    buildWriteComponentLifecycleBlockSpec(
      "write.component_lifecycle.remove_component",
      {
        component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      }
    ),
    buildWriteComponentLifecycleBlockSpec(
      "write.component_lifecycle.replace_component",
      {
        source_component_type: "UnityEngine.UI.Text, UnityEngine.UI",
        new_component_type: "TMPro.TextMeshProUGUI, Unity.TextMeshPro",
      }
    ),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 3);
  assert.equal(calls[0].toolName, "add_component");
  assert.equal(
    calls[0].payload.component_type,
    "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI"
  );
  assert.equal(calls[1].toolName, "remove_component");
  assert.equal(
    calls[1].payload.component_type,
    "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI"
  );
  assert.equal(calls[2].toolName, "replace_component");
  assert.equal(
    calls[2].payload.source_component_type,
    "UnityEngine.UI.Text, UnityEngine.UI"
  );
  assert.equal(
    calls[2].payload.new_component_type,
    "TMPro.TextMeshProUGUI, Unity.TextMeshPro"
  );
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F10 Write.ObjectLifecycle ExecutionChannelAdapter dispatches write.object_lifecycle families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_object_lifecycle",
              read_token_candidate: "ssot_rt_write_object_lifecycle",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteObjectLifecycleBlockSpec("write.object_lifecycle.rename_object", {
      new_name: "RenamedItem",
    }),
    buildWriteObjectLifecycleBlockSpec("write.object_lifecycle.delete_object", {}),
    buildWriteObjectLifecycleBlockSpec("write.object_lifecycle.duplicate_object", {
      duplicate_name: "Item_Copy",
    }),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 3);
  assert.equal(calls[0].toolName, "rename_object");
  assert.equal(calls[0].payload.new_name, "RenamedItem");
  assert.equal(calls[1].toolName, "delete_object");
  assert.equal(calls[2].toolName, "duplicate_object");
  assert.equal(calls[2].payload.duplicate_name, "Item_Copy");
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F11 Write.Transform.World ExecutionChannelAdapter dispatches write.transform.world families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_transform_world",
              read_token_candidate: "ssot_rt_write_transform_world",
            },
          },
        };
      },
    },
  });

  const specs = [
    buildWriteTransformWorldBlockSpec("write.transform.world.position", {
      x: 1,
      y: 2,
      z: 3,
    }),
    buildWriteTransformWorldBlockSpec("write.transform.world.rotation", {
      x: 0,
      y: 90,
      z: 0,
    }),
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await adapter.executeBlock(spec, {}));
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].toolName, "set_world_position");
  assert.equal(calls[0].payload.x, 1);
  assert.equal(calls[0].payload.y, 2);
  assert.equal(calls[0].payload.z, 3);
  assert.equal(calls[1].toolName, "set_world_rotation");
  assert.equal(calls[1].payload.x, 0);
  assert.equal(calls[1].payload.y, 90);
  assert.equal(calls[1].payload.z, 0);
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F12 Write.TransactionOrchestration ExecutionChannelAdapter dispatches write.transaction family via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_transaction",
              read_token_candidate: "ssot_rt_write_transaction",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildWriteTransactionBlockSpec(), {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "execute_unity_transaction");
  assert.equal(calls[0].payload.transaction_id, "txn_adapter_f12_001");
  assert.equal(Array.isArray(calls[0].payload.steps), true);
  assert.equal(calls[0].payload.steps.length, 1);
});

test("F13 Write.ScenePersistence ExecutionChannelAdapter dispatches write.scene_persistence families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_scene_persistence",
              read_token_candidate: "ssot_rt_write_scene_persistence",
            },
          },
        };
      },
    },
  });

  const results = [];
  results.push(await adapter.executeBlock(buildWriteSaveSceneBlockSpec(), {}));
  results.push(await adapter.executeBlock(buildWriteSavePrefabBlockSpec(), {}));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].toolName, "save_scene");
  assert.equal(calls[0].payload.scene_path, "Assets/Scenes/SampleScene.unity");
  assert.equal(calls[1].toolName, "save_prefab");
  assert.equal(calls[1].payload.target_object_id, "GlobalObjectId_V1-target");
  assert.equal(calls[1].payload.target_path, "Scene/Canvas/Button");
  assert.equal(calls[1].payload.prefab_path, "Assets/Prefabs/MyButton.prefab");
  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F14 Write.AsyncOps ExecutionChannelAdapter dispatches write.async_ops families via runtime bridge", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_write_async_ops",
              read_token_candidate: "ssot_rt_write_async_ops",
            },
          },
        };
      },
    },
  });

  const results = [];
  results.push(await adapter.executeBlock(buildWriteAsyncSubmitTaskBlockSpec(), {}));
  results.push(await adapter.executeBlock(buildWriteAsyncGetTaskStatusBlockSpec(), {}));
  results.push(await adapter.executeBlock(buildWriteAsyncCancelTaskBlockSpec(), {}));

  assert.equal(calls.length, 3);
  assert.equal(calls[0].toolName, "submit_unity_task");
  assert.equal(calls[0].payload.thread_id, "thread_adapter_async_1");
  assert.equal(calls[0].payload.user_intent, "Execute async workflow");
  assert.equal(calls[0].payload.idempotency_key, "idp_async_submit_123");
  assert.equal(calls[0].payload.based_on_read_token, "ssot_rt_123");
  assert.equal(calls[0].payload.write_anchor.object_id, "GlobalObjectId_V1-canvas");
  assert.equal(calls[0].payload.write_anchor.path, "Scene/Canvas");
  assert.equal(Array.isArray(calls[0].payload.file_actions), true);
  assert.equal(calls[0].payload.approval_mode, "auto");

  assert.equal(calls[1].toolName, "get_unity_task_status");
  assert.equal(calls[1].payload.job_id, "job_adapter_async_1");
  assert.equal(calls[1].payload.thread_id, "thread_adapter_async_1");

  assert.equal(calls[2].toolName, "cancel_unity_task");
  assert.equal(calls[2].payload.job_id, "job_adapter_async_2");
  assert.equal(calls[2].payload.thread_id, "thread_adapter_async_1");

  for (const result of results) {
    assert.equal(result.status, "succeeded");
  }
});

test("F14 Write.AsyncOps ExecutionChannelAdapter fails closed on invalid submit payload before runtime dispatch", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: { ok: true, data: {} },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildWriteAsyncSubmitTaskBlockSpec({
      input: {
        thread_id: "thread_adapter_async_1",
        user_intent: "Execute async workflow",
      },
    }),
    {}
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SCHEMA_INVALID");
  assert.equal(calls.length, 0);
});

test("S2A-T4 ExecutionChannelAdapter returns failed BlockResult when mapper rejects block", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: true,
          tool_name: "noop",
          status_code: 200,
          output_data: {},
          scene_revision: "",
          read_token_candidate: "",
        };
      },
    },
  });
  const invalidWrite = buildWriteBlockSpec({
    based_on_read_token: "",
  });

  const result = await adapter.executeBlock(invalidWrite, {});
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SCHEMA_INVALID");
  assert.equal(result.execution_meta.channel, "execution");
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("S2A-T4 ExecutionChannelAdapter executes VERIFY via local path without runtime dispatch", async () => {
  let dispatchCount = 0;
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan() {
        dispatchCount += 1;
        throw new Error("runtime must not be called for VERIFY local path");
      },
    },
  });
  const verifyBlock = {
    block_id: "block_verify_1",
    block_type: BLOCK_TYPE.VERIFY,
    intent_key: "verify.block",
    input: {},
  };

  const result = await adapter.executeBlock(verifyBlock, {});
  assert.equal(result.status, "succeeded");
  assert.equal(result.output_data.verify_local_executed, true);
  assert.equal(result.output_data.verify_intent_key, "verify.block");
  assert.equal(result.execution_meta.mapping_meta.family_key, "verify.local");
  assert.equal(dispatchCount, 0);
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("S2A-T4 ExecutionChannelAdapter propagates runtime failure as BlockError", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: false,
          tool_name: "set_active",
          status_code: 409,
          output_data: {},
          scene_revision: "",
          read_token_candidate: "",
          error: {
            error_code: "E_SCENE_REVISION_DRIFT",
            error_message: "scene revision drift",
            suggested_action: "get_scene_snapshot_for_write",
            retry_policy: { can_retry: true },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildWriteBlockSpec(), {});
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(result.error.suggested_action, "get_scene_snapshot_for_write");
  assert.equal(result.error.retry_policy.can_retry, true);
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("S2A-T5 ExecutionChannelAdapter full chain keeps mapper->bridge payload stable", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              echoed_tool_name: toolName,
              echoed_payload: payload,
              scene_revision: "ssot_rev_chain",
              read_token_candidate: "ssot_rt_chain",
            },
          },
        };
      },
    },
  });

  const readResult = await adapter.executeBlock(buildReadBlockSpec(), {});
  const createResult = await adapter.executeBlock(buildCreateBlockSpec(), {});
  const mutateResult = await adapter.executeBlock(buildWriteBlockSpec(), {});

  assert.equal(calls.length, 3);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(calls[0].payload.scope_path, "Scene/Canvas");
  assert.equal(calls[1].toolName, "create_object");
  assert.equal(calls[1].payload.new_object_name, "ImageContainer");
  assert.equal(calls[2].toolName, "set_active");
  assert.equal(calls[2].payload.active, true);

  for (const result of [readResult, createResult, mutateResult]) {
    assert.equal(result.status, "succeeded");
    assert.equal(result.execution_meta.mapping_meta.mapper_version, "phase1_stepB_v1");
    assert.equal(result.scene_revision, "ssot_rev_chain");
    assert.equal(result.read_token_candidate, "ssot_rt_chain");
    assert.equal(result.execution_meta.mapping_meta.fallback_attempted, false);
    assert.equal(result.execution_meta.mapping_meta.fallback_used, false);
    const schema = validateBlockResult(result);
    assert.equal(schema.ok, true);
  }
});

test("S2A-T5 ExecutionChannelAdapter mapping unsupported intent fails before runtime call", async () => {
  let runtimeCalled = false;
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        runtimeCalled = true;
        return {
          ok: true,
          tool_name: "noop",
          status_code: 200,
          output_data: {},
          scene_revision: "",
          read_token_candidate: "",
        };
      },
    },
  });

  const unsupportedIntentBlock = buildWriteBlockSpec({
    intent_key: "mutate.unsupported_intent",
  });
  const result = await adapter.executeBlock(unsupportedIntentBlock, {});
  assert.equal(runtimeCalled, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SCHEMA_INVALID");
  assert.equal(result.error.block_error_code, "E_BLOCK_INTENT_KEY_UNSUPPORTED");
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("StepB execution adapter exposes legacy intent source in mapping metadata", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_legacy",
              read_token_candidate: "ssot_rt_legacy",
            },
          },
        };
      },
    },
  });
  const legacyWriteSpec = buildWriteBlockSpec({
    intent_key: "set_active",
  });
  const result = await adapter.executeBlock(legacyWriteSpec, {});
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(
    result.execution_meta.mapping_meta.intent_key_source,
    "legacy_concrete_key"
  );
  assert.equal(result.execution_meta.mapping_meta.raw_intent_key, "set_active");
  assert.equal(result.execution_meta.mapping_meta.family_key, "mutate.set_active");
});

test("S2A-T5 ExecutionChannelAdapter handles invalid runtime bridge outcome fail-closed", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return null;
      },
    },
  });

  const result = await adapter.executeBlock(buildReadBlockSpec(), {});
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SSOT_ROUTE_FAILED");
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("S2A-T5 ExecutionChannelAdapter supports known block types only", () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: true,
          tool_name: "noop",
          status_code: 200,
          output_data: {},
          scene_revision: "",
          read_token_candidate: "",
        };
      },
    },
  });
  assert.equal(adapter.supports({ block_type: BLOCK_TYPE.READ_STATE }), true);
  assert.equal(adapter.supports({ block_type: BLOCK_TYPE.CREATE }), true);
  assert.equal(adapter.supports({ block_type: BLOCK_TYPE.MUTATE }), true);
  assert.equal(adapter.supports({ block_type: BLOCK_TYPE.VERIFY }), true);
  assert.equal(adapter.supports({ block_type: "UNKNOWN_TYPE" }), false);
});

test("StepE fallback uses set_serialized_property when primary specialized tool fails and preconditions are satisfied", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        if (toolName === "set_component_properties") {
          return {
            ok: false,
            status_code: 409,
            tool_name: toolName,
            body: {
              error_code: "E_COMPONENT_WRITE_REJECTED",
              message: "specialized write rejected",
            },
          };
        }
        if (toolName === "preflight_validate_write_payload") {
          return {
            ok: true,
            status_code: 200,
            tool_name: toolName,
            body: {
              ok: true,
              preflight: {
                valid: true,
                tool_name: payload && payload.tool_name,
                blocking_errors: [],
              },
            },
          };
        }
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_fallback_success",
              read_token_candidate: "ssot_rt_fallback_success",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildMutateComponentPropertiesBlockSpec(),
    {}
  );
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].toolName, "set_component_properties");
  assert.equal(calls[1].toolName, "preflight_validate_write_payload");
  assert.equal(calls[1].payload.tool_name, "set_serialized_property");
  assert.equal(calls[2].toolName, "set_serialized_property");
  assert.equal(calls[2].payload.value_kind, "integer");
  assert.equal(calls[2].payload.int_value, 100);
  assert.equal(result.execution_meta.mapping_meta.fallback_attempted, true);
  assert.equal(result.execution_meta.mapping_meta.fallback_used, true);
  assert.equal(
    result.execution_meta.mapping_meta.selected_tool_name,
    "set_serialized_property"
  );
  assert.equal(
    result.execution_meta.mapping_meta.fallback_reason,
    "controlled_generic_property_fallback"
  );
});

test("StepE fallback fails with E_SCHEMA_INVALID when server preflight is invalid", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        if (toolName === "preflight_validate_write_payload") {
          return {
            ok: true,
            status_code: 200,
            tool_name: toolName,
            body: {
              ok: true,
              preflight: {
                valid: false,
                tool_name: "set_serialized_property",
                blocking_errors: [
                  {
                    error_code: "E_SSOT_SCHEMA_INVALID",
                    message: "Request schema invalid at /property_path: is required",
                  },
                ],
              },
            },
          };
        }
        return {
          ok: false,
          status_code: 409,
          tool_name: toolName,
          body: {
            error_code: "E_COMPONENT_WRITE_REJECTED",
            message: "specialized write rejected",
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildMutateComponentPropertiesBlockSpec({
      input: {
        component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
        property_path: "m_Spacing",
        value_kind: "number",
        value_number: 100,
      },
    }),
    {}
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_SCHEMA_INVALID");
  assert.equal(result.error.suggested_action, "preflight_validate_write_payload");
  assert.equal(result.execution_meta.mapping_meta.fallback_attempted, true);
  assert.equal(result.execution_meta.mapping_meta.fallback_used, false);
  assert.equal(result.execution_meta.mapping_meta.fallback_reason, "fallback_preflight_failed");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].toolName, "preflight_validate_write_payload");
});

test("StepE fallback fails with E_BLOCK_FALLBACK_NOT_ALLOWED when family is outside allowlist", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    genericPropertyFallbackPolicyContract: {
      enabled: true,
      allowed_source_capability_families: [],
      source_family_alias_map: {
        "mutate.component_properties": "Write.GenericProperty",
      },
      component_type_whitelist_patterns: [
        "^UnityEngine\\.[A-Za-z0-9_+.]+\\s*,\\s*[A-Za-z0-9_+.]+$",
      ],
      property_path_whitelist_patterns: ["^m_[A-Za-z0-9_.\\[\\]-]+$"],
    },
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: false,
          status_code: 409,
          tool_name: toolName,
          body: {
            error_code: "E_COMPONENT_WRITE_REJECTED",
            message: "specialized write rejected",
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(
    buildMutateComponentPropertiesBlockSpec(),
    {}
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_PRECONDITION_FAILED");
  assert.equal(result.error.block_error_code, "E_BLOCK_FALLBACK_NOT_ALLOWED");
  assert.equal(result.execution_meta.mapping_meta.fallback_attempted, true);
  assert.equal(result.execution_meta.mapping_meta.fallback_used, false);
  assert.equal(calls.length, 1);
});
