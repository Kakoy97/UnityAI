"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateCaptureSceneScreenshot = getCommandValidator(
  "capture_scene_screenshot"
);

test("capture_scene_screenshot validator accepts valid payload", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "scene",
    capture_mode: "render_output",
    output_mode: "artifact_uri",
    image_format: "png",
    width: 1280,
    height: 720,
    max_base64_bytes: 512000,
    timeout_ms: 3000,
    include_ui: true,
  });
  assert.equal(result.ok, true);

  const compositeResult = validateCaptureSceneScreenshot({
    capture_mode: "composite",
    output_mode: "artifact_uri",
  });
  assert.equal(compositeResult.ok, true);
});

test("capture_scene_screenshot validator rejects unexpected fields", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "scene",
    unknown_key: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("capture_scene_screenshot validator rejects invalid enum values", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "invalid_mode",
    output_mode: "artifact_uri",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(result.message || ""), /view_mode/i);

  const invalidCaptureMode = validateCaptureSceneScreenshot({
    capture_mode: "unknown_mode",
  });
  assert.equal(invalidCaptureMode.ok, false);
  assert.equal(invalidCaptureMode.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(invalidCaptureMode.message || ""), /capture_mode/i);
});

test("capture_scene_screenshot validator rejects invalid numeric ranges", () => {
  const badSize = validateCaptureSceneScreenshot({
    width: 32,
    height: 720,
  });
  assert.equal(badSize.ok, false);
  assert.equal(badSize.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badSize.message || ""), /width/i);

  const badQuality = validateCaptureSceneScreenshot({
    jpeg_quality: 101,
  });
  assert.equal(badQuality.ok, false);
  assert.equal(badQuality.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badQuality.message || ""), /jpeg_quality/i);

  const badTimeout = validateCaptureSceneScreenshot({
    timeout_ms: 100,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badTimeout.message || ""), /timeout_ms/i);

  const badMaxBase64 = validateCaptureSceneScreenshot({
    max_base64_bytes: 0,
  });
  assert.equal(badMaxBase64.ok, false);
  assert.equal(badMaxBase64.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badMaxBase64.message || ""), /max_base64_bytes/i);

  const tooLargeMaxBase64 = validateCaptureSceneScreenshot({
    max_base64_bytes: 10 * 1024 * 1024 + 1,
  });
  assert.equal(tooLargeMaxBase64.ok, false);
  assert.equal(tooLargeMaxBase64.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(tooLargeMaxBase64.message || ""), /max_base64_bytes/i);
});
