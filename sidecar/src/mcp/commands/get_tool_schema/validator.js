"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

function validateGetToolSchema(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const keysValidation = validateAllowedKeys(body, new Set(["tool_name"]), "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.tool_name)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "tool_name is required",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateGetToolSchema,
};

