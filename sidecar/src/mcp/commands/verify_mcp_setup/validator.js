"use strict";

const {
  isObject,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

const ALLOWED_MODES = new Set(["auto", "native", "cline"]);

function validateVerifyMcpSetup(body) {
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
    new Set(["mode"]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (body.mode !== undefined) {
    if (typeof body.mode !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "mode must be a string when provided",
        statusCode: 400,
      };
    }
    const mode = body.mode.trim().toLowerCase();
    if (!ALLOWED_MODES.has(mode)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "mode must be one of: auto|native|cline",
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  validateVerifyMcpSetup,
};
