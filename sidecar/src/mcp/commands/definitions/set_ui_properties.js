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
    name: "set_ui_properties",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/set_ui_properties", source: "body" },
    execute: executeSetUiProperties,
    mcp: {
      expose: true,
      description:
        "Set common UI properties with a deterministic field-level contract. Internally maps to apply_visual_actions and reuses OCC/read_token, anchor guards, and Unity action handlers. accepted/queued are non-terminal; poll get_unity_task_status until succeeded/failed/cancelled. Use dry_run=true to preview planned_actions_count + mapped_actions without Unity submission.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          based_on_read_token: {
            type: "string",
            description:
              "Read token from MCP eyes tools. Required for every write request.",
          },
          write_anchor: {
            type: "object",
            description:
              "Top-level write anchor. Must contain both object_id and path.",
            additionalProperties: false,
            properties: {
              object_id: { type: "string" },
              path: { type: "string" },
            },
            required: ["object_id", "path"],
          },
          operations: {
            type: "array",
            description:
              "Ordered UI property operations. Mapping is deterministic and preserves operation order.",
            items: {
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
                rect_transform: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    anchored_position: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                    },
                    size_delta: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                    },
                    pivot: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                    },
                    anchors: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        min_x: { type: "number" },
                        min_y: { type: "number" },
                        max_x: { type: "number" },
                        max_y: { type: "number" },
                      },
                      required: ["min_x", "min_y", "max_x", "max_y"],
                    },
                  },
                },
                image: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    color: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        r: { type: "number" },
                        g: { type: "number" },
                        b: { type: "number" },
                        a: { type: "number" },
                      },
                      required: ["r", "g", "b", "a"],
                    },
                    raycast_target: { type: "boolean" },
                  },
                },
                text: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    content: { type: "string" },
                    color: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        r: { type: "number" },
                        g: { type: "number" },
                        b: { type: "number" },
                        a: { type: "number" },
                      },
                      required: ["r", "g", "b", "a"],
                    },
                    font_size: { type: "number" },
                  },
                },
                layout_element: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "min_width",
                    "min_height",
                    "preferred_width",
                    "preferred_height",
                    "flexible_width",
                    "flexible_height",
                    "ignore_layout",
                  ],
                  properties: {
                    min_width: { type: "number" },
                    min_height: { type: "number" },
                    preferred_width: { type: "number" },
                    preferred_height: { type: "number" },
                    flexible_width: { type: "number" },
                    flexible_height: { type: "number" },
                    ignore_layout: { type: "boolean" },
                  },
                },
              },
              required: ["target_anchor"],
              anyOf: [
                { required: ["rect_transform"] },
                { required: ["image"] },
                { required: ["text"] },
                { required: ["layout_element"] },
              ],
            },
          },
          atomic: {
            type: "boolean",
            description:
              "If true and multiple mapped actions are produced, wraps them into composite_visual_action(all_or_nothing).",
          },
          preconditions: {
            type: "array",
            description:
              "Optional preconditions: object_exists/component_exists/compile_idle.",
            items: {
              type: "object",
            },
          },
          dry_run: {
            type: "boolean",
            description:
              "If true, return planned_actions_count + mapped_actions only, and skip Unity submission.",
          },
          thread_id: {
            type: "string",
            description: "Optional thread id override.",
          },
          idempotency_key: {
            type: "string",
            description: "Optional idempotency key override.",
          },
          user_intent: {
            type: "string",
            description: "Optional user intent for async job traceability.",
          },
          approval_mode: {
            type: "string",
            enum: ["auto", "require_user"],
            description: "Optional approval mode. Default auto.",
          },
        },
        required: ["based_on_read_token", "write_anchor", "operations"],
      },
    },
  };
};
