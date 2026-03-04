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
    name: "submit_unity_task",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/submit_unity_task", source: "body" },
    turnServiceMethod: "submitUnityTask",
    mcp: {
      expose: true,
      description:
        "Submit an asynchronous Unity write job. You must provide based_on_read_token and top-level write_anchor (object_id + path). This endpoint only accepts explicit file_actions/visual_layer_actions; task_allocation is not supported. status=accepted/queued means submitted only; you must poll get_unity_task_status until terminal status (succeeded/failed/cancelled).",
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
  };
};
