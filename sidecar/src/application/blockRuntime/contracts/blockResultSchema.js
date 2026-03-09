"use strict";

const Ajv = require("ajv");
const { BLOCK_ERROR_SCHEMA } = require("./blockErrorSchema");

const BLOCK_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    block_id: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["succeeded", "failed"] },
    output_data: { type: "object" },
    scene_revision: { type: "string", minLength: 1 },
    read_token_candidate: { type: "string", minLength: 1 },
    execution_meta: {
      type: "object",
      additionalProperties: true,
      properties: {
        channel: { type: "string", minLength: 1 },
        shape: { type: "string", minLength: 1 },
      },
      required: ["channel", "shape"],
    },
    error: BLOCK_ERROR_SCHEMA,
  },
  required: ["block_id", "status", "execution_meta"],
  allOf: [
    {
      if: {
        properties: {
          status: { const: "failed" },
        },
        required: ["status"],
      },
      then: {
        properties: {
          error: {
            type: "object",
          },
        },
        required: ["error"],
      },
    },
  ],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const validateBlockResultBySchema = new Ajv({
  allErrors: true,
  strict: true,
}).compile(BLOCK_RESULT_SCHEMA);

function validateBlockResult(payload) {
  const valid = validateBlockResultBySchema(payload);
  if (!valid) {
    return {
      ok: false,
      error_code: "E_SCHEMA_INVALID",
      value: payload,
      errors: cloneJson(validateBlockResultBySchema.errors || []),
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
  BLOCK_RESULT_SCHEMA,
  validateBlockResult,
};
