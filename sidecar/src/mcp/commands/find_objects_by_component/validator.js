"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

function validateFindObjectsByComponent(body) {
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
      "component_query",
      "scene_path",
      "under_path",
      "include_inactive",
      "limit",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.component_query)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "component_query is required",
      statusCode: 400,
    };
  }

  if (
    body.scene_path !== undefined &&
    body.scene_path !== null &&
    typeof body.scene_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "scene_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.under_path !== undefined &&
    body.under_path !== null &&
    typeof body.under_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "under_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_inactive !== undefined &&
    typeof body.include_inactive !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_inactive must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.limit !== undefined) {
    const limitValidation = validateIntegerField(body.limit, 1, "limit");
    if (!limitValidation.ok) {
      return limitValidation;
    }
  }

  return { ok: true };
}

module.exports = {
  validateFindObjectsByComponent,
};

