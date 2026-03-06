"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDictionary } = require("../parser/parseDictionary");

test("parseDictionary parses JSON dictionary payload", () => {
  const payload = {
    ext: ".json",
    absolutePath: "mock-tools.json",
    raw: JSON.stringify({
      version: 1,
      tools: [
        {
          name: "modify_ui_layout",
          input: { type: "object", properties: {} },
        },
      ],
    }),
  };

  const parsed = parseDictionary(payload);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.tools[0].name, "modify_ui_layout");
});

test("parseDictionary parses YAML dictionary payload into IR object", () => {
  const payload = {
    ext: ".yaml",
    absolutePath: "mock-tools.yaml",
    raw: `
version: 1
tools:
  - name: modify_ui_layout
    kind: write
    input:
      type: object
      required: [target_path, width, height]
      properties:
        target_path:
          type: string
        width:
          type: number
        height:
          type: number
`,
  };

  const parsed = parseDictionary(payload);
  assert.equal(parsed.version, 1);
  assert.equal(Array.isArray(parsed.tools), true);
  assert.equal(parsed.tools[0].name, "modify_ui_layout");
  assert.deepEqual(parsed.tools[0].input.required, ["target_path", "width", "height"]);
});

