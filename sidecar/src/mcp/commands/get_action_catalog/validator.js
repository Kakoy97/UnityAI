"use strict";

const {
  isObject,
  validateAllowedKeys,
  validateIntegerField,
} = require("../_shared/validationUtils");

function validateGetActionCatalog(body) {
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
      "domain",
      "tier",
      "lifecycle",
      "cursor",
      "limit",
      "catalog_version",
      "if_none_match",
    ]),
    "body"
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  if (
    body.domain !== undefined &&
    body.domain !== null &&
    typeof body.domain !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "domain must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.tier !== undefined &&
    body.tier !== null &&
    typeof body.tier !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "tier must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.lifecycle !== undefined &&
    body.lifecycle !== null &&
    typeof body.lifecycle !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "lifecycle must be a string when provided",
      statusCode: 400,
    };
  }
  if (body.cursor !== undefined) {
    const cursorValidation = validateIntegerField(body.cursor, 0, "cursor");
    if (!cursorValidation.ok) {
      return cursorValidation;
    }
  }
  if (body.limit !== undefined) {
    const limitValidation = validateIntegerField(body.limit, 1, "limit");
    if (!limitValidation.ok) {
      return limitValidation;
    }
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
  validateGetActionCatalog,
};

