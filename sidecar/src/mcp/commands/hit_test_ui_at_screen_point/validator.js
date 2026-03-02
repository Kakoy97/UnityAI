"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_VIEW_MODES = new Set(["auto", "game"]);

function validateHitTestUiAtScreenPoint(body) {
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
      "x",
      "y",
      "reference_width",
      "reference_height",
      "max_results",
      "timeout_ms",
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
      message: "view_mode must be one of: auto|game",
      statusCode: 400,
    };
  }

  if (body.x === undefined) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "x is required",
      statusCode: 400,
    };
  }
  const xValidation = validateIntegerField(body.x, 0, "x");
  if (!xValidation.ok) {
    return xValidation;
  }

  if (body.y === undefined) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "y is required",
      statusCode: 400,
    };
  }
  const yValidation = validateIntegerField(body.y, 0, "y");
  if (!yValidation.ok) {
    return yValidation;
  }

  if (body.reference_width !== undefined) {
    const widthValidation = validateIntegerField(
      body.reference_width,
      1,
      "reference_width"
    );
    if (!widthValidation.ok) {
      return widthValidation;
    }
  }

  if (body.reference_height !== undefined) {
    const heightValidation = validateIntegerField(
      body.reference_height,
      1,
      "reference_height"
    );
    if (!heightValidation.ok) {
      return heightValidation;
    }
  }

  if (body.max_results !== undefined) {
    const maxResultsValidation = validateIntegerField(
      body.max_results,
      1,
      "max_results"
    );
    if (!maxResultsValidation.ok) {
      return maxResultsValidation;
    }
  }

  if (body.timeout_ms !== undefined) {
    const timeoutValidation = validateIntegerField(
      body.timeout_ms,
      1000,
      "timeout_ms"
    );
    if (!timeoutValidation.ok) {
      return timeoutValidation;
    }
  }

  return { ok: true };
}

module.exports = {
  validateHitTestUiAtScreenPoint,
};

