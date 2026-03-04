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
    name: "find_objects_by_component",
    kind: "read",
    lifecycle: "stable",
    http: {
      method: "POST",
      path: "/mcp/find_objects_by_component",
      source: "body",
    },
    turnServiceMethod: "findObjectsByComponentForMcp",
    validate: validateFindObjectsByComponent,
    mcp: {
      expose: true,
      description:
        "Find scene objects by component type and return explicit anchors. Use this before writing when you need deterministic targets instead of guessing object names from hierarchy text.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          component_query: {
            type: "string",
            description:
              "Required component search term, e.g. Rigidbody, Button, UnityEngine.UI.Image.",
          },
          scene_path: {
            type: "string",
            description: "Optional scene asset path to narrow search scope.",
          },
          under_path: {
            type: "string",
            description:
              "Optional hierarchy path prefix to constrain search subtree.",
          },
          include_inactive: {
            type: "boolean",
            description:
              "Whether inactive objects are included. Default true if omitted.",
          },
          limit: {
            type: "integer",
            description: "Optional max number of matches. Must be >= 1.",
          },
        },
        required: ["component_query"],
      },
    },
  };
};
