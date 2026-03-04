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
    name: "set_serialized_property",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_serialized_property", source: "body" },
    execute: executeSetSerializedProperty,
    mcp: {
      expose: true,
      description:
        "Generic SerializedProperty write action. Converts patch payload to apply_visual_actions(set_serialized_property) and reuses OCC/read_token, write_anchor, and atomic rollback guarantees. accepted/queued are non-terminal; poll get_unity_task_status until succeeded/failed/cancelled.",
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
          target_anchor: {
            type: "object",
            description:
              "Target GameObject anchor where the component instance is resolved.",
            additionalProperties: false,
            properties: {
              object_id: { type: "string" },
              path: { type: "string" },
            },
            required: ["object_id", "path"],
          },
          component_selector: {
            type: "object",
            additionalProperties: false,
            description:
              "Component selector on target_anchor. component_index defaults to 0.",
            properties: {
              component_assembly_qualified_name: {
                type: "string",
                description: "Assembly qualified component type name.",
              },
              component_index: {
                type: "integer",
                minimum: 0,
                description: "Zero-based match index when multiple components share type.",
              },
            },
            required: ["component_assembly_qualified_name"],
          },
          patches: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            description:
              "Ordered SerializedProperty patches. value_kind controls which value field is required.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                property_path: {
                  type: "string",
                  description: "SerializedProperty path, e.g. m_Color or m_Offsets.Array.size.",
                },
                value_kind: {
                  type: "string",
                  enum: [
                    "integer",
                    "float",
                    "string",
                    "bool",
                    "enum",
                    "quaternion",
                    "vector4",
                    "vector2",
                    "vector3",
                    "rect",
                    "color",
                    "array",
                    "animation_curve",
                    "object_reference",
                  ],
                },
                op: {
                  type: "string",
                  enum: ["set", "insert", "remove", "clear"],
                  description:
                    "Array operation selector when value_kind=array. Defaults to set.",
                },
                index: {
                  type: "integer",
                  minimum: 0,
                  description:
                    "Array index for op=insert and single-index op=remove.",
                },
                indices: {
                  type: "array",
                  description:
                    "Array indices for batch op=remove. Applied in descending order.",
                  items: {
                    type: "integer",
                    minimum: 0,
                  },
                },
                int_value: { type: "integer" },
                float_value: { type: "number" },
                string_value: { type: "string" },
                bool_value: { type: "boolean" },
                enum_value: { type: "integer" },
                enum_name: { type: "string" },
                quaternion_value: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    z: { type: "number" },
                    w: { type: "number" },
                  },
                  required: ["x", "y", "z", "w"],
                },
                vector4_value: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    z: { type: "number" },
                    w: { type: "number" },
                  },
                  required: ["x", "y", "z", "w"],
                },
                vector2_value: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                  },
                  required: ["x", "y"],
                },
                vector3_value: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    z: { type: "number" },
                  },
                  required: ["x", "y", "z"],
                },
                color_value: {
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
                rect_value: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                  },
                  required: ["x", "y", "width", "height"],
                },
                array_size: {
                  type: "integer",
                  minimum: 0,
                },
                animation_curve_value: {
                  type: "object",
                  description:
                    "Reserved payload for animation_curve. Current phase enforces read-only restriction.",
                },
                object_ref: {
                  type: "object",
                  additionalProperties: false,
                  description:
                    "Object reference payload (scene_anchor or asset_guid/asset_path). Full resolver is introduced in follow-up phase.",
                  properties: {
                    scene_anchor: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        object_id: { type: "string" },
                        path: { type: "string" },
                      },
                      required: ["object_id", "path"],
                    },
                    asset_guid: { type: "string" },
                    asset_path: { type: "string" },
                    sub_asset_name: { type: "string" },
                  },
                },
              },
              required: ["property_path", "value_kind"],
            },
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
              "If true, run Unity-side validation only and return per-patch summary without persisting changes.",
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
        required: [
          "based_on_read_token",
          "write_anchor",
          "target_anchor",
          "component_selector",
          "patches",
        ],
      },
    },
  };
};
