"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitDtosCs } = require("../emitters/l3/emitDtosCs");

test("emitDtosCs generates strongly-typed DTO fields from input schema", () => {
  const output = emitDtosCs({
    version: 1,
    tools: [
      {
        name: "modify_ui_layout",
        input: {
          type: "object",
          required: ["execution_mode", "width", "height"],
          properties: {
            execution_mode: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            layer_index: { type: "integer" },
            active: { type: "boolean" },
          },
        },
      },
    ],
  });

  assert.match(output, /public sealed class ModifyUiLayoutRequestDto/);
  assert.match(output, /public const string ToolName = "modify_ui_layout";/);
  assert.match(output, /public static readonly string\[\] RequiredFields = new\[] \{ "execution_mode", "width", "height" \};/);
  assert.match(output, /public string execution_mode;/);
  assert.match(output, /public double width;/);
  assert.match(output, /public double height;/);
  assert.match(output, /public int layer_index;/);
  assert.match(output, /public bool active;/);
});

