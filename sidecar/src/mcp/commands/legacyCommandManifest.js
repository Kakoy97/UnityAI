"use strict";

const {
  validateGetActionCatalog,
} = require("./get_action_catalog/validator");
const {
  executeGetActionCatalog,
} = require("./get_action_catalog/handler");
const { validateGetActionSchema } = require("./get_action_schema/validator");
const {
  executeGetActionSchema,
} = require("./get_action_schema/handler");
const { validateGetToolSchema } = require("./get_tool_schema/validator");
const {
  executeGetToolSchema,
} = require("./get_tool_schema/handler");
const {
  validateListAssetsInFolder,
} = require("./list_assets_in_folder/validator");
const { validateGetSceneRoots } = require("./get_scene_roots/validator");
const {
  validateFindObjectsByComponent,
} = require("./find_objects_by_component/validator");
const { validateQueryPrefabInfo } = require("./query_prefab_info/validator");
const {
  validateCaptureSceneScreenshot,
} = require("./capture_scene_screenshot/validator");
const {
  executeCaptureSceneScreenshot,
} = require("./capture_scene_screenshot/handler");
const { validateGetUiTree } = require("./get_ui_tree/validator");
const { executeGetUiTree } = require("./get_ui_tree/handler");
const {
  validateGetSerializedPropertyTree,
} = require("./get_serialized_property_tree/validator");
const {
  executeGetSerializedPropertyTree,
} = require("./get_serialized_property_tree/handler");
const {
  validateHitTestUiAtViewportPoint,
} = require("./hit_test_ui_at_viewport_point/validator");
const {
  executeHitTestUiAtViewportPoint,
} = require("./hit_test_ui_at_viewport_point/handler");
const { validateUiLayout } = require("./validate_ui_layout/validator");
const { executeValidateUiLayout } = require("./validate_ui_layout/handler");
const {
  executeSetUiProperties,
} = require("./set_ui_properties/handler");
const {
  executeSetSerializedProperty,
} = require("./set_serialized_property/handler");
const {
  validateHitTestUiAtScreenPoint,
} = require("./hit_test_ui_at_screen_point/validator");
const {
  executeHitTestUiAtScreenPoint,
} = require("./hit_test_ui_at_screen_point/handler");

function normalizeBody(body) {
  return body && typeof body === "object" ? body : {};
}

function buildVisualActionsDescription(ctx) {
  const context = ctx && typeof ctx === "object" ? ctx : {};
  const hint =
    typeof context.visualActionHint === "string"
      ? context.visualActionHint.trim()
      : "";
  const base =
    "Apply structured Unity visual actions. Hard requirements: based_on_read_token + top-level write_anchor(object_id+path). Use action_data as the primary payload carrier. Prefer Phase-2 primitive names (create_object/destroy_object/rename_object/set_active/set_parent/set_sibling_index/duplicate_object/set_local_position/set_local_rotation/set_local_scale/set_world_position/set_world_rotation/reset_transform/set_rect_anchored_position/set_rect_size_delta/set_rect_pivot/set_rect_anchors). Legacy *_gameobject and set_transform_*/set_rect_transform_* names are deprecated aliases. Use get_action_catalog/get_action_schema for action DTO schema and get_tool_schema for full tool contract.";
  return hint ? `${base} ${hint}` : base;
}

function validateGetUnityTaskStatusArgs(args) {
  const body = normalizeBody(args);
  const jobId =
    typeof body.job_id === "string" ? String(body.job_id).trim() : "";
  if (!jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id query parameter is required",
      statusCode: 400,
    };
  }
  return { ok: true };
}

const MCP_COMMAND_DEFINITIONS = Object.freeze([
  {
    name: "submit_unity_task",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/submit_unity_task", source: "body" },
    turnServiceMethod: "submitUnityTask",
    mcp: {
      expose: true,
      description:
        "Submit an asynchronous Unity write job. You must provide based_on_read_token and top-level write_anchor (object_id + path). This endpoint only accepts explicit file_actions/visual_layer_actions; task_allocation is not supported.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          thread_id: {
            type: "string",
            description: "Thread identifier for conversation context",
          },
          idempotency_key: {
            type: "string",
            description:
              "Idempotency key for deduplication. Required. If a job with the same key exists, the existing job_id will be returned.",
          },
          approval_mode: {
            type: "string",
            enum: ["auto", "require_user"],
            default: "auto",
            description:
              "Approval mode: 'auto' for automatic execution (recommended for MCP), 'require_user' for manual confirmation (may cause deadlock).",
          },
          user_intent: {
            type: "string",
            description:
              "Natural language description of what the user wants to accomplish",
          },
          based_on_read_token: {
            type: "string",
            description:
              "Read token from MCP eyes tools. Required for every write submission.",
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
          context: {
            type: "object",
            description:
              "Optional explicit Unity context. If omitted, sidecar uses latest reported selection context.",
          },
          file_actions: {
            type: "array",
            description:
              "Optional file actions. At least one of file_actions or visual_layer_actions must be non-empty.",
            items: { type: "object" },
          },
          visual_layer_actions: {
            type: "array",
            description:
              "Optional visual actions. At least one of file_actions or visual_layer_actions must be non-empty.",
            items: { type: "object" },
          },
        },
        required: [
          "thread_id",
          "idempotency_key",
          "user_intent",
          "based_on_read_token",
          "write_anchor",
        ],
        oneOf: [{ required: ["file_actions"] }, { required: ["visual_layer_actions"] }],
      },
    },
  },
  {
    name: "get_unity_task_status",
    kind: "status",
    lifecycle: "stable",
    http: {
      method: "GET",
      path: "/mcp/get_unity_task_status",
      source: "query",
      queryKey: "job_id",
    },
    turnServiceMethod: "getUnityTaskStatus",
    validate: validateGetUnityTaskStatusArgs,
    mcp: {
      expose: true,
      description:
        "Get the current status of a Unity task. This is a fallback query endpoint. For real-time updates, use the SSE stream endpoint. Use this only when SSE is unavailable or for reconnection recovery.",
      inputSchema: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "Job identifier returned from submit_unity_task",
          },
        },
        required: ["job_id"],
      },
    },
  },
  {
    name: "cancel_unity_task",
    kind: "status",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/cancel_unity_task", source: "body" },
    turnServiceMethod: "cancelUnityTask",
    mcp: {
      expose: true,
      description: "Cancel a running or queued Unity task",
      inputSchema: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "Job identifier to cancel",
          },
        },
        required: ["job_id"],
      },
    },
  },
  {
    name: "apply_script_actions",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/apply_script_actions", source: "body" },
    turnServiceMethod: "applyScriptActionsForMcp",
    mcp: {
      expose: true,
      description:
        "Apply structured script/file actions. Hard requirements: based_on_read_token + top-level write_anchor(object_id+path). This endpoint does not accept task_allocation.",
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
          actions: {
            type: "array",
            description: "Script/file actions (create/update/rename/delete).",
            items: {
              type: "object",
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
            description: "If true, only validate and report plan without executing.",
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
        required: ["based_on_read_token", "write_anchor", "actions"],
      },
    },
  },
  {
    name: "apply_visual_actions",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/apply_visual_actions", source: "body" },
    turnServiceMethod: "applyVisualActionsForMcp",
    mcp: {
      expose: true,
      description: buildVisualActionsDescription,
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
          actions: {
            type: "array",
            description:
              "Visual actions. Unknown action types are allowed. Use action_data for typed parameters.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string" },
                target_anchor: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    object_id: { type: "string" },
                    path: { type: "string" },
                  },
                  required: ["object_id", "path"],
                },
                parent_anchor: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    object_id: { type: "string" },
                    path: { type: "string" },
                  },
                  required: ["object_id", "path"],
                },
                action_data: {
                  type: "object",
                  description:
                    "Open payload object. Prefer this over legacy top-level action fields.",
                },
              },
              required: ["type"],
              anyOf: [
                { required: ["target_anchor"] },
                { required: ["parent_anchor"] },
              ],
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
            description: "If true, only validate and report plan without executing.",
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
        required: ["based_on_read_token", "write_anchor", "actions"],
      },
    },
  },
  {
    name: "set_ui_properties",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/set_ui_properties", source: "body" },
    execute: executeSetUiProperties,
    mcp: {
      expose: true,
      description:
        "Set common UI properties with a deterministic field-level contract. Internally maps to apply_visual_actions and reuses OCC/read_token, anchor guards, and Unity action handlers. Use dry_run=true to preview planned_actions_count + mapped_actions without Unity submission.",
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
  },
  {
    name: "set_serialized_property",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_serialized_property", source: "body" },
    execute: executeSetSerializedProperty,
    mcp: {
      expose: true,
      description:
        "Generic SerializedProperty write action. Converts patch payload to apply_visual_actions(set_serialized_property) and reuses OCC/read_token, write_anchor, and atomic rollback guarantees.",
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
                    "enum",
                    "vector2",
                    "vector3",
                    "color",
                    "array",
                    "object_reference",
                  ],
                },
                int_value: { type: "integer" },
                float_value: { type: "number" },
                string_value: { type: "string" },
                bool_value: { type: "boolean" },
                enum_value: { type: "integer" },
                enum_name: { type: "string" },
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
                array_size: {
                  type: "integer",
                  minimum: 0,
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
            description: "If true, only validate payload and skip Unity submission.",
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
  },
  {
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
  },
  {
    name: "get_action_schema",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_action_schema", source: "body" },
    validate: validateGetActionSchema,
    execute: executeGetActionSchema,
    mcp: {
      expose: true,
      description:
        "Get the detailed action_data schema for one visual action type. Use this when apply_visual_actions fails with payload/schema errors or when you need exact parameter fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action_type: {
            type: "string",
            description: "Visual action type name, e.g. set_ui_image_color.",
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
        required: ["action_type"],
      },
    },
  },
  {
    name: "get_tool_schema",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_tool_schema", source: "body" },
    validate: validateGetToolSchema,
    execute: executeGetToolSchema,
    mcp: {
      expose: true,
      description:
        "Get full MCP tool input schema and transport contract by tool_name. Use this when tools/list schema is compact or when payload validation fails.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool_name: {
            type: "string",
            description:
              "MCP tool name returned by tools/list, e.g. apply_visual_actions.",
          },
        },
        required: ["tool_name"],
      },
    },
  },
  {
    name: "capture_scene_screenshot",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/capture_scene_screenshot",
      source: "body",
    },
    validate: validateCaptureSceneScreenshot,
    execute: executeCaptureSceneScreenshot,
    mcp: {
      expose: true,
      description:
        "Capture Unity visual output for verification. Unity runtime dispatch is registry-backed. Current stable mode is capture_mode=render_output only. final_pixels/editor_view are disabled in closure phase and will return E_CAPTURE_MODE_DISABLED.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          view_mode: {
            type: "string",
            enum: ["auto", "scene", "game"],
            description:
              "Target Unity view to capture. auto chooses the best available editor view.",
          },
          capture_mode: {
            type: "string",
            enum: ["render_output"],
            description:
              "Capture semantics. render_output=camera render. Other legacy modes are currently disabled.",
          },
          output_mode: {
            type: "string",
            enum: ["artifact_uri", "inline_base64"],
            description:
              "artifact_uri for large payload safety; inline_base64 for immediate inline delivery.",
          },
          image_format: {
            type: "string",
            enum: ["png", "jpg"],
            description: "Screenshot encoding format.",
          },
          width: {
            type: "integer",
            description: "Optional output width in pixels (>=64).",
          },
          height: {
            type: "integer",
            description: "Optional output height in pixels (>=64).",
          },
          jpeg_quality: {
            type: "integer",
            description:
              "Optional JPEG quality (1..100). Effective only when image_format=jpg.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
          include_ui: {
            type: "boolean",
            description:
              "UI include hint for render_output path (camera/world-space UI).",
          },
        },
      },
    },
  },
  {
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
  },
  {
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
        "Read SerializedProperty tree lazily for a specific component. Supports depth/page/node/char budgets and cursor paging (after_property_path) to avoid token explosion.",
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
        required: ["target_anchor", "component_selector"],
      },
    },
  },
  {
    name: "hit_test_ui_at_viewport_point",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_viewport_point",
      source: "body",
    },
    validate: validateHitTestUiAtViewportPoint,
    execute: executeHitTestUiAtViewportPoint,
    mcp: {
      expose: true,
      description:
        "Hit test UGUI from deterministic viewport coordinates. Supports viewport_px/normalized input and returns mapped_point with runtime_resolution/runtime_source.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          view: {
            type: "string",
            enum: ["game"],
            description: "Target view. V1 supports game view only.",
          },
          coord_space: {
            type: "string",
            enum: ["viewport_px", "normalized"],
            description:
              "Coordinate input space. viewport_px uses resolution pixels; normalized uses [0,1].",
          },
          coord_origin: {
            type: "string",
            enum: ["bottom_left", "top_left"],
            description:
              "Input coordinate origin. Response always includes normalized mapped_point context.",
          },
          x: {
            type: "number",
            description: "Required x coordinate.",
          },
          y: {
            type: "number",
            description: "Required y coordinate.",
          },
          resolution: {
            type: "object",
            additionalProperties: false,
            properties: {
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["width", "height"],
          },
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: { type: "string" },
            },
          },
          max_results: {
            type: "integer",
            description: "Optional max hit stack size (>=1).",
          },
          include_non_interactable: {
            type: "boolean",
            description:
              "Whether non-interactable candidates are included in hit stack.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    name: "validate_ui_layout",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/validate_ui_layout",
      source: "body",
    },
    validate: validateUiLayout,
    execute: executeValidateUiLayout,
    mcp: {
      expose: true,
      description:
        "Validate UI layout across resolutions and return structured issues (OUT_OF_BOUNDS/OVERLAP/NOT_CLICKABLE/TEXT_OVERFLOW). Optional specialist mode can emit deterministic repair_plan suggestions mapped to Phase-2 primitives.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scope: {
            type: "object",
            additionalProperties: false,
            properties: {
              root_path: { type: "string" },
            },
          },
          resolutions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                width: { type: "integer" },
                height: { type: "integer" },
              },
              required: ["width", "height"],
            },
          },
          checks: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "OUT_OF_BOUNDS",
                "OVERLAP",
                "NOT_CLICKABLE",
                "TEXT_OVERFLOW",
              ],
            },
          },
          max_issues: {
            type: "integer",
            description: "Optional issue cap (>=1).",
          },
          time_budget_ms: {
            type: "integer",
            description: "Optional in-validator budget (>=1).",
          },
          layout_refresh_mode: {
            type: "string",
            enum: ["scoped_roots_only", "full_tree"],
            description: "Layout refresh strategy before checks.",
          },
          include_repair_plan: {
            type: "boolean",
            description:
              "When true, response may include specialist_summary + repair_plan suggestions.",
          },
          max_repair_suggestions: {
            type: "integer",
            description: "Optional cap for repair_plan suggestions (>=1).",
          },
          repair_style: {
            type: "string",
            enum: ["conservative", "balanced", "aggressive"],
            description: "Repair strategy preference used by specialist planner.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
      },
    },
  },
  {
    name: "hit_test_ui_at_screen_point",
    kind: "read",
    lifecycle: "deprecated",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_screen_point",
      source: "body",
    },
    validate: validateHitTestUiAtScreenPoint,
    execute: executeHitTestUiAtScreenPoint,
    mcp: {
      expose: true,
      description:
        "Temporarily disabled in screenshot stabilization closure. Unity runtime dispatch is registry-backed; calls return E_COMMAND_DISABLED. Use get_ui_tree + capture_scene_screenshot(render_output) for verification.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          view_mode: {
            type: "string",
            enum: ["auto", "game"],
            description:
              "Target view for hit testing. auto resolves to Game view.",
          },
          x: {
            type: "integer",
            description:
              "Required x coordinate in screenshot reference space (>=0).",
          },
          y: {
            type: "integer",
            description:
              "Required y coordinate in screenshot reference space (>=0).",
          },
          reference_width: {
            type: "integer",
            description:
              "Reference screenshot width used for coordinate mapping (>=1).",
          },
          reference_height: {
            type: "integer",
            description:
              "Reference screenshot height used for coordinate mapping (>=1).",
          },
          max_results: {
            type: "integer",
            description: "Optional max hit stack size (>=1).",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional query timeout in milliseconds (>=1000).",
          },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    name: "list_assets_in_folder",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/list_assets_in_folder", source: "body" },
    turnServiceMethod: "listAssetsInFolderForMcp",
    validate: validateListAssetsInFolder,
    mcp: {
      expose: true,
      description:
        "List project assets under a folder path in Unity AssetDatabase. Use this before guessing file paths or prefab/script locations. When you need to discover candidate assets, call this first instead of assuming names.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          folder_path: {
            type: "string",
            description:
              "Required Unity project folder path, e.g. Assets/Prefabs or Assets/Scripts.",
          },
          recursive: {
            type: "boolean",
            description:
              "Whether to traverse subfolders recursively. Default false if omitted.",
          },
          include_meta: {
            type: "boolean",
            description: "Whether .meta files should be included. Usually false.",
          },
          limit: {
            type: "integer",
            description:
              "Optional max number of returned entries. Must be >= 1.",
          },
        },
        required: ["folder_path"],
      },
    },
  },
  {
    name: "get_scene_roots",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_scene_roots", source: "body" },
    turnServiceMethod: "getSceneRootsForMcp",
    validate: validateGetSceneRoots,
    mcp: {
      expose: true,
      description:
        "Get root GameObjects of a loaded scene, including object_id/path anchors. Use this to establish reliable hierarchy anchors before downstream reads or writes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scene_path: {
            type: "string",
            description:
              "Optional scene asset path. If omitted, returns roots across currently loaded scenes.",
          },
          include_inactive: {
            type: "boolean",
            description:
              "Whether inactive roots are included. Default true if omitted.",
          },
        },
      },
    },
  },
  {
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
  },
  {
    name: "query_prefab_info",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/query_prefab_info", source: "body" },
    turnServiceMethod: "queryPrefabInfoForMcp",
    validate: validateQueryPrefabInfo,
    mcp: {
      expose: true,
      description:
        "Inspect prefab tree structure and components with explicit depth budget. When parsing nested prefab hierarchies, call this tool and pass max_depth deliberately based on complexity. Do not guess deep structure without querying it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prefab_path: {
            type: "string",
            description:
              "Required prefab asset path, e.g. Assets/Prefabs/UI/MainPanel.prefab.",
          },
          max_depth: {
            type: "integer",
            description:
              "Required traversal depth budget (>=0). Must be explicitly provided each call.",
          },
          node_budget: {
            type: "integer",
            description: "Optional max node budget (>=1).",
          },
          char_budget: {
            type: "integer",
            description: "Optional output character budget (>=256).",
          },
          include_components: {
            type: "boolean",
            description:
              "Whether component descriptors are included. Default true if omitted.",
          },
          include_missing_scripts: {
            type: "boolean",
            description:
              "Whether missing-script placeholders are included. Default true if omitted.",
          },
        },
        required: ["prefab_path", "max_depth"],
      },
    },
  },
]);

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};
