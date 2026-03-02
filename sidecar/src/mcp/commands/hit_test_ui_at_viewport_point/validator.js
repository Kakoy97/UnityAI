"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

const ALLOWED_VIEWS = new Set(["game"]);
const ALLOWED_COORD_SPACES = new Set(["viewport_px", "normalized"]);
const ALLOWED_COORD_ORIGINS = new Set(["bottom_left", "top_left"]);

function validateHitTestUiAtViewportPoint(body) {
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
      "view",
      "coord_space",
      "coord_origin",
      "x",
      "y",
      "resolution",
      "scope",
      "max_results",
      "include_non_interactable",
      "timeout_ms",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const view = normalizeString(body.view);
  if (view && !ALLOWED_VIEWS.has(view)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "view must be one of: game",
      statusCode: 400,
    };
  }

  const coordSpace = normalizeString(body.coord_space) || "viewport_px";
  if (!ALLOWED_COORD_SPACES.has(coordSpace)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "coord_space must be one of: viewport_px|normalized",
      statusCode: 400,
    };
  }

  const coordOrigin = normalizeString(body.coord_origin) || "bottom_left";
  if (!ALLOWED_COORD_ORIGINS.has(coordOrigin)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "coord_origin must be one of: bottom_left|top_left",
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
  if (!Number.isFinite(Number(body.x))) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "x must be a finite number",
      statusCode: 400,
    };
  }

  if (body.y === undefined) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "y is required",
      statusCode: 400,
    };
  }
  if (!Number.isFinite(Number(body.y))) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "y must be a finite number",
      statusCode: 400,
    };
  }

  const x = Number(body.x);
  const y = Number(body.y);
  if (coordSpace === "normalized") {
    if (x < 0 || x > 1) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "x must be in [0,1] when coord_space=normalized",
        statusCode: 400,
      };
    }
    if (y < 0 || y > 1) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "y must be in [0,1] when coord_space=normalized",
        statusCode: 400,
      };
    }
  } else {
    if (x < 0) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "x must be >= 0 when coord_space=viewport_px",
        statusCode: 400,
      };
    }
    if (y < 0) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "y must be >= 0 when coord_space=viewport_px",
        statusCode: 400,
      };
    }
  }

  if (body.resolution !== undefined) {
    const resolutionValidation = validateResolutionObject(body.resolution, "resolution");
    if (!resolutionValidation.ok) {
      return resolutionValidation;
    }
  }

  if (body.scope !== undefined) {
    if (!isObject(body.scope)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "scope must be an object when provided",
        statusCode: 400,
      };
    }
    const scopeKeysValidation = validateAllowedKeys(
      body.scope,
      new Set(["root_path"]),
      "scope"
    );
    if (!scopeKeysValidation.ok) {
      return scopeKeysValidation;
    }
    if (
      body.scope.root_path !== undefined &&
      body.scope.root_path !== null &&
      typeof body.scope.root_path !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "scope.root_path must be a string when provided",
        statusCode: 400,
      };
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

  if (
    body.include_non_interactable !== undefined &&
    typeof body.include_non_interactable !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_non_interactable must be a boolean when provided",
      statusCode: 400,
    };
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

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function validateResolutionObject(value, fieldPath) {
  if (!isObject(value)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an object when provided`,
      statusCode: 400,
    };
  }
  const keysValidation = validateAllowedKeys(
    value,
    new Set(["width", "height"]),
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "width")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.width is required`,
      statusCode: 400,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(value, "height")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.height is required`,
      statusCode: 400,
    };
  }
  const widthValidation = validateIntegerField(value.width, 1, `${fieldPath}.width`);
  if (!widthValidation.ok) {
    return widthValidation;
  }
  const heightValidation = validateIntegerField(value.height, 1, `${fieldPath}.height`);
  if (!heightValidation.ok) {
    return heightValidation;
  }
  return { ok: true };
}

module.exports = {
  validateHitTestUiAtViewportPoint,
};

