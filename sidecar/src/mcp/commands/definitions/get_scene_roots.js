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
    name: "get_scene_roots",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_scene_roots", source: "body" },
    turnServiceMethod: "getSceneRootsForMcp",
    validate: validateGetSceneRoots,
    mcp: {
      expose: true,
      description:
        "Get root GameObjects of a loaded scene, including object_id/path anchors. Use this to establish reliable hierarchy anchors before downstream reads or writes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scene_path: {
            type: "string",
            description:
              "Optional scene asset path. If omitted, returns roots across currently loaded scenes.",
          },
          include_inactive: {
            type: "boolean",
            description:
              "Whether inactive roots are included. Default true if omitted.",
          },
        },
      },
    },
  };
};
