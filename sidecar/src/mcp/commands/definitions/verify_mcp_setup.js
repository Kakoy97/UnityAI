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
    name: "verify_mcp_setup",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/verify_mcp_setup",
      source: "body",
    },
    validate: validateVerifyMcpSetup,
    execute: executeVerifyMcpSetup,
    mcp: {
      expose: true,
      description:
        "Verify Cursor MCP onboarding readiness and return structured diagnostics for native/cline config.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: ["auto", "native", "cline"],
            default: "auto",
            description:
              "auto checks both native and cline config; native/cline checks one mode only.",
          },
        },
      },
    },
  };
};
