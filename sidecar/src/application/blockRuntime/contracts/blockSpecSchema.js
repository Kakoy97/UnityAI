"use strict";

const Ajv = require("ajv");
const { BLOCK_TYPE, BLOCK_TYPE_VALUES } = require("./blockTypes");

const BLOCK_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    block_id: { type: "string", minLength: 1 },
    block_type: { type: "string", enum: BLOCK_TYPE_VALUES },
    intent_key: { type: "string", minLength: 1 },
    input: { type: "object" },
    target_anchor: {
      type: "object",
      additionalProperties: false,
      properties: {
        object_id: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
      },
      required: ["object_id", "path"],
    },
    based_on_read_token: { type: "string", minLength: 1 },
    atomicity_required: { type: "boolean" },
    timeout_ms: { type: "integer", minimum: 1 },
    write_envelope: {
      type: "object",
      additionalProperties: false,
      properties: {
        idempotency_key: { type: "string", minLength: 1 },
        write_anchor_object_id: { type: "string", minLength: 1 },
        write_anchor_path: { type: "string", minLength: 1 },
        execution_mode: { type: "string", minLength: 1 },
      },
      required: [
        "idempotency_key",
        "write_anchor_object_id",
        "write_anchor_path",
        "execution_mode",
      ],
    },
    fallback_context: {
      type: "object",
      additionalProperties: false,
      properties: {
        specialized_attempted: { type: "boolean" },
        serialized_property_tree_checked: { type: "boolean" },
        preflight_validate_checked: { type: "boolean" },
      },
    },
    depends_on: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    atomic_group_id: { type: "string", minLength: 1 },
  },
  required: ["block_id", "block_type", "intent_key", "input"],
  allOf: [
    {
      if: {
        properties: {
          block_type: {
            enum: [BLOCK_TYPE.CREATE, BLOCK_TYPE.MUTATE],
          },
        },
        required: ["block_type"],
      },
      then: {
        properties: {
          write_envelope: {
            type: "object",
          },
        },
        required: ["write_envelope"],
      },
    },
  ],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const validateBlockSpecBySchema = new Ajv({
  allErrors: true,
  strict: true,
}).compile(BLOCK_SPEC_SCHEMA);

function validateBlockSpec(payload) {
  const valid = validateBlockSpecBySchema(payload);
  if (!valid) {
    return {
      ok: false,
      error_code: "E_SCHEMA_INVALID",
      value: payload,
      errors: cloneJson(validateBlockSpecBySchema.errors || []),
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
  validateBlockSpec,
};
