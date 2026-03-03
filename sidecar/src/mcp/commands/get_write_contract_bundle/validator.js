"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

function validateGetWriteContractBundle(body) {
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
      "tool_name",
      "action_type",
      "catalog_version",
      "budget_chars",
      "include_error_fix_map",
      "include_canonical_examples",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (body.tool_name !== undefined && body.tool_name !== null && !isNonEmptyString(body.tool_name)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "tool_name must be a non-empty string when provided",
      statusCode: 400,
    };
  }
  if (
    body.action_type !== undefined &&
    body.action_type !== null &&
    !isNonEmptyString(body.action_type)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "action_type must be a non-empty string when provided",
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
    body.budget_chars !== undefined &&
    body.budget_chars !== null &&
    (!Number.isFinite(Number(body.budget_chars)) || Math.floor(Number(body.budget_chars)) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "budget_chars must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }
  if (
    body.include_error_fix_map !== undefined &&
    body.include_error_fix_map !== null &&
    typeof body.include_error_fix_map !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_error_fix_map must be a boolean when provided",
      statusCode: 400,
    };
  }
  if (
    body.include_canonical_examples !== undefined &&
    body.include_canonical_examples !== null &&
    typeof body.include_canonical_examples !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_canonical_examples must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateGetWriteContractBundle,
};

