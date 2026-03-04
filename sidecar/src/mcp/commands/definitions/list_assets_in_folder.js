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
    name: "list_assets_in_folder",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/list_assets_in_folder", source: "body" },
    turnServiceMethod: "listAssetsInFolderForMcp",
    validate: validateListAssetsInFolder,
    mcp: {
      expose: true,
      description:
        "List project assets under a folder path in Unity AssetDatabase. Use this before guessing file paths or prefab/script locations. When you need to discover candidate assets, call this first instead of assuming names.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          folder_path: {
            type: "string",
            description:
              "Required Unity project folder path, e.g. Assets/Prefabs or Assets/Scripts.",
          },
          recursive: {
            type: "boolean",
            description:
              "Whether to traverse subfolders recursively. Default false if omitted.",
          },
          include_meta: {
            type: "boolean",
            description: "Whether .meta files should be included. Usually false.",
          },
          limit: {
            type: "integer",
            description:
              "Optional max number of returned entries. Must be >= 1.",
          },
        },
        required: ["folder_path"],
      },
    },
  };
};
