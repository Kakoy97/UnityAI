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
    name: "get_hierarchy_subtree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_hierarchy_subtree",
      source: "body",
    },
    turnServiceMethod: "getHierarchySubtreeForMcp",
    mcp: {
      expose: true,
      description:
        "Read hierarchy subtree from latest selection snapshot target or optional target_anchor override.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          target_anchor: {
            type: "object",
            additionalProperties: false,
            properties: {
              object_id: { type: "string" },
              path: { type: "string" },
            },
            required: ["object_id", "path"],
          },
          depth: {
            type: "integer",
            description: "Optional subtree depth budget (0..3).",
          },
          node_budget: {
            type: "integer",
            description: "Optional max returned nodes (1..2000).",
          },
          char_budget: {
            type: "integer",
            description: "Optional serialized char budget (256..100000).",
          },
        },
      },
    },
  };
};
