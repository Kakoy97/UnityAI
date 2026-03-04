"use strict";

const {
  validateGetActionCatalog,
} = require("./get_action_catalog/validator");
const {
  executeGetActionCatalog,
} = require("./get_action_catalog/handler");
const { validateGetActionSchema } = require("./get_action_schema/validator");
const {
  executeGetActionSchema,
} = require("./get_action_schema/handler");
const { validateGetToolSchema } = require("./get_tool_schema/validator");
const {
  executeGetToolSchema,
} = require("./get_tool_schema/handler");
const {
  validateGetWriteContractBundle,
} = require("./get_write_contract_bundle/validator");
const {
  executeGetWriteContractBundle,
} = require("./get_write_contract_bundle/handler");
const {
  validatePreflightValidateWritePayload,
} = require("./preflight_validate_write_payload/validator");
const {
  executePreflightValidateWritePayload,
} = require("./preflight_validate_write_payload/handler");
const {
  validateSetupCursorMcp,
} = require("./setup_cursor_mcp/validator");
const {
  executeSetupCursorMcp,
} = require("./setup_cursor_mcp/handler");
const {
  validateVerifyMcpSetup,
} = require("./verify_mcp_setup/validator");
const {
  executeVerifyMcpSetup,
} = require("./verify_mcp_setup/handler");
const {
  validateListAssetsInFolder,
} = require("./list_assets_in_folder/validator");
const { validateGetSceneRoots } = require("./get_scene_roots/validator");
const {
  validateFindObjectsByComponent,
} = require("./find_objects_by_component/validator");
const { validateQueryPrefabInfo } = require("./query_prefab_info/validator");
const {
  validateCaptureSceneScreenshot,
} = require("./capture_scene_screenshot/validator");
const {
  executeCaptureSceneScreenshot,
} = require("./capture_scene_screenshot/handler");
const {
  validateGetUiOverlayReport,
} = require("./get_ui_overlay_report/validator");
const {
  executeGetUiOverlayReport,
} = require("./get_ui_overlay_report/handler");
const { validateGetUiTree } = require("./get_ui_tree/validator");
const { executeGetUiTree } = require("./get_ui_tree/handler");
const {
  validateGetSerializedPropertyTree,
} = require("./get_serialized_property_tree/validator");
const {
  executeGetSerializedPropertyTree,
} = require("./get_serialized_property_tree/handler");
const {
  validateHitTestUiAtViewportPoint,
} = require("./hit_test_ui_at_viewport_point/validator");
const {
  executeHitTestUiAtViewportPoint,
} = require("./hit_test_ui_at_viewport_point/handler");
const { validateUiLayout } = require("./validate_ui_layout/validator");
const { executeValidateUiLayout } = require("./validate_ui_layout/handler");
const {
  executeSetUiProperties,
} = require("./set_ui_properties/handler");
const {
  executeSetSerializedProperty,
} = require("./set_serialized_property/handler");
const {
  validateHitTestUiAtScreenPoint,
} = require("./hit_test_ui_at_screen_point/validator");
const {
  executeHitTestUiAtScreenPoint,
} = require("./hit_test_ui_at_screen_point/handler");

function normalizeBody(body) {
  return body && typeof body === "object" ? body : {};
}

function buildVisualActionsDescription(ctx) {
  const context = ctx && typeof ctx === "object" ? ctx : {};
  const hint =
    typeof context.visualActionHint === "string"
      ? context.visualActionHint.trim()
      : "";
  const base =
    "Apply structured Unity visual actions. Hard requirements: based_on_read_token + write_anchor(object_id+path) + action_data object payloads. Recommended shortest sequence: get_current_selection -> apply_visual_actions -> get_unity_task_status(until succeeded/failed/cancelled). accepted/queued are submission states, not success. Anchor decision table: create_object => parent_anchor; set_parent => target_anchor + parent_anchor; rename_object/set_active => target_anchor. Validation-only flows should use stable preflight_validate_write_payload; dry_run on write tools is a deprecated compatibility alias. Use get_action_catalog/get_action_schema for action DTO and get_tool_schema for full envelope.";
  return hint ? `${base} ${hint}` : base;
}

function readEnvBoolean(name, fallback) {
  const raw = process && process.env ? process.env[name] : undefined;
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return fallback;
}

function isCompositeCaptureEnabledForManifest(ctx) {
  const context = ctx && typeof ctx === "object" ? ctx : {};
  if (typeof context.captureCompositeEnabled === "boolean") {
    return context.captureCompositeEnabled;
  }
  return readEnvBoolean("CAPTURE_COMPOSITE_ENABLED", false);
}

function buildCaptureSceneScreenshotDescription(ctx) {
  if (isCompositeCaptureEnabledForManifest(ctx)) {
    return (
      "Capture Unity visual output for verification. Unity runtime dispatch is registry-backed. " +
      "capture_mode supports render_output (stable) and composite (diagnostic synthesis; PlayMode-only on Unity side). " +
      "final_pixels/editor_view remain disabled and return E_CAPTURE_MODE_DISABLED."
    );
  }
  return (
    "Capture Unity visual output for verification. Unity runtime dispatch is registry-backed. " +
    "Current stable mode is capture_mode=render_output only. capture_mode=composite is feature-flagged and currently disabled. " +
    "final_pixels/editor_view are disabled and return E_CAPTURE_MODE_DISABLED."
  );
}

function validateGetUnityTaskStatusArgs(args) {
  const body = normalizeBody(args);
  const jobId =
    typeof body.job_id === "string" ? String(body.job_id).trim() : "";
  if (!jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id query parameter is required",
      statusCode: 400,
    };
  }
  return { ok: true };
}

const definitionBuilders = require("./definitions");

const COMMAND_DEFINITION_DEPS = Object.freeze({
  validateGetActionCatalog,
  executeGetActionCatalog,
  validateGetActionSchema,
  executeGetActionSchema,
  validateGetToolSchema,
  executeGetToolSchema,
  validateGetWriteContractBundle,
  executeGetWriteContractBundle,
  validatePreflightValidateWritePayload,
  executePreflightValidateWritePayload,
  validateSetupCursorMcp,
  executeSetupCursorMcp,
  validateVerifyMcpSetup,
  executeVerifyMcpSetup,
  validateListAssetsInFolder,
  validateGetSceneRoots,
  validateFindObjectsByComponent,
  validateQueryPrefabInfo,
  validateCaptureSceneScreenshot,
  executeCaptureSceneScreenshot,
  validateGetUiOverlayReport,
  executeGetUiOverlayReport,
  validateGetUiTree,
  executeGetUiTree,
  validateGetSerializedPropertyTree,
  executeGetSerializedPropertyTree,
  validateHitTestUiAtViewportPoint,
  executeHitTestUiAtViewportPoint,
  validateUiLayout,
  executeValidateUiLayout,
  executeSetUiProperties,
  executeSetSerializedProperty,
  validateHitTestUiAtScreenPoint,
  executeHitTestUiAtScreenPoint,
  normalizeBody,
  buildVisualActionsDescription,
  readEnvBoolean,
  isCompositeCaptureEnabledForManifest,
  buildCaptureSceneScreenshotDescription,
  validateGetUnityTaskStatusArgs,
});

const MCP_COMMAND_DEFINITIONS = Object.freeze(
  definitionBuilders.map((buildDefinition) =>
    buildDefinition(COMMAND_DEFINITION_DEPS),
  ),
);

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};
