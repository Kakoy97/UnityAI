"use strict";

const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

function validateListAssetsInFolder(body) {
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
    new Set(["folder_path", "recursive", "include_meta", "limit"]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.folder_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "folder_path is required",
      statusCode: 400,
    };
  }

  if (body.recursive !== undefined && typeof body.recursive !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "recursive must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.include_meta !== undefined && typeof body.include_meta !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_meta must be a boolean when provided",
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
  validateListAssetsInFolder,
};

