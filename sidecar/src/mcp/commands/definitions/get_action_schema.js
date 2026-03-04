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
    name: "get_action_schema",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_action_schema", source: "body" },
    validate: validateGetActionSchema,
    execute: executeGetActionSchema,
    mcp: {
      expose: true,
      description:
        "Get the detailed action_data schema for one visual action type. Use this when apply_visual_actions fails with payload/schema errors or when you need exact parameter fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action_type: {
            type: "string",
            description: "Visual action type name, e.g. set_ui_image_color.",
          },
          catalog_version: {
            type: "string",
            description:
              "Optional expected capability catalog_version for cache safety.",
          },
          if_none_match: {
            type: "string",
            description: "Optional ETag token for cache revalidation.",
          },
        },
        required: ["action_type"],
      },
    },
  };
};
