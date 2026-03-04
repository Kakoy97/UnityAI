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
        "Get the current status of a Unity task. Keep polling this endpoint after submit until terminal status (succeeded/failed/cancelled). accepted/queued/pending/running are non-terminal. This is a fallback query endpoint; SSE can be used for real-time updates.",
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
  };
};
