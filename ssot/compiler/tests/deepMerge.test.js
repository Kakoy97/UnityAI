"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deepMerge } = require("../shared/deepMerge");

test("deepMerge unions required arrays and preserves uniqueness", () => {
  const left = {
    input: {
      required: ["a", "b"],
    },
  };
  const right = {
    input: {
      required: ["b", "c"],
    },
  };
  const merged = deepMerge(left, right);
  assert.deepEqual(merged.input.required, ["a", "b", "c"]);
});

test("deepMerge recursively merges nested properties objects", () => {
  const left = {
    input: {
      properties: {
        target_path: { type: "string", minLength: 1 },
      },
    },
  };
  const right = {
    input: {
      properties: {
        width: { type: "number", minimum: 0 },
      },
    },
  };
  const merged = deepMerge(left, right);
  assert.deepEqual(merged.input.properties.target_path, {
    type: "string",
    minLength: 1,
  });
  assert.deepEqual(merged.input.properties.width, {
    type: "number",
    minimum: 0,
  });
});

