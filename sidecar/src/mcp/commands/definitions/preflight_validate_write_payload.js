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
    name: "preflight_validate_write_payload",
    kind: "read",
    lifecycle: "stable",
    http: {
      method: "POST",
      path: "/mcp/preflight_validate_write_payload",
      source: "body",
    },
    validate: validatePreflightValidateWritePayload,
    execute: executePreflightValidateWritePayload,
    mcp: {
      expose: true,
      description:
        "Stable preflight entry: validate + normalize write payloads without Unity dispatch. dry_run remains supported as a deprecated compatibility alias on write tools.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool_name: {
            type: "string",
            enum: [
              "apply_script_actions",
              "apply_visual_actions",
              "set_ui_properties",
            ],
            default: "apply_visual_actions",
            description: "Target write tool name for preflight validation.",
          },
          payload: {
            type: "object",
            description:
              "Exact request payload for the target write tool. Preflight validates this payload and may return normalized_payload/suggested_patch.",
          },
        },
        required: ["payload"],
      },
    },
  };
};
