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
    name: "query_prefab_info",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/query_prefab_info", source: "body" },
    turnServiceMethod: "queryPrefabInfoForMcp",
    validate: validateQueryPrefabInfo,
    mcp: {
      expose: true,
      description:
        "Inspect prefab tree structure and components with explicit depth budget. When parsing nested prefab hierarchies, call this tool and pass max_depth deliberately based on complexity. Do not guess deep structure without querying it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prefab_path: {
            type: "string",
            description:
              "Required prefab asset path, e.g. Assets/Prefabs/UI/MainPanel.prefab.",
          },
          max_depth: {
            type: "integer",
            description:
              "Required traversal depth budget (>=0). Must be explicitly provided each call.",
          },
          node_budget: {
            type: "integer",
            description: "Optional max node budget (>=1).",
          },
          char_budget: {
            type: "integer",
            description: "Optional output character budget (>=256).",
          },
          include_components: {
            type: "boolean",
            description:
              "Whether component descriptors are included. Default true if omitted.",
          },
          include_missing_scripts: {
            type: "boolean",
            description:
              "Whether missing-script placeholders are included. Default true if omitted.",
          },
        },
        required: ["prefab_path", "max_depth"],
      },
    },
  };
};
