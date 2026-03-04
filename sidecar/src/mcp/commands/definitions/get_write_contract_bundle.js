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
    name: "get_write_contract_bundle",
    kind: "read",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/get_write_contract_bundle", source: "body" },
    validate: validateGetWriteContractBundle,
    execute: executeGetWriteContractBundle,
    mcp: {
      expose: true,
      description:
        "Aggregate write contract guidance in one call: tool contract + action contract + minimal payload template + common error-fix map.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool_name: {
            type: "string",
            description:
              "Optional write tool name. Defaults to apply_visual_actions.",
          },
          action_type: {
            type: "string",
            description:
              "Optional action type for template/action schema. Defaults to rename_object.",
          },
          catalog_version: {
            type: "string",
            description:
              "Optional expected capability catalog_version for cache safety.",
          },
          budget_chars: {
            type: "integer",
            description:
              "Optional response character budget. Sidecar applies bounded trim policy.",
          },
          include_error_fix_map: {
            type: "boolean",
            description: "Optional. Include common error->fix mapping (default true).",
          },
          include_canonical_examples: {
            type: "boolean",
            description: "Optional. Include canonical payload examples (default true).",
          },
        },
      },
    },
  };
};
