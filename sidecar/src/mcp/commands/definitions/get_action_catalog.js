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
    name: "get_action_catalog",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_action_catalog", source: "body" },
    validate: validateGetActionCatalog,
    execute: executeGetActionCatalog,
    mcp: {
      expose: true,
      description:
        "Get paged action capability index for domain/tier/lifecycle filters. Use this before get_action_schema when tool hints are truncated.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: {
            type: "string",
            description: "Optional domain filter, e.g. ui/component/transform.",
          },
          tier: {
            type: "string",
            description: "Optional tier filter, e.g. core/advanced/experimental.",
          },
          lifecycle: {
            type: "string",
            description: "Optional lifecycle filter, e.g. stable/deprecated.",
          },
          cursor: {
            type: "integer",
            description: "Optional page cursor (>= 0).",
          },
          limit: {
            type: "integer",
            description: "Optional page size (>=1, max enforced by sidecar).",
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
      },
    },
  };
};
