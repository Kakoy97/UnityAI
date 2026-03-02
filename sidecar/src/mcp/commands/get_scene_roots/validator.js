"use strict";

const { isObject, validateAllowedKeys } = require("../_shared/validationUtils");

function validateGetSceneRoots(body) {
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
    new Set(["scene_path", "include_inactive"]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
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

  return { ok: true };
}

module.exports = {
  validateGetSceneRoots,
};

