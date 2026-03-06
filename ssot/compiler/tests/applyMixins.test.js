"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMixins } = require("../parser/applyMixins");

function buildDictionary() {
  return {
    version: 1,
    _definitions: {
      mixins: {
        write_envelope: {
          input: {
            required: ["execution_mode", "based_on_read_token"],
            properties: {
              execution_mode: { type: "string" },
              based_on_read_token: { type: "string" },
            },
          },
        },
      },
    },
    tools: [
      {
        name: "modify_ui_layout",
        mixins: ["write_envelope"],
        input: {
          required: ["target_path", "width", "height"],
          properties: {
            target_path: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
      },
    ],
  };
}

test("applyMixins unions required and deep merges input properties", () => {
  const dictionary = buildDictionary();
  const merged = applyMixins(dictionary);
  const tool = merged.tools[0];

  assert.deepEqual(tool.input.required, [
    "execution_mode",
    "based_on_read_token",
    "target_path",
    "width",
    "height",
  ]);
  assert.ok(tool.input.properties.execution_mode);
  assert.ok(tool.input.properties.based_on_read_token);
  assert.ok(tool.input.properties.target_path);
  assert.ok(tool.input.properties.width);
  assert.ok(tool.input.properties.height);
});

test("applyMixins throws when tool references unknown mixin", () => {
  const dictionary = buildDictionary();
  dictionary.tools[0].mixins = ["missing_mixin"];
  assert.throws(() => applyMixins(dictionary), /Unknown mixin/);
});

