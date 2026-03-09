"use strict";

const Ajv = require("ajv");

const BLOCK_ERROR_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    error_code: { type: "string", minLength: 1 },
    block_error_code: { type: "string", minLength: 1 },
    error_message: { type: "string", minLength: 1 },
    recoverable: { type: "boolean" },
    retry_policy: { type: "object" },
    suggested_action: { type: "string", minLength: 1 },
  },
  required: ["error_code", "error_message"],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const validateBlockErrorBySchema = new Ajv({
  allErrors: true,
  strict: true,
}).compile(BLOCK_ERROR_SCHEMA);

function validateBlockError(payload) {
  const valid = validateBlockErrorBySchema(payload);
  if (!valid) {
    return {
      ok: false,
      error_code: "E_SCHEMA_INVALID",
      value: payload,
      errors: cloneJson(validateBlockErrorBySchema.errors || []),
    };
  }
  return {
    ok: true,
    error_code: null,
    value: payload,
    errors: [],
  };
}

module.exports = {
  BLOCK_ERROR_SCHEMA,
  validateBlockError,
};

