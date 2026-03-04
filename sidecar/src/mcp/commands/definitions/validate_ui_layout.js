"use strict";

module.exports = function buildDefinition(deps) {
  const {
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
  } = deps;

  return {
    name: "validate_ui_layout",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/validate_ui_layout",
      source: "body",
    },
    validate: validateUiLayout,
    execute: executeValidateUiLayout,
    mcp: {
      expose: true,
      description:
        "Validate UI layout across resolutions and return structured issues (OUT_OF_BOUNDS/OVERLAP/NOT_CLICKABLE/TEXT_OVERFLOW). Optional specialist mode can emit deterministic repair_plan suggestions mapped to Phase-2 primitives.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: { type: "string" },
            },
          },
          resolutions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                width: { type: "integer" },
                height: { type: "integer" },
              },
              required: ["width", "height"],
            },
          },
          checks: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "OUT_OF_BOUNDS",
                "OVERLAP",
                "NOT_CLICKABLE",
                "TEXT_OVERFLOW",
              ],
            },
          },
          max_issues: {
            type: "integer",
            description: "Optional issue cap (>=1).",
          },
          time_budget_ms: {
            type: "integer",
            description: "Optional in-validator budget (>=1).",
          },
          layout_refresh_mode: {
            type: "string",
            enum: ["scoped_roots_only", "full_tree"],
            description: "Layout refresh strategy before checks.",
          },
          include_repair_plan: {
            type: "boolean",
            description:
              "When true, response may include specialist_summary + repair_plan suggestions.",
          },
          max_repair_suggestions: {
            type: "integer",
            description: "Optional cap for repair_plan suggestions (>=1).",
          },
          repair_style: {
            type: "string",
            enum: ["conservative", "balanced", "aggressive"],
            description: "Repair strategy preference used by specialist planner.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
      },
    },
  };
};
