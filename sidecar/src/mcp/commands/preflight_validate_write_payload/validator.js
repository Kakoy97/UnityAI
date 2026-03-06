"use strict";

const {
  getValidatorRegistrySingleton,
} = require("../../../application/ssotRuntime/validatorRegistry");

const TOOL_NAME = "preflight_validate_write_payload";

function summarizeValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "Request schema invalid.";
  }
  const first = errors[0] && typeof errors[0] === "object" ? errors[0] : {};
  const path =
    typeof first.instancePath === "string" && first.instancePath.trim()
      ? first.instancePath
      : "/";
  const message =
    typeof first.message === "string" && first.message.trim()
      ? first.message.trim()
      : "invalid value";
  return `Request schema invalid at ${path}: ${message}`;
}

function validatePreflightValidateWritePayload(body) {
  const payload =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  let registry = null;
  try {
    registry = getValidatorRegistrySingleton();
  } catch (error) {
    return {
      ok: false,
      errorCode: "E_SSOT_SCHEMA_UNAVAILABLE",
      message:
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "SSOT compiled schema registry is unavailable.",
      statusCode: 500,
    };
  }

  const validation = registry.validateToolInput(TOOL_NAME, payload);
  if (validation && validation.ok === true) {
    return {
      ok: true,
      value:
        validation.value && typeof validation.value === "object"
          ? validation.value
          : payload,
    };
  }

  return {
    ok: false,
    errorCode: "E_SSOT_SCHEMA_INVALID",
    message: summarizeValidationErrors(validation && validation.errors),
    statusCode: 400,
    details:
      validation && Array.isArray(validation.errors) ? validation.errors : [],
  };
}

module.exports = {
  validatePreflightValidateWritePayload,
};
