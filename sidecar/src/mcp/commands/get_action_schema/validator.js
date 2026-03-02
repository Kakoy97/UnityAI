"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

function validateGetActionSchema(body) {
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
    new Set(["action_type", "catalog_version", "if_none_match"]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  if (!isNonEmptyString(body.action_type)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "action_type is required",
      statusCode: 400,
    };
  }
  if (
    body.catalog_version !== undefined &&
    body.catalog_version !== null &&
    typeof body.catalog_version !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "catalog_version must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.if_none_match !== undefined &&
    body.if_none_match !== null &&
    typeof body.if_none_match !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "if_none_match must be a string when provided",
      statusCode: 400,
    };
  }
  return { ok: true };
}

module.exports = {
  validateGetActionSchema,
};

