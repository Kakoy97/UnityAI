"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  INTENT_KEY_SOURCE,
  mapBlockSpecToToolPlan,
  resolveMappingByIntent,
} = require("../../src/application/blockRuntime/execution");

function buildWriteEnvelope() {
  return {
    idempotency_key: "idp_1",
    write_anchor_object_id: "GlobalObjectId_V1-parent",
    write_anchor_path: "Scene/Canvas",
    execution_mode: "execute",
  };
}

function buildAnchor() {
  return {
    object_id: "GlobalObjectId_V1-target",
    path: "Scene/Canvas/Panel",
  };
}

test("S2A-T1 exposes deterministic intent whitelist", () => {
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.selection.current"],
    "get_current_selection"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.selection.by_component"],
    "find_objects_by_component"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.snapshot_for_write"],
    "get_scene_snapshot_for_write"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.scene_roots"],
    "get_scene_roots"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.components"],
    "get_gameobject_components"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.components.serialized_property_tree"],
    "get_serialized_property_tree"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.assets"],
    "list_assets_in_folder"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]["read.assets.prefab_info"],
    "query_prefab_info"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.CREATE]["create.object"],
    "create_object"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["mutate.set_active"],
    "set_active"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.rect_layout.anchored_position"],
    "set_rect_anchored_position"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.rect_layout.layout_element"],
    "set_layout_element"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.ui_style.image_color"],
    "set_ui_image_color"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.ui_style.text_font_size"],
    "set_ui_text_font_size"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.transform.local.position"],
    "set_local_position"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.transform.local.reset"],
    "reset_transform"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.transform.world.position"],
    "set_world_position"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.transform.world.rotation"],
    "set_world_rotation"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.hierarchy.parent"],
    "set_parent"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.hierarchy.sibling_index"],
    "set_sibling_index"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.component_lifecycle.add_component"],
    "add_component"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE][
      "write.component_lifecycle.remove_component"
    ],
    "remove_component"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE][
      "write.component_lifecycle.replace_component"
    ],
    "replace_component"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.object_lifecycle.rename_object"],
    "rename_object"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.object_lifecycle.delete_object"],
    "delete_object"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE][
      "write.object_lifecycle.duplicate_object"
    ],
    "duplicate_object"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.transaction.execute"],
    "execute_unity_transaction"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.scene_persistence.save_scene"],
    "save_scene"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.scene_persistence.save_prefab"],
    "save_prefab"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.async_ops.submit_task"],
    "submit_unity_task"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.async_ops.get_task_status"],
    "get_unity_task_status"
  );
  assert.equal(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]["write.async_ops.cancel_task"],
    "cancel_unity_task"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE].set_active,
    "mutate.set_active"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_rect_anchored_position,
    "write.rect_layout.anchored_position"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_layout_element,
    "write.rect_layout.layout_element"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_ui_image_color,
    "write.ui_style.image_color"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_ui_text_font_size,
    "write.ui_style.text_font_size"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_local_position,
    "write.transform.local.position"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .reset_transform,
    "write.transform.local.reset"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_world_position,
    "write.transform.world.position"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_world_rotation,
    "write.transform.world.rotation"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_parent,
    "write.hierarchy.parent"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .set_sibling_index,
    "write.hierarchy.sibling_index"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .add_component,
    "write.component_lifecycle.add_component"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .remove_component,
    "write.component_lifecycle.remove_component"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .replace_component,
    "write.component_lifecycle.replace_component"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .rename_object,
    "write.object_lifecycle.rename_object"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .delete_object,
    "write.object_lifecycle.delete_object"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .duplicate_object,
    "write.object_lifecycle.duplicate_object"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .execute_unity_transaction,
    "write.transaction.execute"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .save_scene,
    "write.scene_persistence.save_scene"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .save_prefab,
    "write.scene_persistence.save_prefab"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .submit_unity_task,
    "write.async_ops.submit_task"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .get_unity_task_status,
    "write.async_ops.get_task_status"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE]
      .cancel_unity_task,
    "write.async_ops.cancel_task"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .get_current_selection,
    "read.selection.current"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .get_scene_roots,
    "read.scene_roots"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .get_gameobject_components,
    "read.components"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .get_serialized_property_tree,
    "read.components.serialized_property_tree"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .list_assets_in_folder,
    "read.assets"
  );
  assert.equal(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE]
      .query_prefab_info,
    "read.assets.prefab_info"
  );
});

test("StepB family migration matrix is family-organized and keeps controlled fallback policy", () => {
  const mutateFamilies = FAMILY_TOOL_MIGRATION_MATRIX[BLOCK_TYPE.MUTATE];
  assert.equal(
    mutateFamilies["mutate.component_properties"].primary_tool,
    "set_component_properties"
  );
  assert.equal(
    mutateFamilies["mutate.component_properties"].mapper_id,
    "mutate.component_properties"
  );
  assert.equal(
    mutateFamilies["mutate.component_properties"].fallback.mode,
    "controlled"
  );
  assert.deepEqual(
    mutateFamilies["mutate.component_properties"].fallback.tools,
    ["set_serialized_property"]
  );
  assert.equal(
    mutateFamilies["mutate.ui_layout"].fallback.mode,
    "disabled"
  );
});

test("StepB migration matrix keeps legacy_concrete_key -> family_key -> concrete_tool chain", () => {
  const readLegacyMatrix =
    LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE[BLOCK_TYPE.READ_STATE];
  assert.equal(
    readLegacyMatrix.get_current_selection.family_key,
    "read.selection.current"
  );
  assert.equal(
    readLegacyMatrix.get_current_selection.concrete_tool,
    "get_current_selection"
  );
  assert.equal(
    readLegacyMatrix.find_objects_by_component.family_key,
    "read.selection.by_component"
  );
  assert.equal(
    readLegacyMatrix.find_objects_by_component.concrete_tool,
    "find_objects_by_component"
  );
  assert.equal(readLegacyMatrix.get_scene_roots.family_key, "read.scene_roots");
  assert.equal(readLegacyMatrix.get_scene_roots.concrete_tool, "get_scene_roots");
  assert.equal(
    readLegacyMatrix.get_gameobject_components.family_key,
    "read.components"
  );
  assert.equal(
    readLegacyMatrix.get_gameobject_components.concrete_tool,
    "get_gameobject_components"
  );
  assert.equal(
    readLegacyMatrix.get_serialized_property_tree.family_key,
    "read.components.serialized_property_tree"
  );
  assert.equal(
    readLegacyMatrix.get_serialized_property_tree.concrete_tool,
    "get_serialized_property_tree"
  );
  assert.equal(readLegacyMatrix.list_assets_in_folder.family_key, "read.assets");
  assert.equal(
    readLegacyMatrix.list_assets_in_folder.concrete_tool,
    "list_assets_in_folder"
  );
  assert.equal(
    readLegacyMatrix.query_prefab_info.family_key,
    "read.assets.prefab_info"
  );
  assert.equal(
    readLegacyMatrix.query_prefab_info.concrete_tool,
    "query_prefab_info"
  );

  const mutateLegacyMatrix =
    LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE[BLOCK_TYPE.MUTATE];
  assert.equal(mutateLegacyMatrix.set_active.legacy_concrete_key, "set_active");
  assert.equal(mutateLegacyMatrix.set_active.family_key, "mutate.set_active");
  assert.equal(mutateLegacyMatrix.set_active.concrete_tool, "set_active");
  assert.equal(
    mutateLegacyMatrix.set_component_properties.concrete_tool,
    "set_component_properties"
  );
  assert.equal(
    mutateLegacyMatrix.set_rect_anchored_position.family_key,
    "write.rect_layout.anchored_position"
  );
  assert.equal(
    mutateLegacyMatrix.set_rect_anchored_position.concrete_tool,
    "set_rect_anchored_position"
  );
  assert.equal(
    mutateLegacyMatrix.set_rect_anchors.family_key,
    "write.rect_layout.anchors"
  );
  assert.equal(
    mutateLegacyMatrix.set_layout_element.family_key,
    "write.rect_layout.layout_element"
  );
  assert.equal(
    mutateLegacyMatrix.set_ui_image_color.family_key,
    "write.ui_style.image_color"
  );
  assert.equal(
    mutateLegacyMatrix.set_ui_text_font_size.family_key,
    "write.ui_style.text_font_size"
  );
  assert.equal(
    mutateLegacyMatrix.set_local_position.family_key,
    "write.transform.local.position"
  );
  assert.equal(
    mutateLegacyMatrix.reset_transform.family_key,
    "write.transform.local.reset"
  );
  assert.equal(
    mutateLegacyMatrix.set_world_position.family_key,
    "write.transform.world.position"
  );
  assert.equal(
    mutateLegacyMatrix.set_world_position.concrete_tool,
    "set_world_position"
  );
  assert.equal(
    mutateLegacyMatrix.set_world_rotation.family_key,
    "write.transform.world.rotation"
  );
  assert.equal(
    mutateLegacyMatrix.set_world_rotation.concrete_tool,
    "set_world_rotation"
  );
  assert.equal(mutateLegacyMatrix.set_parent.family_key, "write.hierarchy.parent");
  assert.equal(mutateLegacyMatrix.set_parent.concrete_tool, "set_parent");
  assert.equal(
    mutateLegacyMatrix.set_sibling_index.family_key,
    "write.hierarchy.sibling_index"
  );
  assert.equal(
    mutateLegacyMatrix.set_sibling_index.concrete_tool,
    "set_sibling_index"
  );
  assert.equal(
    mutateLegacyMatrix.add_component.family_key,
    "write.component_lifecycle.add_component"
  );
  assert.equal(mutateLegacyMatrix.add_component.concrete_tool, "add_component");
  assert.equal(
    mutateLegacyMatrix.remove_component.family_key,
    "write.component_lifecycle.remove_component"
  );
  assert.equal(
    mutateLegacyMatrix.remove_component.concrete_tool,
    "remove_component"
  );
  assert.equal(
    mutateLegacyMatrix.replace_component.family_key,
    "write.component_lifecycle.replace_component"
  );
  assert.equal(
    mutateLegacyMatrix.replace_component.concrete_tool,
    "replace_component"
  );
  assert.equal(
    mutateLegacyMatrix.rename_object.family_key,
    "write.object_lifecycle.rename_object"
  );
  assert.equal(mutateLegacyMatrix.rename_object.concrete_tool, "rename_object");
  assert.equal(
    mutateLegacyMatrix.delete_object.family_key,
    "write.object_lifecycle.delete_object"
  );
  assert.equal(mutateLegacyMatrix.delete_object.concrete_tool, "delete_object");
  assert.equal(
    mutateLegacyMatrix.duplicate_object.family_key,
    "write.object_lifecycle.duplicate_object"
  );
  assert.equal(
    mutateLegacyMatrix.duplicate_object.concrete_tool,
    "duplicate_object"
  );
  assert.equal(
    mutateLegacyMatrix.execute_unity_transaction.family_key,
    "write.transaction.execute"
  );
  assert.equal(
    mutateLegacyMatrix.execute_unity_transaction.concrete_tool,
    "execute_unity_transaction"
  );
  assert.equal(
    mutateLegacyMatrix.save_scene.family_key,
    "write.scene_persistence.save_scene"
  );
  assert.equal(mutateLegacyMatrix.save_scene.concrete_tool, "save_scene");
  assert.equal(
    mutateLegacyMatrix.save_prefab.family_key,
    "write.scene_persistence.save_prefab"
  );
  assert.equal(mutateLegacyMatrix.save_prefab.concrete_tool, "save_prefab");
  assert.equal(
    mutateLegacyMatrix.submit_unity_task.family_key,
    "write.async_ops.submit_task"
  );
  assert.equal(
    mutateLegacyMatrix.submit_unity_task.concrete_tool,
    "submit_unity_task"
  );
  assert.equal(
    mutateLegacyMatrix.get_unity_task_status.family_key,
    "write.async_ops.get_task_status"
  );
  assert.equal(
    mutateLegacyMatrix.get_unity_task_status.concrete_tool,
    "get_unity_task_status"
  );
  assert.equal(
    mutateLegacyMatrix.cancel_unity_task.family_key,
    "write.async_ops.cancel_task"
  );
  assert.equal(
    mutateLegacyMatrix.cancel_unity_task.concrete_tool,
    "cancel_unity_task"
  );
});

test("StepB dual-stack parser resolves family_key and legacy_concrete_key", () => {
  const familyOutcome = resolveMappingByIntent({
    block_id: "f1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {},
  });
  assert.equal(familyOutcome.ok, true);
  assert.equal(familyOutcome.family_key, "mutate.set_active");
  assert.equal(familyOutcome.intent_key_source, INTENT_KEY_SOURCE.FAMILY_KEY);
  assert.equal(familyOutcome.tool_name, "set_active");

  const legacyOutcome = resolveMappingByIntent({
    block_id: "l1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "set_active",
    input: {},
  });
  assert.equal(legacyOutcome.ok, true);
  assert.equal(legacyOutcome.family_key, "mutate.set_active");
  assert.equal(
    legacyOutcome.intent_key_source,
    INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY
  );
  assert.equal(legacyOutcome.legacy_concrete_key, "set_active");
  assert.equal(legacyOutcome.tool_name, "set_active");
});

test("StepB parser can rollback mapping by disabled family policy", () => {
  const disabledOutcome = resolveMappingByIntent(
    {
      block_id: "rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "mutate.set_active",
      input: {},
    },
    {
      disabled_family_keys: ["mutate.set_active"],
    }
  );
  assert.equal(disabledOutcome.ok, false);
  assert.equal(disabledOutcome.error.error_code, "E_PRECONDITION_FAILED");
  assert.equal(disabledOutcome.error.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
  assert.equal(
    disabledOutcome.error.error_message.includes("family mapping disabled by rollback policy"),
    true
  );
});

test("S2A-T1 maps READ_STATE snapshot block to get_scene_snapshot_for_write", () => {
  const outcome = mapBlockSpecToToolPlan({
    block_id: "b1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.tool_name, "get_scene_snapshot_for_write");
  assert.equal(outcome.payload.scope_path, "Scene/Canvas");
});

test("F2 Read.SceneRoots maps READ_STATE scene_roots family to get_scene_roots tool", () => {
  const withOptions = mapBlockSpecToToolPlan({
    block_id: "read_roots_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.scene_roots",
    input: {
      include_inactive: true,
      scene_path: "Assets/Scenes/SampleScene.unity",
    },
  });
  assert.equal(withOptions.ok, true);
  assert.equal(withOptions.tool_name, "get_scene_roots");
  assert.equal(withOptions.payload.include_inactive, true);
  assert.equal(
    withOptions.payload.scene_path,
    "Assets/Scenes/SampleScene.unity"
  );

  const withoutOptions = mapBlockSpecToToolPlan({
    block_id: "read_roots_2",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.scene_roots",
    input: {},
  });
  assert.equal(withoutOptions.ok, true);
  assert.equal(withoutOptions.tool_name, "get_scene_roots");
  assert.deepEqual(withoutOptions.payload, {});
});

test("F1 Read.Selection maps READ_STATE selection families to current-selection/find-by-component tools", () => {
  const currentSelection = mapBlockSpecToToolPlan({
    block_id: "read_sel_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.selection.current",
    input: {},
  });
  assert.equal(currentSelection.ok, true);
  assert.equal(currentSelection.tool_name, "get_current_selection");
  assert.deepEqual(currentSelection.payload, {});

  const byComponent = mapBlockSpecToToolPlan({
    block_id: "read_sel_2",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.selection.by_component",
    input: {
      component_query: "UnityEngine.RectTransform",
      include_inactive: true,
      limit: 12,
      scene_path: "Assets/Scenes/SampleScene.unity",
      under_path: "Scene/Canvas",
    },
  });
  assert.equal(byComponent.ok, true);
  assert.equal(byComponent.tool_name, "find_objects_by_component");
  assert.equal(byComponent.payload.component_query, "UnityEngine.RectTransform");
  assert.equal(byComponent.payload.include_inactive, true);
  assert.equal(byComponent.payload.limit, 12);
  assert.equal(
    byComponent.payload.scene_path,
    "Assets/Scenes/SampleScene.unity"
  );
  assert.equal(byComponent.payload.under_path, "Scene/Canvas");

  const byComponentMissingQuery = mapBlockSpecToToolPlan({
    block_id: "read_sel_3",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.selection.by_component",
    input: {},
  });
  assert.equal(byComponentMissingQuery.ok, false);
  assert.equal(byComponentMissingQuery.error_code, "E_SCHEMA_INVALID");
});

test("F3 Read.Components maps READ_STATE component families to component/serialized-property tools", () => {
  const components = mapBlockSpecToToolPlan({
    block_id: "read_components_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.components",
    input: {},
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Panel",
    },
  });
  assert.equal(components.ok, true);
  assert.equal(components.tool_name, "get_gameobject_components");
  assert.equal(
    components.payload.target_object_id,
    "GlobalObjectId_V1-target"
  );
  assert.equal(components.payload.target_path, "Scene/Canvas/Panel");

  const serialized = mapBlockSpecToToolPlan({
    block_id: "read_components_2",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.components.serialized_property_tree",
    input: {
      component_assembly_qualified_name:
        "UnityEngine.RectTransform, UnityEngine.CoreModule",
      include_value_summary: true,
      depth: 2,
      node_budget: 120,
      char_budget: 3000,
      page_size: 20,
      root_property_path: "m_Children",
      after_property_path: "m_Children.Array.data[0]",
      timeout_ms: 4000,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Panel",
    },
  });
  assert.equal(serialized.ok, true);
  assert.equal(serialized.tool_name, "get_serialized_property_tree");
  assert.equal(
    serialized.payload.component_assembly_qualified_name,
    "UnityEngine.RectTransform, UnityEngine.CoreModule"
  );
  assert.equal(serialized.payload.include_value_summary, true);
  assert.equal(serialized.payload.depth, 2);
  assert.equal(serialized.payload.node_budget, 120);
  assert.equal(serialized.payload.char_budget, 3000);
  assert.equal(serialized.payload.page_size, 20);
  assert.equal(serialized.payload.root_property_path, "m_Children");
  assert.equal(
    serialized.payload.after_property_path,
    "m_Children.Array.data[0]"
  );
  assert.equal(serialized.payload.timeout_ms, 4000);

  const serializedMissingComponent = mapBlockSpecToToolPlan({
    block_id: "read_components_3",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.components.serialized_property_tree",
    input: {},
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Panel",
    },
  });
  assert.equal(serializedMissingComponent.ok, false);
  assert.equal(serializedMissingComponent.error_code, "E_SCHEMA_INVALID");
});

test("F4 Read.Assets maps READ_STATE asset families to folder/prefab tools", () => {
  const listAssets = mapBlockSpecToToolPlan({
    block_id: "read_assets_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets",
    input: {
      folder_path: "Assets/Prefabs",
      recursive: true,
      include_meta: true,
      limit: 50,
    },
  });
  assert.equal(listAssets.ok, true);
  assert.equal(listAssets.tool_name, "list_assets_in_folder");
  assert.equal(listAssets.payload.folder_path, "Assets/Prefabs");
  assert.equal(listAssets.payload.recursive, true);
  assert.equal(listAssets.payload.include_meta, true);
  assert.equal(listAssets.payload.limit, 50);

  const prefabInfo = mapBlockSpecToToolPlan({
    block_id: "read_assets_2",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets.prefab_info",
    input: {
      prefab_path: "Assets/Prefabs/Widget.prefab",
      max_depth: 3,
      include_components: true,
      include_missing_scripts: false,
      node_budget: 100,
      char_budget: 4000,
    },
  });
  assert.equal(prefabInfo.ok, true);
  assert.equal(prefabInfo.tool_name, "query_prefab_info");
  assert.equal(prefabInfo.payload.prefab_path, "Assets/Prefabs/Widget.prefab");
  assert.equal(prefabInfo.payload.max_depth, 3);
  assert.equal(prefabInfo.payload.include_components, true);
  assert.equal(prefabInfo.payload.include_missing_scripts, false);
  assert.equal(prefabInfo.payload.node_budget, 100);
  assert.equal(prefabInfo.payload.char_budget, 4000);

  const listAssetsMissingFolder = mapBlockSpecToToolPlan({
    block_id: "read_assets_3",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets",
    input: {},
  });
  assert.equal(listAssetsMissingFolder.ok, false);
  assert.equal(listAssetsMissingFolder.error_code, "E_SCHEMA_INVALID");

  const prefabInfoMissingDepth = mapBlockSpecToToolPlan({
    block_id: "read_assets_4",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.assets.prefab_info",
    input: {
      prefab_path: "Assets/Prefabs/Widget.prefab",
    },
  });
  assert.equal(prefabInfoMissingDepth.ok, false);
  assert.equal(prefabInfoMissingDepth.error_code, "E_SCHEMA_INVALID");
});

test("S2A-T1 maps READ_STATE hierarchy block and enforces anchor", () => {
  const success = mapBlockSpecToToolPlan({
    block_id: "b1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.hierarchy_subtree",
    input: {
      depth: 2,
    },
    target_anchor: buildAnchor(),
  });
  assert.equal(success.ok, true);
  assert.equal(success.tool_name, "get_hierarchy_subtree");
  assert.equal(success.payload.target_object_id, buildAnchor().object_id);
  assert.equal(success.payload.target_path, buildAnchor().path);

  const failure = mapBlockSpecToToolPlan({
    block_id: "b1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.hierarchy_subtree",
    input: {},
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.error_code, "E_SCHEMA_INVALID");
});

test("S2A-T1 maps CREATE block to create_object with write envelope", () => {
  const outcome = mapBlockSpecToToolPlan({
    block_id: "b2",
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
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.tool_name, "create_object");
  assert.equal(outcome.payload.parent_object_id, "GlobalObjectId_V1-canvas");
  assert.equal(outcome.payload.parent_path, "Scene/Canvas");
  assert.equal(outcome.payload.new_object_name, "ImageContainer");
  assert.equal(outcome.payload.object_kind, "ui_panel");
  assert.equal(outcome.payload.set_active, true);
  assert.equal(outcome.payload.based_on_read_token, "ssot_rt_123");
});

test("S2A-T1 maps MUTATE component_properties with value kind checks", () => {
  const success = mapBlockSpecToToolPlan({
    block_id: "m1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.component_properties",
    input: {
      component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      property_path: "m_Spacing",
      value_kind: "number",
      value_number: 100,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(success.ok, true);
  assert.equal(success.tool_name, "set_component_properties");
  assert.equal(success.payload.value_kind, "number");
  assert.equal(success.payload.value_number, 100);
  assert.equal(
    success.mapping_meta.source_capability_family,
    "Write.GenericProperty"
  );
  assert.equal(success.mapping_meta.fallback_guard_state, "strict_allowed");

  const failure = mapBlockSpecToToolPlan({
    block_id: "m2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.component_properties",
    input: {
      component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      property_path: "m_Spacing",
      value_kind: "number",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.error_code, "E_SCHEMA_INVALID");
});

test("S2A-T1 maps MUTATE ui_layout and set_active", () => {
  const uiLayout = mapBlockSpecToToolPlan({
    block_id: "m1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.ui_layout",
    input: {
      anchored_x: 0,
      anchored_y: 0,
      width: 120,
      height: 80,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(uiLayout.ok, true);
  assert.equal(uiLayout.tool_name, "modify_ui_layout");

  const setActive = mapBlockSpecToToolPlan({
    block_id: "m2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: false,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(setActive.ok, true);
  assert.equal(setActive.tool_name, "set_active");
  assert.equal(setActive.payload.active, false);
});

test("F5 Write.RectLayout maps MUTATE write.rect_layout families to rect/layout tools", () => {
  const anchoredPosition = mapBlockSpecToToolPlan({
    block_id: "f5_rect_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.anchored_position",
    input: {
      x: 120,
      y: -30,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(anchoredPosition.ok, true);
  assert.equal(anchoredPosition.tool_name, "set_rect_anchored_position");
  assert.equal(anchoredPosition.payload.x, 120);
  assert.equal(anchoredPosition.payload.y, -30);

  const sizeDelta = mapBlockSpecToToolPlan({
    block_id: "f5_rect_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.size_delta",
    input: {
      x: 200,
      y: 80,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(sizeDelta.ok, true);
  assert.equal(sizeDelta.tool_name, "set_rect_size_delta");

  const pivot = mapBlockSpecToToolPlan({
    block_id: "f5_rect_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.pivot",
    input: {
      x: 0.5,
      y: 0.5,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(pivot.ok, true);
  assert.equal(pivot.tool_name, "set_rect_pivot");

  const anchors = mapBlockSpecToToolPlan({
    block_id: "f5_rect_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.anchors",
    input: {
      min_x: 0,
      min_y: 0,
      max_x: 1,
      max_y: 1,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(anchors.ok, true);
  assert.equal(anchors.tool_name, "set_rect_anchors");

  const layoutElement = mapBlockSpecToToolPlan({
    block_id: "f5_rect_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.layout_element",
    input: {
      min_width: 100,
      min_height: 24,
      preferred_width: 160,
      preferred_height: 40,
      flexible_width: 0,
      flexible_height: 0,
      ignore_layout: false,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(layoutElement.ok, true);
  assert.equal(layoutElement.tool_name, "set_layout_element");
  assert.equal(layoutElement.payload.ignore_layout, false);

  const missingRequired = mapBlockSpecToToolPlan({
    block_id: "f5_rect_6",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.rect_layout.layout_element",
    input: {
      min_width: 100,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingRequired.ok, false);
  assert.equal(missingRequired.error_code, "E_SCHEMA_INVALID");
});

test("F5 Write.RectLayout can be rollback-disabled by write.rect_layout family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f5_rect_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.rect_layout.pivot",
      input: {
        x: 0.5,
        y: 0.5,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.rect_layout"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F6 Write.UIStyle maps MUTATE write.ui_style families to ui style tools", () => {
  const canvasAlpha = mapBlockSpecToToolPlan({
    block_id: "f6_ui_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.canvas_group_alpha",
    input: {
      alpha: 0.5,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(canvasAlpha.ok, true);
  assert.equal(canvasAlpha.tool_name, "set_canvas_group_alpha");

  const imageColor = mapBlockSpecToToolPlan({
    block_id: "f6_ui_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.image_color",
    input: {
      r: 1,
      g: 0.5,
      b: 0,
      a: 1,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(imageColor.ok, true);
  assert.equal(imageColor.tool_name, "set_ui_image_color");

  const imageRaycast = mapBlockSpecToToolPlan({
    block_id: "f6_ui_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.image_raycast_target",
    input: {
      raycast_target: false,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(imageRaycast.ok, true);
  assert.equal(imageRaycast.tool_name, "set_ui_image_raycast_target");
  assert.equal(imageRaycast.payload.raycast_target, false);

  const textContent = mapBlockSpecToToolPlan({
    block_id: "f6_ui_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.text_content",
    input: {
      text: "Start",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(textContent.ok, true);
  assert.equal(textContent.tool_name, "set_ui_text_content");
  assert.equal(textContent.payload.text, "Start");

  const textColor = mapBlockSpecToToolPlan({
    block_id: "f6_ui_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.text_color",
    input: {
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: 1,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(textColor.ok, true);
  assert.equal(textColor.tool_name, "set_ui_text_color");

  const textFontSize = mapBlockSpecToToolPlan({
    block_id: "f6_ui_6",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.text_font_size",
    input: {
      font_size: 24,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(textFontSize.ok, true);
  assert.equal(textFontSize.tool_name, "set_ui_text_font_size");
  assert.equal(textFontSize.payload.font_size, 24);

  const missingRequired = mapBlockSpecToToolPlan({
    block_id: "f6_ui_7",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.ui_style.text_font_size",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingRequired.ok, false);
  assert.equal(missingRequired.error_code, "E_SCHEMA_INVALID");
});

test("F6 Write.UIStyle can be rollback-disabled by write.ui_style family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f6_ui_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.ui_style.text_color",
      input: {
        r: 1,
        g: 1,
        b: 1,
        a: 1,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.ui_style"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F7 Write.Transform.Local maps MUTATE write.transform.local families to local transform tools", () => {
  const localPosition = mapBlockSpecToToolPlan({
    block_id: "f7_local_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.local.position",
    input: {
      x: 0,
      y: 1,
      z: 2,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(localPosition.ok, true);
  assert.equal(localPosition.tool_name, "set_local_position");

  const localRotation = mapBlockSpecToToolPlan({
    block_id: "f7_local_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.local.rotation",
    input: {
      x: 10,
      y: 20,
      z: 30,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(localRotation.ok, true);
  assert.equal(localRotation.tool_name, "set_local_rotation");

  const localScale = mapBlockSpecToToolPlan({
    block_id: "f7_local_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.local.scale",
    input: {
      x: 1,
      y: 1,
      z: 1,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(localScale.ok, true);
  assert.equal(localScale.tool_name, "set_local_scale");

  const resetTransform = mapBlockSpecToToolPlan({
    block_id: "f7_local_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.local.reset",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(resetTransform.ok, true);
  assert.equal(resetTransform.tool_name, "reset_transform");

  const missingAxis = mapBlockSpecToToolPlan({
    block_id: "f7_local_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.local.position",
    input: {
      x: 1,
      y: 2,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingAxis.ok, false);
  assert.equal(missingAxis.error_code, "E_SCHEMA_INVALID");
});

test("F7 Write.Transform.Local can be rollback-disabled by write.transform.local family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f7_local_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.transform.local.rotation",
      input: {
        x: 0,
        y: 90,
        z: 0,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.transform.local"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F8 Write.Hierarchy maps MUTATE write.hierarchy families to hierarchy tools", () => {
  const parent = mapBlockSpecToToolPlan({
    block_id: "f8_hierarchy_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.hierarchy.parent",
    input: {
      parent_object_id: "GlobalObjectId_V1-parent_new",
      parent_path: "Scene/Canvas/NewParent",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(parent.ok, true);
  assert.equal(parent.tool_name, "set_parent");
  assert.equal(parent.payload.parent_object_id, "GlobalObjectId_V1-parent_new");
  assert.equal(parent.payload.parent_path, "Scene/Canvas/NewParent");

  const siblingIndex = mapBlockSpecToToolPlan({
    block_id: "f8_hierarchy_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.hierarchy.sibling_index",
    input: {
      sibling_index: 2,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(siblingIndex.ok, true);
  assert.equal(siblingIndex.tool_name, "set_sibling_index");
  assert.equal(siblingIndex.payload.sibling_index, 2);

  const missingParentPath = mapBlockSpecToToolPlan({
    block_id: "f8_hierarchy_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.hierarchy.parent",
    input: {
      parent_object_id: "GlobalObjectId_V1-parent_new",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingParentPath.ok, false);
  assert.equal(missingParentPath.error_code, "E_SCHEMA_INVALID");

  const invalidSiblingIndexNegative = mapBlockSpecToToolPlan({
    block_id: "f8_hierarchy_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.hierarchy.sibling_index",
    input: {
      sibling_index: -1,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(invalidSiblingIndexNegative.ok, false);
  assert.equal(invalidSiblingIndexNegative.error_code, "E_SCHEMA_INVALID");

  const invalidSiblingIndexFloat = mapBlockSpecToToolPlan({
    block_id: "f8_hierarchy_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.hierarchy.sibling_index",
    input: {
      sibling_index: 1.5,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(invalidSiblingIndexFloat.ok, false);
  assert.equal(invalidSiblingIndexFloat.error_code, "E_SCHEMA_INVALID");
});

test("F8 Write.Hierarchy can be rollback-disabled by write.hierarchy family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f8_hierarchy_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.hierarchy.parent",
      input: {
        parent_object_id: "GlobalObjectId_V1-parent_new",
        parent_path: "Scene/Canvas/NewParent",
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.hierarchy"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F9 Write.ComponentLifecycle maps MUTATE write.component_lifecycle families to component lifecycle tools", () => {
  const addComponent = mapBlockSpecToToolPlan({
    block_id: "f9_component_lifecycle_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.component_lifecycle.add_component",
    input: {
      component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(addComponent.ok, true);
  assert.equal(addComponent.tool_name, "add_component");
  assert.equal(
    addComponent.payload.component_type,
    "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI"
  );

  const removeComponent = mapBlockSpecToToolPlan({
    block_id: "f9_component_lifecycle_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.component_lifecycle.remove_component",
    input: {
      component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(removeComponent.ok, true);
  assert.equal(removeComponent.tool_name, "remove_component");

  const replaceComponent = mapBlockSpecToToolPlan({
    block_id: "f9_component_lifecycle_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.component_lifecycle.replace_component",
    input: {
      source_component_type: "UnityEngine.UI.Text, UnityEngine.UI",
      new_component_type: "TMPro.TextMeshProUGUI, Unity.TextMeshPro",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(replaceComponent.ok, true);
  assert.equal(replaceComponent.tool_name, "replace_component");
  assert.equal(
    replaceComponent.payload.source_component_type,
    "UnityEngine.UI.Text, UnityEngine.UI"
  );
  assert.equal(
    replaceComponent.payload.new_component_type,
    "TMPro.TextMeshProUGUI, Unity.TextMeshPro"
  );

  const addMissingType = mapBlockSpecToToolPlan({
    block_id: "f9_component_lifecycle_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.component_lifecycle.add_component",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(addMissingType.ok, false);
  assert.equal(addMissingType.error_code, "E_SCHEMA_INVALID");

  const replaceMissingTargetType = mapBlockSpecToToolPlan({
    block_id: "f9_component_lifecycle_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.component_lifecycle.replace_component",
    input: {
      source_component_type: "UnityEngine.UI.Text, UnityEngine.UI",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(replaceMissingTargetType.ok, false);
  assert.equal(replaceMissingTargetType.error_code, "E_SCHEMA_INVALID");
});

test("F9 Write.ComponentLifecycle can be rollback-disabled by write.component_lifecycle family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f9_component_lifecycle_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.component_lifecycle.remove_component",
      input: {
        component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.component_lifecycle"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F10 Write.ObjectLifecycle maps MUTATE write.object_lifecycle families to object lifecycle tools", () => {
  const renameObject = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.rename_object",
    input: {
      new_name: "RenamedItem",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(renameObject.ok, true);
  assert.equal(renameObject.tool_name, "rename_object");
  assert.equal(renameObject.payload.new_name, "RenamedItem");

  const deleteObject = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.delete_object",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(deleteObject.ok, true);
  assert.equal(deleteObject.tool_name, "delete_object");

  const duplicateObject = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.duplicate_object",
    input: {
      duplicate_name: "Item_Copy",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(duplicateObject.ok, true);
  assert.equal(duplicateObject.tool_name, "duplicate_object");
  assert.equal(duplicateObject.payload.duplicate_name, "Item_Copy");

  const duplicateObjectNoName = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.duplicate_object",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(duplicateObjectNoName.ok, true);
  assert.equal(duplicateObjectNoName.tool_name, "duplicate_object");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      duplicateObjectNoName.payload,
      "duplicate_name"
    ),
    false
  );

  const renameMissingName = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.rename_object",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(renameMissingName.ok, false);
  assert.equal(renameMissingName.error_code, "E_SCHEMA_INVALID");

  const duplicateInvalidName = mapBlockSpecToToolPlan({
    block_id: "f10_object_lifecycle_6",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.object_lifecycle.duplicate_object",
    input: {
      duplicate_name: "   ",
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(duplicateInvalidName.ok, false);
  assert.equal(duplicateInvalidName.error_code, "E_SCHEMA_INVALID");
});

test("F10 Write.ObjectLifecycle can be rollback-disabled by write.object_lifecycle family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f10_object_lifecycle_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.object_lifecycle.delete_object",
      input: {},
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.object_lifecycle"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F11 Write.Transform.World maps MUTATE write.transform.world families to world transform tools", () => {
  const worldPosition = mapBlockSpecToToolPlan({
    block_id: "f11_world_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.world.position",
    input: {
      x: 1,
      y: 2,
      z: 3,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(worldPosition.ok, true);
  assert.equal(worldPosition.tool_name, "set_world_position");

  const worldRotation = mapBlockSpecToToolPlan({
    block_id: "f11_world_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.world.rotation",
    input: {
      x: 10,
      y: 20,
      z: 30,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(worldRotation.ok, true);
  assert.equal(worldRotation.tool_name, "set_world_rotation");

  const missingAxis = mapBlockSpecToToolPlan({
    block_id: "f11_world_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transform.world.position",
    input: {
      x: 1,
      y: 2,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingAxis.ok, false);
  assert.equal(missingAxis.error_code, "E_SCHEMA_INVALID");
});

test("F11 Write.Transform.World can be rollback-disabled by write.transform.world family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f11_world_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.transform.world.rotation",
      input: {
        x: 0,
        y: 90,
        z: 0,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.transform.world"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F12 Write.TransactionOrchestration maps MUTATE write.transaction family to execute_unity_transaction", () => {
  const transaction = mapBlockSpecToToolPlan({
    block_id: "f12_transaction_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transaction.execute",
    input: {
      transaction_id: "txn_f12_001",
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
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(transaction.ok, true);
  assert.equal(transaction.tool_name, "execute_unity_transaction");
  assert.equal(transaction.payload.transaction_id, "txn_f12_001");
  assert.equal(Array.isArray(transaction.payload.steps), true);
  assert.equal(transaction.payload.steps.length, 1);

  const missingTransactionId = mapBlockSpecToToolPlan({
    block_id: "f12_transaction_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transaction.execute",
    input: {
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
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingTransactionId.ok, false);
  assert.equal(missingTransactionId.error_code, "E_SCHEMA_INVALID");

  const missingSteps = mapBlockSpecToToolPlan({
    block_id: "f12_transaction_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transaction.execute",
    input: {
      transaction_id: "txn_f12_003",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(missingSteps.ok, false);
  assert.equal(missingSteps.error_code, "E_SCHEMA_INVALID");

  const emptySteps = mapBlockSpecToToolPlan({
    block_id: "f12_transaction_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.transaction.execute",
    input: {
      transaction_id: "txn_f12_004",
      steps: [],
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(emptySteps.ok, false);
  assert.equal(emptySteps.error_code, "E_SCHEMA_INVALID");
});

test("F12 Write.TransactionOrchestration can be rollback-disabled by write.transaction family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f12_transaction_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.transaction.execute",
      input: {
        transaction_id: "txn_f12_rollback",
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
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.transaction"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F13 Write.ScenePersistence maps MUTATE write.scene_persistence families to scene persistence tools", () => {
  const saveScene = mapBlockSpecToToolPlan({
    block_id: "f13_scene_persistence_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_scene",
    input: {
      scene_path: "Assets/Scenes/SampleScene.unity",
      save_as_new: false,
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(saveScene.ok, true);
  assert.equal(saveScene.tool_name, "save_scene");
  assert.equal(saveScene.payload.scene_path, "Assets/Scenes/SampleScene.unity");
  assert.equal(saveScene.payload.save_as_new, false);

  const saveSceneDefault = mapBlockSpecToToolPlan({
    block_id: "f13_scene_persistence_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_scene",
    input: {},
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(saveSceneDefault.ok, true);
  assert.equal(saveSceneDefault.tool_name, "save_scene");

  const savePrefab = mapBlockSpecToToolPlan({
    block_id: "f13_scene_persistence_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_prefab",
    input: {
      prefab_path: "Assets/Prefabs/MyButton.prefab",
      save_as_new: true,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(savePrefab.ok, true);
  assert.equal(savePrefab.tool_name, "save_prefab");
  assert.equal(savePrefab.payload.prefab_path, "Assets/Prefabs/MyButton.prefab");
  assert.equal(savePrefab.payload.save_as_new, true);

  const savePrefabMissingAnchor = mapBlockSpecToToolPlan({
    block_id: "f13_scene_persistence_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_prefab",
    input: {},
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(savePrefabMissingAnchor.ok, false);
  assert.equal(savePrefabMissingAnchor.error_code, "E_SCHEMA_INVALID");

  const saveSceneInvalidPath = mapBlockSpecToToolPlan({
    block_id: "f13_scene_persistence_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.scene_persistence.save_scene",
    input: {
      scene_path: "   ",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(saveSceneInvalidPath.ok, false);
  assert.equal(saveSceneInvalidPath.error_code, "E_SCHEMA_INVALID");
});

test("F13 Write.ScenePersistence can be rollback-disabled by write.scene_persistence family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f13_scene_persistence_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.scene_persistence.save_scene",
      input: {},
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.scene_persistence"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("F14 Write.AsyncOps maps MUTATE write.async_ops families to async tools", () => {
  const submitTask = mapBlockSpecToToolPlan({
    block_id: "f14_async_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.submit_task",
    input: {
      thread_id: "thread_mock_1",
      user_intent: "Run async task",
      file_actions: [],
      approval_mode: "auto",
      context: { request_source: "planner" },
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(submitTask.ok, true);
  assert.equal(submitTask.tool_name, "submit_unity_task");
  assert.equal(submitTask.payload.thread_id, "thread_mock_1");
  assert.equal(submitTask.payload.user_intent, "Run async task");
  assert.equal(Array.isArray(submitTask.payload.file_actions), true);
  assert.equal(submitTask.payload.approval_mode, "auto");
  assert.equal(submitTask.payload.write_anchor.object_id, "GlobalObjectId_V1-parent");

  const getTaskStatus = mapBlockSpecToToolPlan({
    block_id: "f14_async_2",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.get_task_status",
    input: {
      job_id: "job_123",
      thread_id: "thread_mock_1",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(getTaskStatus.ok, true);
  assert.equal(getTaskStatus.tool_name, "get_unity_task_status");
  assert.equal(getTaskStatus.payload.job_id, "job_123");
  assert.equal(getTaskStatus.payload.thread_id, "thread_mock_1");

  const cancelTask = mapBlockSpecToToolPlan({
    block_id: "f14_async_3",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.cancel_task",
    input: {
      job_id: "job_456",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(cancelTask.ok, true);
  assert.equal(cancelTask.tool_name, "cancel_unity_task");
  assert.equal(cancelTask.payload.job_id, "job_456");

  const submitTaskMissingAction = mapBlockSpecToToolPlan({
    block_id: "f14_async_4",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.submit_task",
    input: {
      thread_id: "thread_mock_1",
      user_intent: "Run async task",
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(submitTaskMissingAction.ok, false);
  assert.equal(submitTaskMissingAction.error_code, "E_SCHEMA_INVALID");

  const submitTaskDualAction = mapBlockSpecToToolPlan({
    block_id: "f14_async_5",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.submit_task",
    input: {
      thread_id: "thread_mock_1",
      user_intent: "Run async task",
      file_actions: [],
      visual_layer_actions: [],
    },
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(submitTaskDualAction.ok, false);
  assert.equal(submitTaskDualAction.error_code, "E_SCHEMA_INVALID");

  const getStatusMissingJobId = mapBlockSpecToToolPlan({
    block_id: "f14_async_6",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.get_task_status",
    input: {},
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(getStatusMissingJobId.ok, false);
  assert.equal(getStatusMissingJobId.error_code, "E_SCHEMA_INVALID");
});

test("F14 Write.AsyncOps can be rollback-disabled by write.async_ops family prefix", () => {
  const denied = mapBlockSpecToToolPlan(
    {
      block_id: "f14_async_rollback_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "write.async_ops.cancel_task",
      input: {
        job_id: "job_rollback",
      },
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    },
    {
      disabled_family_keys: ["write.async_ops"],
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
  assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
});

test("StepB maps legacy concrete key to same plan as family key", () => {
  const legacy = mapBlockSpecToToolPlan({
    block_id: "m_legacy_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "set_active",
    input: {
      active: false,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  const family = mapBlockSpecToToolPlan({
    block_id: "m_family_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: false,
    },
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });

  assert.equal(legacy.ok, true);
  assert.equal(family.ok, true);
  assert.equal(legacy.tool_name, family.tool_name);
  assert.deepEqual(legacy.payload, family.payload);
  assert.equal(legacy.mapping_meta.family_key, "mutate.set_active");
  assert.equal(legacy.mapping_meta.raw_intent_key, "set_active");
  assert.equal(
    legacy.mapping_meta.intent_key_source,
    INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY
  );
  assert.equal(legacy.mapping_meta.primary_tool_name, "set_active");
  assert.equal(legacy.mapping_meta.selected_tool_name, "set_active");
  assert.equal(legacy.mapping_meta.fallback_policy_mode, "disabled");
  assert.equal(legacy.mapping_meta.fallback_attempted, false);
  assert.equal(legacy.mapping_meta.fallback_used, false);
  assert.equal(
    legacy.mapping_meta.execution_backend_role,
    "internal_direct_runtime_backend"
  );
});

test("StepB legacy concrete key can be fail-closed by compat switch", () => {
  const envKey = "BLOCK_RUNTIME_LEGACY_INTENT_COMPAT_ENABLED";
  const previous = process.env[envKey];
  process.env[envKey] = "false";
  try {
    const legacyDenied = mapBlockSpecToToolPlan({
      block_id: "m_legacy_disabled_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "set_active",
      input: {
        active: false,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    });
    assert.equal(legacyDenied.ok, false);
    assert.equal(legacyDenied.error_code, "E_SCHEMA_INVALID");
    assert.equal(legacyDenied.block_error_code, "E_BLOCK_INTENT_KEY_UNSUPPORTED");
    assert.equal(
      legacyDenied.error_message.includes("expected family_key"),
      true
    );
  } finally {
    if (typeof previous === "string") {
      process.env[envKey] = previous;
    } else {
      delete process.env[envKey];
    }
  }
});

test("StepB mapBlockSpecToToolPlan supports family-level rollback by env switch", () => {
  const envKey = "BLOCK_RUNTIME_DISABLED_FAMILY_KEYS";
  const previous = process.env[envKey];
  process.env[envKey] = "mutate.set_active";
  try {
    const denied = mapBlockSpecToToolPlan({
      block_id: "rollback_plan_1",
      block_type: BLOCK_TYPE.MUTATE,
      intent_key: "mutate.set_active",
      input: {
        active: false,
      },
      target_anchor: buildAnchor(),
      based_on_read_token: "ssot_rt_123",
      write_envelope: buildWriteEnvelope(),
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error_code, "E_PRECONDITION_FAILED");
    assert.equal(denied.block_error_code, "E_BLOCK_NOT_IMPLEMENTED");
  } finally {
    if (typeof previous === "string") {
      process.env[envKey] = previous;
    } else {
      delete process.env[envKey];
    }
  }
});

test("S2A-T1 rejects unsupported intent key with block subcode", () => {
  const outcome = mapBlockSpecToToolPlan({
    block_id: "x1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.unknown",
    input: {},
    target_anchor: buildAnchor(),
    based_on_read_token: "ssot_rt_123",
    write_envelope: buildWriteEnvelope(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(outcome.block_error_code, "E_BLOCK_INTENT_KEY_UNSUPPORTED");
});

test("S2A-T1 VERIFY maps to local verify tool plan and rejects non-verify intent_key", () => {
  const outcome = mapBlockSpecToToolPlan({
    block_id: "v1",
    block_type: BLOCK_TYPE.VERIFY,
    intent_key: "verify.block",
    input: {
      expected_status: "succeeded",
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.tool_name, "__block_verify_local__");
  assert.equal(outcome.mapping_meta.family_key, "verify.local");
  assert.equal(
    outcome.mapping_meta.execution_backend_role,
    "local_verify_runtime"
  );
  assert.equal(outcome.payload.verify_intent_key, "verify.block");
  assert.equal(outcome.payload.verify_input.expected_status, "succeeded");

  const invalidIntent = mapBlockSpecToToolPlan({
    block_id: "v2",
    block_type: BLOCK_TYPE.VERIFY,
    intent_key: "mutate.set_active",
    input: {},
  });
  assert.equal(invalidIntent.ok, false);
  assert.equal(invalidIntent.error_code, "E_SCHEMA_INVALID");
  assert.equal(invalidIntent.block_error_code, "E_BLOCK_INTENT_KEY_UNSUPPORTED");
});
