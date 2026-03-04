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
    name: "get_ui_tree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_ui_tree",
      source: "body",
    },
    validate: validateGetUiTree,
    execute: executeGetUiTree,
    mcp: {
      expose: true,
      description:
        "Read structured UI tree for deterministic targeting before visual writes. Unity runtime dispatch is registry-backed. Use this before screenshot-based verification.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ui_system: {
            type: "string",
            enum: ["auto", "ugui", "uitk"],
            description:
              "UI system to inspect. auto lets Unity choose the best available provider.",
          },
          root_path: {
            type: "string",
            description:
              "Optional hierarchy root path filter to limit returned subtree. Deprecated alias of scope.root_path.",
          },
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: {
                type: "string",
                description:
                  "Optional hierarchy root path filter to limit returned subtree.",
              },
            },
          },
          include_inactive: {
            type: "boolean",
            description:
              "Whether inactive UI nodes are included in output.",
          },
          include_components: {
            type: "boolean",
            description:
              "Whether key UI component summaries (Image/Text/Button/Layout) are included.",
          },
          include_layout: {
            type: "boolean",
            description:
              "Whether resolved layout/RectTransform detail is included when available.",
          },
          include_interaction: {
            type: "boolean",
            description:
              "Whether interaction summary (interactable/raycast/blocks_raycast) is included.",
          },
          include_text_metrics: {
            type: "boolean",
            description:
              "Whether text overflow/preferred size metrics are included.",
          },
          max_depth: {
            type: "integer",
            description: "Optional max depth budget (>=0).",
          },
          node_budget: {
            type: "integer",
            description: "Optional max node budget (>=1).",
          },
          char_budget: {
            type: "integer",
            description: "Optional serialized output char budget (>=256).",
          },
          resolution: {
            type: "object",
            additionalProperties: false,
            properties: {
              width: {
                type: "integer",
                description: "Optional requested runtime width (>=1).",
              },
              height: {
                type: "integer",
                description: "Optional requested runtime height (>=1).",
              },
            },
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
