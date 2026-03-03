"use strict";

const {
  isObject,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

const ALLOWED_MODES = new Set(["native", "cline"]);

function validateSetupCursorMcp(body) {
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
    new Set(["mode", "sidecar_base_url", "dry_run"]),
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
        message: "mode must be one of: native|cline",
        statusCode: 400,
      };
    }
  }

  if (body.sidecar_base_url !== undefined) {
    if (typeof body.sidecar_base_url !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "sidecar_base_url must be a string when provided",
        statusCode: 400,
      };
    }
    const normalized = body.sidecar_base_url.trim();
    let parsed = null;
    try {
      parsed = new URL(normalized);
    } catch {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "sidecar_base_url must be a valid http(s) URL",
        statusCode: 400,
      };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "sidecar_base_url must use http or https protocol",
        statusCode: 400,
      };
    }
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "dry_run must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateSetupCursorMcp,
};
