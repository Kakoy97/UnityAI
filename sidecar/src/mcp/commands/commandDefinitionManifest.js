"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  validateGetActionCatalog,
} = require("./get_action_catalog/validator");
const { validateGetActionSchema } = require("./get_action_schema/validator");
const { validateGetToolSchema } = require("./get_tool_schema/validator");
const {
  validateGetWriteContractBundle,
} = require("./get_write_contract_bundle/validator");
const {
  validatePreflightValidateWritePayload,
} = require("./preflight_validate_write_payload/validator");
const {
  validateSetupCursorMcp,
} = require("./setup_cursor_mcp/validator");
const {
  validateVerifyMcpSetup,
} = require("./verify_mcp_setup/validator");
const {
  validateListAssetsInFolder,
} = require("./list_assets_in_folder/validator");
const {
  validateModifyUiLayout,
} = require("./modify_ui_layout/validator");
const {
  validateSetComponentProperties,
} = require("./set_component_properties/validator");
const {
  validateGetCurrentSelection,
} = require("./get_current_selection/validator");
const {
  validateGetGameobjectComponents,
} = require("./get_gameobject_components/validator");
const {
  validateGetHierarchySubtree,
} = require("./get_hierarchy_subtree/validator");
const {
  validateGetSceneSnapshotForWrite,
} = require("./get_scene_snapshot_for_write/validator");
const { validateGetSceneRoots } = require("./get_scene_roots/validator");
const {
  validateFindObjectsByComponent,
} = require("./find_objects_by_component/validator");
const { validateQueryPrefabInfo } = require("./query_prefab_info/validator");
const {
  validateCaptureSceneScreenshot,
} = require("./capture_scene_screenshot/validator");
const {
  validateGetUiOverlayReport,
} = require("./get_ui_overlay_report/validator");
const { validateGetUiTree } = require("./get_ui_tree/validator");
const {
  validateGetSerializedPropertyTree,
} = require("./get_serialized_property_tree/validator");
const {
  validateHitTestUiAtViewportPoint,
} = require("./hit_test_ui_at_viewport_point/validator");
const { validateUiLayout } = require("./validate_ui_layout/validator");
const {
  validateApplyVisualActions,
} = require("./apply_visual_actions/validator");
const {
  validateSetUiProperties,
} = require("./set_ui_properties/validator");
const {
  validateAddComponent,
} = require("./add_component/validator");
const {
  validateRemoveComponent,
} = require("./remove_component/validator");
const {
  validateDuplicateObject,
} = require("./duplicate_object/validator");
const {
  validateReplaceComponent,
} = require("./replace_component/validator");
const {
  validateSetLocalPosition,
} = require("./set_local_position/validator");
const {
  validateSetLocalRotation,
} = require("./set_local_rotation/validator");
const {
  validateSetLocalScale,
} = require("./set_local_scale/validator");
const {
  validateSetWorldPosition,
} = require("./set_world_position/validator");
const {
  validateSetWorldRotation,
} = require("./set_world_rotation/validator");
const {
  validateResetTransform,
} = require("./reset_transform/validator");
const {
  validateSetRectAnchoredPosition,
} = require("./set_rect_anchored_position/validator");
const {
  validateSetRectSizeDelta,
} = require("./set_rect_size_delta/validator");
const {
  validateSetRectPivot,
} = require("./set_rect_pivot/validator");
const {
  validateSetRectAnchors,
} = require("./set_rect_anchors/validator");
const {
  validateSetCanvasGroupAlpha,
} = require("./set_canvas_group_alpha/validator");
const {
  validateSetLayoutElement,
} = require("./set_layout_element/validator");
const {
  validateSetUiImageColor,
} = require("./set_ui_image_color/validator");
const {
  validateSetUiImageRaycastTarget,
} = require("./set_ui_image_raycast_target/validator");
const {
  validateSetUiTextContent,
} = require("./set_ui_text_content/validator");
const {
  validateSetUiTextColor,
} = require("./set_ui_text_color/validator");
const {
  validateSetUiTextFontSize,
} = require("./set_ui_text_font_size/validator");
const {
  validateExecuteUnityTransaction,
} = require("./execute_unity_transaction/validator");
const {
  validateCreateObject,
} = require("./create_object/validator");
const {
  validateDeleteObject,
} = require("./delete_object/validator");
const {
  validateRenameObject,
} = require("./rename_object/validator");
const {
  validateSetActive,
} = require("./set_active/validator");
const {
  validateSetParent,
} = require("./set_parent/validator");
const {
  validateSetSiblingIndex,
} = require("./set_sibling_index/validator");
const {
  validateSetSerializedProperty,
} = require("./set_serialized_property/validator");
const {
  validateHitTestUiAtScreenPoint,
} = require("./hit_test_ui_at_screen_point/validator");
const {
  validateGetUnityTaskStatus,
} = require("./get_unity_task_status/validator");
const {
  validateCancelUnityTask,
} = require("./cancel_unity_task/validator");
const {
  validateSubmitUnityTask,
} = require("./submit_unity_task/validator");
const {
  validateApplyScriptActions,
} = require("./apply_script_actions/validator");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

let ssotToolCatalogCache = null;

function loadSsotToolCatalog() {
  if (ssotToolCatalogCache) {
    return ssotToolCatalogCache;
  }

  const artifactPath = path.resolve(
    __dirname,
    "../../../../ssot/artifacts/l2/mcp-tools.generated.json",
  );
  const raw = fs.readFileSync(artifactPath, "utf8");
  const parsed = JSON.parse(raw);

  const tools = Array.isArray(parsed && parsed.tools) ? parsed.tools : [];
  if (tools.length === 0) {
    throw new Error(
      `SSOT tool catalog is empty or invalid at ${artifactPath}; refusing legacy fallback`
    );
  }
  const byName = new Map();
  for (const item of tools) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const toolName =
      typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
    if (!toolName) {
      continue;
    }
    byName.set(toolName, item);
  }

  ssotToolCatalogCache = { byName };
  return ssotToolCatalogCache;
}

function getSsotInputSchemaForTool(toolName) {
  const normalizedToolName =
    typeof toolName === "string" ? toolName.trim() : "";
  if (!normalizedToolName) {
    throw new Error("SSOT tool name is required to resolve input schema");
  }

  const catalog = loadSsotToolCatalog();
  const match = catalog.byName.get(normalizedToolName);
  if (!match || !match.inputSchema || typeof match.inputSchema !== "object") {
    throw new Error(
      `Missing SSOT input schema for tool '${normalizedToolName}' in compiled catalog`
    );
  }

  return cloneJson(match.inputSchema);
}

function getSsotToolDescriptionForTool(toolName, fallbackDescription) {
  const normalizedToolName =
    typeof toolName === "string" ? toolName.trim() : "";
  if (!normalizedToolName) {
    throw new Error("SSOT tool name is required to resolve description");
  }

  const catalog = loadSsotToolCatalog();
  const match = catalog.byName.get(normalizedToolName);
  if (
    !match ||
    typeof match.description !== "string" ||
    !match.description.trim()
  ) {
    throw new Error(
      `Missing SSOT description for tool '${normalizedToolName}' in compiled catalog`
    );
  }

  return match.description.trim();
}

function getSsotToolLifecycleForTool(toolName, fallbackLifecycle) {
  const normalizedToolName =
    typeof toolName === "string" ? toolName.trim() : "";
  if (!normalizedToolName) {
    throw new Error("SSOT tool name is required to resolve lifecycle");
  }

  const catalog = loadSsotToolCatalog();
  const match = catalog.byName.get(normalizedToolName);
  if (!match || typeof match.lifecycle !== "string" || !match.lifecycle.trim()) {
    if (typeof fallbackLifecycle === "string" && fallbackLifecycle.trim()) {
      return fallbackLifecycle.trim().toLowerCase();
    }
    throw new Error(
      `Missing SSOT lifecycle for tool '${normalizedToolName}' in compiled catalog`
    );
  }

  return match.lifecycle.trim().toLowerCase();
}

const definitionBuilders = require("./definitions");

const COMMAND_DEFINITION_DEPS = Object.freeze({
  validateGetActionCatalog,
  validateGetActionSchema,
  validateGetToolSchema,
  validateGetWriteContractBundle,
  validatePreflightValidateWritePayload,
  validateSetupCursorMcp,
  validateVerifyMcpSetup,
  validateListAssetsInFolder,
  validateModifyUiLayout,
  validateSetComponentProperties,
  validateGetSceneSnapshotForWrite,
  validateGetSceneRoots,
  validateFindObjectsByComponent,
  validateQueryPrefabInfo,
  validateCaptureSceneScreenshot,
  validateGetUiOverlayReport,
  validateGetUiTree,
  validateGetSerializedPropertyTree,
  validateHitTestUiAtViewportPoint,
  validateUiLayout,
  validateApplyVisualActions,
  validateSetUiProperties,
  validateAddComponent,
  validateRemoveComponent,
  validateDuplicateObject,
  validateReplaceComponent,
  validateSetLocalPosition,
  validateSetLocalRotation,
  validateSetLocalScale,
  validateSetWorldPosition,
  validateSetWorldRotation,
  validateResetTransform,
  validateSetRectAnchoredPosition,
  validateSetRectSizeDelta,
  validateSetRectPivot,
  validateSetRectAnchors,
  validateSetCanvasGroupAlpha,
  validateSetLayoutElement,
  validateSetUiImageColor,
  validateSetUiImageRaycastTarget,
  validateSetUiTextContent,
  validateSetUiTextColor,
  validateSetUiTextFontSize,
  validateExecuteUnityTransaction,
  validateCreateObject,
  validateDeleteObject,
  validateRenameObject,
  validateSetActive,
  validateSetParent,
  validateSetSiblingIndex,
  validateGetCurrentSelection,
  validateGetGameobjectComponents,
  validateGetHierarchySubtree,
  validateCancelUnityTask,
  validateSubmitUnityTask,
  validateApplyScriptActions,
  validateSetSerializedProperty,
  validateHitTestUiAtScreenPoint,
  validateGetUnityTaskStatus,
  getSsotInputSchemaForTool,
  getSsotToolDescriptionForTool,
  getSsotToolLifecycleForTool,
});

const MCP_COMMAND_DEFINITIONS = Object.freeze(
  definitionBuilders.map((buildDefinition) => {
    const definition = buildDefinition(COMMAND_DEFINITION_DEPS);
    return Object.freeze({
      ...definition,
      lifecycle: getSsotToolLifecycleForTool(
        definition && definition.name,
        definition && definition.lifecycle
      ),
    });
  })
);

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};
