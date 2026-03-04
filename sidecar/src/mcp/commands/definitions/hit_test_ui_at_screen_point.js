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
    name: "hit_test_ui_at_screen_point",
    kind: "read",
    lifecycle: "deprecated",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_screen_point",
      source: "body",
    },
    validate: validateHitTestUiAtScreenPoint,
    execute: executeHitTestUiAtScreenPoint,
    mcp: {
      expose: true,
      description:
        "Temporarily disabled in screenshot stabilization closure. Unity runtime dispatch is registry-backed; calls return E_COMMAND_DISABLED. Use get_ui_tree + capture_scene_screenshot(render_output) for verification.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          view_mode: {
            type: "string",
            enum: ["auto", "game"],
            description:
              "Target view for hit testing. auto resolves to Game view.",
          },
          x: {
            type: "integer",
            description:
              "Required x coordinate in screenshot reference space (>=0).",
          },
          y: {
            type: "integer",
            description:
              "Required y coordinate in screenshot reference space (>=0).",
          },
          reference_width: {
            type: "integer",
            description:
              "Reference screenshot width used for coordinate mapping (>=1).",
          },
          reference_height: {
            type: "integer",
            description:
              "Reference screenshot height used for coordinate mapping (>=1).",
          },
          max_results: {
            type: "integer",
            description: "Optional max hit stack size (>=1).",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
        required: ["x", "y"],
      },
    },
  };
};
