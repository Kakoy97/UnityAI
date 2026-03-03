"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_VIEW_MODES = new Set(["auto", "scene", "game"]);
const ALLOWED_OUTPUT_MODES = new Set(["artifact_uri", "inline_base64"]);
const ALLOWED_IMAGE_FORMATS = new Set(["png", "jpg"]);
const MAX_MAX_BASE64_BYTES = 10 * 1024 * 1024;
// Backward-compatible input acceptance:
// final_pixels/editor_view are accepted at validator layer and fail-closed in handler.
const ACCEPTED_CAPTURE_MODES = new Set([
  "render_output",
  "composite",
  "final_pixels",
  "editor_view",
]);

function validateCaptureSceneScreenshot(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const keysValidation = validateAllowedKeys(
    body,
    new Set([
      "view_mode",
      "capture_mode",
      "output_mode",
      "image_format",
      "width",
      "height",
      "jpeg_quality",
      "max_base64_bytes",
      "timeout_ms",
      "include_ui",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const viewMode =
    typeof body.view_mode === "string" ? body.view_mode.trim() : "";
  if (viewMode && !ALLOWED_VIEW_MODES.has(viewMode)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "view_mode must be one of: auto|scene|game",
      statusCode: 400,
    };
  }

  const captureMode =
    typeof body.capture_mode === "string" ? body.capture_mode.trim() : "";
  if (captureMode && !ACCEPTED_CAPTURE_MODES.has(captureMode)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "capture_mode must be one of: render_output|composite|final_pixels|editor_view",
      statusCode: 400,
    };
  }

  const outputMode =
    typeof body.output_mode === "string" ? body.output_mode.trim() : "";
  if (outputMode && !ALLOWED_OUTPUT_MODES.has(outputMode)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "output_mode must be one of: artifact_uri|inline_base64",
      statusCode: 400,
    };
  }

  const imageFormat =
    typeof body.image_format === "string" ? body.image_format.trim() : "";
  if (imageFormat && !ALLOWED_IMAGE_FORMATS.has(imageFormat)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "image_format must be one of: png|jpg",
      statusCode: 400,
    };
  }

  if (body.width !== undefined) {
    const widthValidation = validateIntegerField(body.width, 64, "width");
    if (!widthValidation.ok) {
      return widthValidation;
    }
  }

  if (body.height !== undefined) {
    const heightValidation = validateIntegerField(body.height, 64, "height");
    if (!heightValidation.ok) {
      return heightValidation;
    }
  }

  if (body.jpeg_quality !== undefined) {
    const qualityValidation = validateIntegerField(
      body.jpeg_quality,
      1,
      "jpeg_quality"
    );
    if (!qualityValidation.ok) {
      return qualityValidation;
    }
    if (Number(body.jpeg_quality) > 100) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "jpeg_quality must be an integer <= 100 when provided",
        statusCode: 400,
      };
    }
  }

  if (body.timeout_ms !== undefined) {
    const timeoutValidation = validateIntegerField(body.timeout_ms, 1000, "timeout_ms");
    if (!timeoutValidation.ok) {
      return timeoutValidation;
    }
  }

  if (body.max_base64_bytes !== undefined) {
    const maxBase64Validation = validateIntegerField(
      body.max_base64_bytes,
      1,
      "max_base64_bytes"
    );
    if (!maxBase64Validation.ok) {
      return maxBase64Validation;
    }
    if (Number(body.max_base64_bytes) > MAX_MAX_BASE64_BYTES) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "max_base64_bytes must be an integer <= 10485760 when provided",
        statusCode: 400,
      };
    }
  }

  if (body.include_ui !== undefined && typeof body.include_ui !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_ui must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateCaptureSceneScreenshot,
};
