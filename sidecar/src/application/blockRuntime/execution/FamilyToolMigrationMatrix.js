"use strict";

const { BLOCK_TYPE } = require("../contracts");

function freezeObject(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeObject(item);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    freezeObject(value[key]);
  }
  return value;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

const FAMILY_TOOL_MIGRATION_MATRIX = freezeObject({
  [BLOCK_TYPE.READ_STATE]: {
    "read.selection.current": {
      family_key: "read.selection.current",
      primary_tool: "get_current_selection",
      mapper_id: "read.selection.current",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.selection.by_component": {
      family_key: "read.selection.by_component",
      primary_tool: "find_objects_by_component",
      mapper_id: "read.selection.by_component",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.snapshot_for_write": {
      family_key: "read.snapshot_for_write",
      primary_tool: "get_scene_snapshot_for_write",
      mapper_id: "read.snapshot_for_write",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.scene_roots": {
      family_key: "read.scene_roots",
      primary_tool: "get_scene_roots",
      mapper_id: "read.scene_roots",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.components": {
      family_key: "read.components",
      primary_tool: "get_gameobject_components",
      mapper_id: "read.components",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.components.serialized_property_tree": {
      family_key: "read.components.serialized_property_tree",
      primary_tool: "get_serialized_property_tree",
      mapper_id: "read.components.serialized_property_tree",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.assets": {
      family_key: "read.assets",
      primary_tool: "list_assets_in_folder",
      mapper_id: "read.assets",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.assets.prefab_info": {
      family_key: "read.assets.prefab_info",
      primary_tool: "query_prefab_info",
      mapper_id: "read.assets.prefab_info",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "read.hierarchy_subtree": {
      family_key: "read.hierarchy_subtree",
      primary_tool: "get_hierarchy_subtree",
      mapper_id: "read.hierarchy_subtree",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
  },
  [BLOCK_TYPE.CREATE]: {
    "create.object": {
      family_key: "create.object",
      primary_tool: "create_object",
      mapper_id: "create.object",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
  },
  [BLOCK_TYPE.MUTATE]: {
    "mutate.component_properties": {
      family_key: "mutate.component_properties",
      primary_tool: "set_component_properties",
      mapper_id: "mutate.component_properties",
      fallback: {
        mode: "controlled",
        tools: ["set_serialized_property"],
        trigger:
          "specialized_unavailable_or_failed_and_policy_allows_generic_property",
      },
    },
    "mutate.ui_layout": {
      family_key: "mutate.ui_layout",
      primary_tool: "modify_ui_layout",
      mapper_id: "mutate.ui_layout",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "mutate.set_active": {
      family_key: "mutate.set_active",
      primary_tool: "set_active",
      mapper_id: "mutate.set_active",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.rect_layout.anchored_position": {
      family_key: "write.rect_layout.anchored_position",
      primary_tool: "set_rect_anchored_position",
      mapper_id: "write.rect_layout.anchored_position",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.rect_layout.size_delta": {
      family_key: "write.rect_layout.size_delta",
      primary_tool: "set_rect_size_delta",
      mapper_id: "write.rect_layout.size_delta",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.rect_layout.pivot": {
      family_key: "write.rect_layout.pivot",
      primary_tool: "set_rect_pivot",
      mapper_id: "write.rect_layout.pivot",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.rect_layout.anchors": {
      family_key: "write.rect_layout.anchors",
      primary_tool: "set_rect_anchors",
      mapper_id: "write.rect_layout.anchors",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.rect_layout.layout_element": {
      family_key: "write.rect_layout.layout_element",
      primary_tool: "set_layout_element",
      mapper_id: "write.rect_layout.layout_element",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.canvas_group_alpha": {
      family_key: "write.ui_style.canvas_group_alpha",
      primary_tool: "set_canvas_group_alpha",
      mapper_id: "write.ui_style.canvas_group_alpha",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.image_color": {
      family_key: "write.ui_style.image_color",
      primary_tool: "set_ui_image_color",
      mapper_id: "write.ui_style.image_color",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.image_raycast_target": {
      family_key: "write.ui_style.image_raycast_target",
      primary_tool: "set_ui_image_raycast_target",
      mapper_id: "write.ui_style.image_raycast_target",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.text_content": {
      family_key: "write.ui_style.text_content",
      primary_tool: "set_ui_text_content",
      mapper_id: "write.ui_style.text_content",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.text_color": {
      family_key: "write.ui_style.text_color",
      primary_tool: "set_ui_text_color",
      mapper_id: "write.ui_style.text_color",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.ui_style.text_font_size": {
      family_key: "write.ui_style.text_font_size",
      primary_tool: "set_ui_text_font_size",
      mapper_id: "write.ui_style.text_font_size",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.local.position": {
      family_key: "write.transform.local.position",
      primary_tool: "set_local_position",
      mapper_id: "write.transform.local.position",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.local.rotation": {
      family_key: "write.transform.local.rotation",
      primary_tool: "set_local_rotation",
      mapper_id: "write.transform.local.rotation",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.local.scale": {
      family_key: "write.transform.local.scale",
      primary_tool: "set_local_scale",
      mapper_id: "write.transform.local.scale",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.local.reset": {
      family_key: "write.transform.local.reset",
      primary_tool: "reset_transform",
      mapper_id: "write.transform.local.reset",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.world.position": {
      family_key: "write.transform.world.position",
      primary_tool: "set_world_position",
      mapper_id: "write.transform.world.position",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transform.world.rotation": {
      family_key: "write.transform.world.rotation",
      primary_tool: "set_world_rotation",
      mapper_id: "write.transform.world.rotation",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.hierarchy.parent": {
      family_key: "write.hierarchy.parent",
      primary_tool: "set_parent",
      mapper_id: "write.hierarchy.parent",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.hierarchy.sibling_index": {
      family_key: "write.hierarchy.sibling_index",
      primary_tool: "set_sibling_index",
      mapper_id: "write.hierarchy.sibling_index",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.component_lifecycle.add_component": {
      family_key: "write.component_lifecycle.add_component",
      primary_tool: "add_component",
      mapper_id: "write.component_lifecycle.add_component",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.component_lifecycle.remove_component": {
      family_key: "write.component_lifecycle.remove_component",
      primary_tool: "remove_component",
      mapper_id: "write.component_lifecycle.remove_component",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.component_lifecycle.replace_component": {
      family_key: "write.component_lifecycle.replace_component",
      primary_tool: "replace_component",
      mapper_id: "write.component_lifecycle.replace_component",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.object_lifecycle.rename_object": {
      family_key: "write.object_lifecycle.rename_object",
      primary_tool: "rename_object",
      mapper_id: "write.object_lifecycle.rename_object",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.object_lifecycle.delete_object": {
      family_key: "write.object_lifecycle.delete_object",
      primary_tool: "delete_object",
      mapper_id: "write.object_lifecycle.delete_object",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.object_lifecycle.duplicate_object": {
      family_key: "write.object_lifecycle.duplicate_object",
      primary_tool: "duplicate_object",
      mapper_id: "write.object_lifecycle.duplicate_object",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.transaction.execute": {
      family_key: "write.transaction.execute",
      primary_tool: "execute_unity_transaction",
      mapper_id: "write.transaction.execute",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.scene_persistence.save_scene": {
      family_key: "write.scene_persistence.save_scene",
      primary_tool: "save_scene",
      mapper_id: "write.scene_persistence.save_scene",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.scene_persistence.save_prefab": {
      family_key: "write.scene_persistence.save_prefab",
      primary_tool: "save_prefab",
      mapper_id: "write.scene_persistence.save_prefab",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.async_ops.submit_task": {
      family_key: "write.async_ops.submit_task",
      primary_tool: "submit_unity_task",
      mapper_id: "write.async_ops.submit_task",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.async_ops.get_task_status": {
      family_key: "write.async_ops.get_task_status",
      primary_tool: "get_unity_task_status",
      mapper_id: "write.async_ops.get_task_status",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
    "write.async_ops.cancel_task": {
      family_key: "write.async_ops.cancel_task",
      primary_tool: "cancel_unity_task",
      mapper_id: "write.async_ops.cancel_task",
      fallback: {
        mode: "disabled",
        tools: [],
        trigger: "never",
      },
    },
  },
});

const LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE = freezeObject({
  [BLOCK_TYPE.READ_STATE]: {
    get_current_selection: "read.selection.current",
    find_objects_by_component: "read.selection.by_component",
    get_scene_snapshot_for_write: "read.snapshot_for_write",
    get_scene_roots: "read.scene_roots",
    get_gameobject_components: "read.components",
    get_serialized_property_tree: "read.components.serialized_property_tree",
    list_assets_in_folder: "read.assets",
    query_prefab_info: "read.assets.prefab_info",
    get_hierarchy_subtree: "read.hierarchy_subtree",
  },
  [BLOCK_TYPE.CREATE]: {
    create_object: "create.object",
  },
  [BLOCK_TYPE.MUTATE]: {
    set_component_properties: "mutate.component_properties",
    modify_ui_layout: "mutate.ui_layout",
    set_active: "mutate.set_active",
    set_rect_anchored_position: "write.rect_layout.anchored_position",
    set_rect_size_delta: "write.rect_layout.size_delta",
    set_rect_pivot: "write.rect_layout.pivot",
    set_rect_anchors: "write.rect_layout.anchors",
    set_layout_element: "write.rect_layout.layout_element",
    set_canvas_group_alpha: "write.ui_style.canvas_group_alpha",
    set_ui_image_color: "write.ui_style.image_color",
    set_ui_image_raycast_target: "write.ui_style.image_raycast_target",
    set_ui_text_content: "write.ui_style.text_content",
    set_ui_text_color: "write.ui_style.text_color",
    set_ui_text_font_size: "write.ui_style.text_font_size",
    set_local_position: "write.transform.local.position",
    set_local_rotation: "write.transform.local.rotation",
    set_local_scale: "write.transform.local.scale",
    reset_transform: "write.transform.local.reset",
    set_world_position: "write.transform.world.position",
    set_world_rotation: "write.transform.world.rotation",
    set_parent: "write.hierarchy.parent",
    set_sibling_index: "write.hierarchy.sibling_index",
    add_component: "write.component_lifecycle.add_component",
    remove_component: "write.component_lifecycle.remove_component",
    replace_component: "write.component_lifecycle.replace_component",
    rename_object: "write.object_lifecycle.rename_object",
    delete_object: "write.object_lifecycle.delete_object",
    duplicate_object: "write.object_lifecycle.duplicate_object",
    execute_unity_transaction: "write.transaction.execute",
    save_scene: "write.scene_persistence.save_scene",
    save_prefab: "write.scene_persistence.save_prefab",
    submit_unity_task: "write.async_ops.submit_task",
    get_unity_task_status: "write.async_ops.get_task_status",
    cancel_unity_task: "write.async_ops.cancel_task",
  },
});

function buildLegacyConcreteMigrationMatrixByBlockType() {
  const output = {};
  for (const [blockType, legacyMapRaw] of Object.entries(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE
  )) {
    const legacyMap = legacyMapRaw && typeof legacyMapRaw === "object" ? legacyMapRaw : {};
    const blockFamilies = FAMILY_TOOL_MIGRATION_MATRIX[blockType];
    const familyProfiles =
      blockFamilies && typeof blockFamilies === "object" ? blockFamilies : {};
    const blockOutput = {};
    for (const [legacyConcreteKey, familyKeyRaw] of Object.entries(legacyMap)) {
      const legacyKey = normalizeString(legacyConcreteKey);
      const familyKey = normalizeString(familyKeyRaw);
      if (!legacyKey || !familyKey) {
        continue;
      }
      const profile = familyProfiles[familyKey];
      const primaryTool = normalizeString(profile && profile.primary_tool);
      if (!primaryTool) {
        continue;
      }
      blockOutput[legacyKey] = {
        legacy_concrete_key: legacyKey,
        family_key: familyKey,
        concrete_tool: primaryTool,
      };
    }
    output[blockType] = freezeObject(blockOutput);
  }
  return freezeObject(output);
}

function buildFamilyKeyToToolByBlockType() {
  const output = {};
  const matrix = FAMILY_TOOL_MIGRATION_MATRIX;
  for (const [blockType, families] of Object.entries(matrix)) {
    const familyMap = {};
    const sourceFamilies =
      families && typeof families === "object" ? families : {};
    for (const [familyKey, profile] of Object.entries(sourceFamilies)) {
      const toolName = normalizeString(profile && profile.primary_tool);
      if (!toolName) {
        continue;
      }
      familyMap[normalizeString(familyKey)] = toolName;
    }
    output[blockType] = freezeObject(familyMap);
  }
  return freezeObject(output);
}

const FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE = buildFamilyKeyToToolByBlockType();
const LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE =
  buildLegacyConcreteMigrationMatrixByBlockType();

function assertMigrationMatrixConsistency() {
  for (const [blockType, familyMapRaw] of Object.entries(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE
  )) {
    const familyMap = familyMapRaw && typeof familyMapRaw === "object" ? familyMapRaw : {};
    for (const [familyKey, toolNameRaw] of Object.entries(familyMap)) {
      const toolName = normalizeString(toolNameRaw);
      const profile = getFamilyToolProfile(blockType, familyKey);
      if (!toolName || !profile) {
        throw new Error(
          `[FamilyToolMigrationMatrix] invalid family mapping profile: ${blockType}/${familyKey}`
        );
      }
      if (normalizeString(profile.primary_tool) !== toolName) {
        throw new Error(
          `[FamilyToolMigrationMatrix] primary tool drift: ${blockType}/${familyKey} -> ${toolName}`
        );
      }
    }
  }

  for (const [blockType, legacyMapRaw] of Object.entries(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE
  )) {
    const legacyMap = legacyMapRaw && typeof legacyMapRaw === "object" ? legacyMapRaw : {};
    for (const [legacyConcreteKey, familyKeyRaw] of Object.entries(legacyMap)) {
      const legacyConcreteKeyNormalized = normalizeString(legacyConcreteKey);
      const familyKey = normalizeString(familyKeyRaw);
      if (!legacyConcreteKeyNormalized || !familyKey) {
        throw new Error(
          `[FamilyToolMigrationMatrix] invalid legacy mapping key: ${blockType}/${legacyConcreteKey}`
        );
      }
      const toolByFamily = normalizeString(
        FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType] &&
          FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType][familyKey]
      );
      const migrationEntry =
        LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE[blockType] &&
        LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE[blockType][
          legacyConcreteKeyNormalized
        ];
      const toolByLegacyMatrix = normalizeString(
        migrationEntry && migrationEntry.concrete_tool
      );
      if (!toolByFamily || !toolByLegacyMatrix || toolByFamily !== toolByLegacyMatrix) {
        throw new Error(
          `[FamilyToolMigrationMatrix] legacy->family->tool drift: ${blockType}/${legacyConcreteKeyNormalized} -> ${familyKey}`
        );
      }
    }
  }
}

assertMigrationMatrixConsistency();

function getFamilyToolProfile(blockType, familyKey) {
  const normalizedBlockType = normalizeString(blockType);
  const normalizedFamilyKey = normalizeString(familyKey);
  if (!normalizedBlockType || !normalizedFamilyKey) {
    return null;
  }
  const families = FAMILY_TOOL_MIGRATION_MATRIX[normalizedBlockType];
  if (!families || typeof families !== "object") {
    return null;
  }
  const profile = families[normalizedFamilyKey];
  if (!profile || typeof profile !== "object") {
    return null;
  }
  return profile;
}

module.exports = {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  getFamilyToolProfile,
};
