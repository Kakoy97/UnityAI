"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAllowedKeys(body, allowedKeys, objectName) {
  const keys = Object.keys(body || {});
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${objectName} has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }
  return { ok: true };
}

function validateIntegerField(value, minimum, fieldName) {
  if (
    !Number.isFinite(Number(value)) ||
    Math.floor(Number(value)) !== Number(value) ||
    Number(value) < Number(minimum)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldName} must be an integer >= ${minimum} when provided`,
      statusCode: 400,
    };
  }
  return { ok: true };
}

module.exports = {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
  validateIntegerField,
};

