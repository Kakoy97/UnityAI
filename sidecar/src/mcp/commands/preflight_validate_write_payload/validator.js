"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

function validatePreflightValidateWritePayload(body) {
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
    new Set(["tool_name", "payload"]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (
    body.tool_name !== undefined &&
    body.tool_name !== null &&
    !isNonEmptyString(body.tool_name)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "tool_name must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (!isObject(body.payload)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload must be a JSON object",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validatePreflightValidateWritePayload,
};

