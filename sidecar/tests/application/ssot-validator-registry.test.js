"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createValidatorRegistry,
} = require("../../src/application/ssotRuntime/validatorRegistry");
const { normalizeCompiledSchemas } = require("../../src/application/ssotRuntime/loadCompiledSchemas");

function buildCompiledSchemas() {
  return {
    version: 1,
    schemas: [
      {
        tool_name: "modify_ui_layout",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["execution_mode", "target_path", "width", "height"],
          properties: {
            execution_mode: {
              type: "string",
              enum: ["validate", "execute"],
              case_insensitive: true,
            },
            target_path: {
              type: "string",
              minLength: 1,
            },
            width: {
              type: "number",
              minimum: 0,
            },
            height: {
              type: "number",
              minimum: 0,
            },
          },
        },
      },
    ],
  };
}

test("Step-7 normalizeCompiledSchemas accepts snake_case schema artifact fields", () => {
  const normalized = normalizeCompiledSchemas(buildCompiledSchemas(), "test-fixture");
  assert.equal(normalized.schemas.length, 1);
  assert.equal(normalized.schemas[0].toolName, "modify_ui_layout");
  assert.equal(normalized.schemas[0].inputSchema.type, "object");
});

test("Step-7 validator registry compiles in strict mode with case_insensitive keyword and normalizes enum", () => {
  const registry = createValidatorRegistry({
    compiledSchemas: buildCompiledSchemas(),
    ajvOptions: {
      strict: true,
    },
  });

  const result = registry.validateToolInput("modify_ui_layout", {
    execution_mode: "EXECUTE",
    target_path: "Scene/Canvas/Button",
    width: 160,
    height: 48,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.execution_mode, "execute");
  assert.deepEqual(result.errors, []);
});

test("Step-7 validator registry returns structured errors for unknown tool and invalid payload", () => {
  const registry = createValidatorRegistry({
    compiledSchemas: buildCompiledSchemas(),
  });

  const unknownTool = registry.validateToolInput("missing_tool", {});
  assert.equal(unknownTool.ok, false);
  assert.equal(unknownTool.error_code, "SSOT_TOOL_SCHEMA_NOT_FOUND");

  const invalidPayload = registry.validateToolInput("modify_ui_layout", {
    execution_mode: "BAD_MODE",
    target_path: "Scene/Canvas/Button",
    width: 160,
    height: 48,
  });
  assert.equal(invalidPayload.ok, false);
  assert.equal(invalidPayload.error_code, "SSOT_TOOL_SCHEMA_VALIDATION_FAILED");
  assert.ok(Array.isArray(invalidPayload.errors));
  assert.ok(invalidPayload.errors.length >= 1);
});

