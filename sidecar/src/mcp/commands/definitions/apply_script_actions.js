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
    name: "apply_script_actions",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/apply_script_actions", source: "body" },
    turnServiceMethod: "applyScriptActionsForMcp",
    mcp: {
      expose: true,
      description:
        "Apply structured script/file actions. Hard requirements: based_on_read_token + top-level write_anchor(object_id+path). This endpoint does not accept task_allocation. accepted/queued are non-terminal; poll get_unity_task_status until succeeded/failed/cancelled.",
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
  };
};
