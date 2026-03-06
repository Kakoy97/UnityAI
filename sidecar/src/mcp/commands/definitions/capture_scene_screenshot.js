"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateCaptureSceneScreenshot =
    typeof source.validateCaptureSceneScreenshot === "function"
      ? source.validateCaptureSceneScreenshot
      : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;
  const getSsotToolDescriptionForTool =
    typeof source.getSsotToolDescriptionForTool === "function"
      ? source.getSsotToolDescriptionForTool
      : null;
  const fallbackDescription =
    "Capture Unity visual output via SSOT isolated query pipeline.";

  return {
    name: "capture_scene_screenshot",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/capture_scene_screenshot",
      source: "body",
    },
    turnServiceMethod: "captureSceneScreenshotForMcp",
    validate: validateCaptureSceneScreenshot,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("capture_scene_screenshot", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("capture_scene_screenshot")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
