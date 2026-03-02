"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCaptureSceneScreenshot,
} = require("../../src/mcp/commands/capture_scene_screenshot/validator");

test("capture_scene_screenshot validator accepts valid payload", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "scene",
    capture_mode: "render_output",
    output_mode: "artifact_uri",
    image_format: "png",
    width: 1280,
    height: 720,
    timeout_ms: 3000,
    include_ui: true,
  });
  assert.equal(result.ok, true);
});

test("capture_scene_screenshot validator rejects unexpected fields", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "scene",
    unknown_key: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
});

test("capture_scene_screenshot validator rejects invalid enum values", () => {
  const result = validateCaptureSceneScreenshot({
    view_mode: "invalid_mode",
    output_mode: "artifact_uri",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "view_mode must be one of: auto|scene|game");

  const invalidCaptureMode = validateCaptureSceneScreenshot({
    capture_mode: "unknown_mode",
  });
  assert.equal(invalidCaptureMode.ok, false);
  assert.equal(invalidCaptureMode.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    invalidCaptureMode.message,
    "capture_mode must be one of: render_output|final_pixels|editor_view"
  );
});

test("capture_scene_screenshot validator rejects invalid numeric ranges", () => {
  const badSize = validateCaptureSceneScreenshot({
    width: 32,
    height: 720,
  });
  assert.equal(badSize.ok, false);
  assert.equal(badSize.errorCode, "E_SCHEMA_INVALID");
  assert.equal(badSize.message, "width must be an integer >= 64 when provided");

  const badQuality = validateCaptureSceneScreenshot({
    jpeg_quality: 101,
  });
  assert.equal(badQuality.ok, false);
  assert.equal(badQuality.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badQuality.message,
    "jpeg_quality must be an integer <= 100 when provided"
  );

  const badTimeout = validateCaptureSceneScreenshot({
    timeout_ms: 100,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badTimeout.message,
    "timeout_ms must be an integer >= 1000 when provided"
  );
});
