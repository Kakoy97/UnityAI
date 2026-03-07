"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDictionaryShape } = require("../parser/validateDictionaryShape");

function buildTool(overrides = {}) {
  return {
    name: "create_object",
    kind: "write",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    transaction: {
      enabled: true,
      undo_safe: true,
    },
    ...overrides,
  };
}

test("validateDictionaryShape accepts write tool when transaction metadata is complete", () => {
  const dictionary = {
    version: 1,
    tools: [buildTool()],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape rejects write tool without transaction metadata", () => {
  const dictionary = {
    version: 1,
    tools: [buildTool({ transaction: undefined })],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /transaction is required for write tools/
  );
});

test("validateDictionaryShape rejects write tool when transaction flags are not booleans", () => {
  const dictionary = {
    version: 1,
    tools: [
      buildTool({
        transaction: {
          enabled: "true",
          undo_safe: true,
        },
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /transaction\.enabled must be boolean/
  );
});

test("validateDictionaryShape allows read tool without transaction metadata", () => {
  const dictionary = {
    version: 1,
    tools: [
      {
        name: "get_scene_roots",
        kind: "read",
        input: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    ],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});
