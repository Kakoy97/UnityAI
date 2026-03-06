"use strict";

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildValidationErrorResponse(validation) {
  const expected =
    validation && validation.expected && typeof validation.expected === "object"
      ? validation.expected
      : null;
  const actual =
    validation && validation.actual && typeof validation.actual === "object"
      ? validation.actual
      : null;
  const diff =
    validation && Array.isArray(validation.diff) ? validation.diff : null;
  return {
    statusCode: validation.statusCode,
    body: {
      error_code: validation.errorCode,
      message: validation.message,
      ...(expected ? { expected } : {}),
      ...(actual ? { actual } : {}),
      ...(diff ? { diff } : {}),
    },
  };
}

module.exports = {
  normalizeRequestId,
  buildValidationErrorResponse,
};
