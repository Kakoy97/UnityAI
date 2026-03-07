"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitAjvSchemas } = require("../emitters/l2/emitAjvSchemas");

test("emitAjvSchemas carries dictionary-level definitions into each tool schema as $defs", () => {
  const emitted = emitAjvSchemas({
    version: 1,
    _definitions: {
      transaction_step: {
        type: "object",
      },
    },
    tools: [
      {
        name: "execute_unity_transaction",
        input: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: { $ref: "#/_definitions/transaction_step" },
            },
          },
        },
      },
    ],
  });

  assert.equal(emitted.schemas.length, 1);
  assert.deepEqual(emitted.schemas[0].input_schema.$defs, {
    transaction_step: { type: "object" },
  });
  assert.equal(
    emitted.schemas[0].input_schema.properties.steps.items.$ref,
    "#/$defs/transaction_step"
  );
});

test("emitAjvSchemas clones definitions and does not mutate dictionary input", () => {
  const dictionary = {
    version: 1,
    _definitions: {
      token: {
        type: "string",
      },
    },
    tools: [
      {
        name: "mock_tool",
        input: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  const emitted = emitAjvSchemas(dictionary);
  emitted.schemas[0].input_schema.$defs.token.type = "number";

  assert.equal(dictionary._definitions.token.type, "string");
});
