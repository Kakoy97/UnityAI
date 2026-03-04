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
    name: "hit_test_ui_at_viewport_point",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_viewport_point",
      source: "body",
    },
    validate: validateHitTestUiAtViewportPoint,
    execute: executeHitTestUiAtViewportPoint,
    mcp: {
      expose: true,
      description:
        "Hit test UGUI from deterministic viewport coordinates. Supports viewport_px/normalized input and returns mapped_point with runtime_resolution/runtime_source.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          view: {
            type: "string",
            enum: ["game"],
            description: "Target view. V1 supports game view only.",
          },
          coord_space: {
            type: "string",
            enum: ["viewport_px", "normalized"],
            description:
              "Coordinate input space. viewport_px uses resolution pixels; normalized uses [0,1].",
          },
          coord_origin: {
            type: "string",
            enum: ["bottom_left", "top_left"],
            description:
              "Input coordinate origin. Response always includes normalized mapped_point context.",
          },
          x: {
            type: "number",
            description: "Required x coordinate.",
          },
          y: {
            type: "number",
            description: "Required y coordinate.",
          },
          resolution: {
            type: "object",
            additionalProperties: false,
            properties: {
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["width", "height"],
          },
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: { type: "string" },
            },
          },
          max_results: {
            type: "integer",
            description: "Optional max hit stack size (>=1).",
          },
          include_non_interactable: {
            type: "boolean",
            description:
              "Whether non-interactable candidates are included in hit stack.",
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
