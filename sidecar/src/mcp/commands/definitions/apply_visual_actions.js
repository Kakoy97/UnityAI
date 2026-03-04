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
              "Visual actions array. All typed parameters MUST be inside action_data (not at action top level). Each action needs type + anchor + action_data.",
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
                  description: [
                    "REQUIRED for most action types. All typed parameters MUST go here (never at action top level).",
                    "",
                    "Fields by action type:",
                    "• create_object: { name (required), primitive_type?, ui_type?, object_type? }",
                    "• rename_object: { name (required) }",
                    "• set_active: { active (required, boolean) }",
                    "• destroy_object: {} (empty or omit)",
                    "• set_parent: {} (uses parent_anchor only)",
                    "• add_component: { component_assembly_qualified_name (required) }",
                    "• remove_component: { component_name OR component_assembly_qualified_name (required), expected_count?, remove_mode? }",
                    "• replace_component: { source_component_assembly_qualified_name (required), component_assembly_qualified_name (required) }",
                    "• set_ui_image_color: { r, g, b, a (all required, 0-1 float) }",
                    "• set_local_position / set_world_position: { x, y, z }",
                    "• set_local_rotation / set_world_rotation: { x, y, z }",
                    "• set_local_scale: { x, y, z }",
                    "• set_rect_anchored_position: { x, y }",
                    "• set_rect_size_delta: { x, y }",
                    "• set_rect_pivot: { x, y }",
                    "• set_rect_anchors: { min_x, min_y, max_x, max_y }",
                    "• composite_visual_action: { steps: [{ step_id, type, target_anchor?, parent_anchor?, action_data }] }",
                  ].join("\n"),
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
  };
};
