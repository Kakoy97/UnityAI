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
      description: buildCaptureSceneScreenshotDescription,
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
            enum: ["render_output", "composite"],
            description:
              "Capture semantics. render_output=camera render (stable). composite=diagnostic synthesized capture (flag-gated).",
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
          max_base64_bytes: {
            type: "integer",
            description:
              "Optional inline_base64 upper bound (bytes). If exceeded, output auto-falls back to artifact_uri.",
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
  };
};
