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
    name: "get_ui_overlay_report",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_ui_overlay_report",
      source: "body",
    },
    validate: validateGetUiOverlayReport,
    execute: executeGetUiOverlayReport,
    mcp: {
      expose: true,
      description:
        "Inspect ScreenSpaceOverlay coverage and return structured overlay diagnostics. Use this before screenshot verification to know whether render_output will miss critical UI.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          root_path: {
            type: "string",
            description:
              "Optional hierarchy root path filter. Deprecated alias of scope.root_path.",
          },
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: {
                type: "string",
                description:
                  "Optional hierarchy root path filter for overlay diagnostics.",
              },
            },
          },
          include_inactive: {
            type: "boolean",
            description:
              "Whether inactive overlays and children are included in the report.",
          },
          include_children_summary: {
            type: "boolean",
            description:
              "Whether each overlay canvas includes sampled child element summaries.",
          },
          max_nodes: {
            type: "integer",
            description:
              "Optional global node budget (overlay canvas + child summary nodes, >=1).",
          },
          max_children_per_canvas: {
            type: "integer",
            description:
              "Optional max child summary nodes per overlay canvas (>=1).",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
      },
    },
  };
};
