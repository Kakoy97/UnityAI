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
    name: "get_serialized_property_tree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_serialized_property_tree",
      source: "body",
    },
    validate: validateGetSerializedPropertyTree,
    execute: executeGetSerializedPropertyTree,
    mcp: {
      expose: true,
      description:
        "Read SerializedProperty tree lazily for one or more components on the same target. Supports depth/page/node/char budgets, cursor paging for single-component mode, and node-level llm_hint/common_use fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          target_anchor: {
            type: "object",
            description:
              "Target GameObject anchor containing the component instance to inspect.",
            additionalProperties: false,
            properties: {
              object_id: { type: "string" },
              path: { type: "string" },
            },
            required: ["object_id", "path"],
          },
          component_selector: {
            type: "object",
            description:
              "Component selector on target_anchor. component_index defaults to 0.",
            additionalProperties: false,
            properties: {
              component_assembly_qualified_name: {
                type: "string",
                description: "Assembly qualified component type name.",
              },
              component_index: {
                type: "integer",
                minimum: 0,
                description: "Zero-based index when multiple components share type.",
              },
            },
            required: ["component_assembly_qualified_name"],
          },
          component_selectors: {
            type: "array",
            description:
              "Optional multi-component selectors on the same target_anchor (max 8). When used with more than one selector, after_property_path is disabled in this phase.",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                component_assembly_qualified_name: {
                  type: "string",
                  description: "Assembly qualified component type name.",
                },
                component_index: {
                  type: "integer",
                  minimum: 0,
                  description: "Zero-based index when multiple components share type.",
                },
              },
              required: ["component_assembly_qualified_name"],
            },
          },
          root_property_path: {
            type: "string",
            description:
              "Optional root property path. Empty string means component root.",
          },
          depth: {
            type: "integer",
            minimum: 0,
            description: "Max relative traversal depth from root_property_path.",
          },
          after_property_path: {
            type: "string",
            description:
              "Cursor path for paging. Response next_cursor should be fed back here.",
          },
          page_size: {
            type: "integer",
            minimum: 1,
            description: "Max nodes returned for current page.",
          },
          node_budget: {
            type: "integer",
            minimum: 1,
            description: "Hard cap for returned nodes.",
          },
          char_budget: {
            type: "integer",
            minimum: 256,
            description: "Approx serialized char budget for response payload.",
          },
          include_value_summary: {
            type: "boolean",
            description: "Include compact value summaries per node when true.",
          },
          include_non_visible: {
            type: "boolean",
            description: "Include non-visible serialized fields when true.",
          },
          timeout_ms: {
            type: "integer",
            minimum: 1000,
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
        required: ["target_anchor"],
        anyOf: [{ required: ["component_selector"] }, { required: ["component_selectors"] }],
      },
    },
  };
};
