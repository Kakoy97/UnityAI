"use strict";

const Ajv = require("ajv");
const { BLOCK_SPEC_SCHEMA } = require("./blockSpecSchema");
const {
  validateBlockPlanSemantics,
} = require("./blockPlanValidators");

const BLOCK_PLAN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    plan_id: { type: "string", minLength: 1 },
    initial_read_token: { type: "string", minLength: 1 },
    blocks: {
      type: "array",
      minItems: 1,
      items: BLOCK_SPEC_SCHEMA,
    },
    plan_timeout_ms: { type: "integer", minimum: 1 },
  },
  required: ["plan_id", "blocks"],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAjvInstance() {
  return new Ajv({
    allErrors: true,
    strict: true,
  });
}

const validateBlockPlanBySchema = createAjvInstance().compile(BLOCK_PLAN_SCHEMA);

function validateBlockPlan(payload) {
  const valid = validateBlockPlanBySchema(payload);
  if (!valid) {
    return {
      ok: false,
      error_code: "E_SCHEMA_INVALID",
      value: payload,
      errors: cloneJson(validateBlockPlanBySchema.errors || []),
    };
  }

  const semanticErrors = validateBlockPlanSemantics(payload);
  if (semanticErrors.length > 0) {
    return {
      ok: false,
      error_code: "E_PRECONDITION_FAILED",
      value: payload,
      errors: semanticErrors,
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
  BLOCK_SPEC_SCHEMA,
  BLOCK_PLAN_SCHEMA,
  validateBlockPlan,
  validateBlockPlanSemantics,
};
