"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitMcpToolsJson } = require("../emitters/l2/emitMcpToolsJson");

test("emitMcpToolsJson maps tool IR to MCP tools payload", () => {
  const fullDescription = [
    "Modify RectTransform geometry only.",
    "Strictly do NOT use this tool for color/text/sprite/material changes.",
    "If target is not RectTransform, fail fast without fallback.",
  ].join("\n");
  const dictionary = {
    version: 1,
    tools: [
      {
        name: "modify_ui_layout",
        lifecycle: "stable",
        kind: "write",
        description: fullDescription,
        input: {
          type: "object",
          additionalProperties: false,
          required: ["execution_mode", "target_path", "width", "height"],
          properties: {
            execution_mode: { type: "string", enum: ["validate", "execute"] },
            target_path: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        examples: [
          {
            name: "set_layout",
            user_intent: "Move button to x=100,y=100 and resize it",
            request_business_only: {
              target_path: "Scene/Canvas/Button",
              width: 160,
              height: 48,
            },
            request: {
              execution_mode: "execute",
              target_path: "Scene/Canvas/Button",
              width: 160,
              height: 48,
            },
          },
        ],
      },
    ],
  };

  const emitted = emitMcpToolsJson(dictionary);
  const tool = emitted.tools[0];

  assert.equal(emitted.version, 1);
  assert.equal(tool.name, "modify_ui_layout");
  assert.equal(tool.kind, "write");
  assert.equal(tool.lifecycle, "stable");
  assert.equal(tool.description, fullDescription);
  assert.equal(tool.inputSchema.required.includes("execution_mode"), true);
  assert.deepEqual(tool.examples[0].request, {
    execution_mode: "execute",
    target_path: "Scene/Canvas/Button",
    width: 160,
    height: 48,
  });
  assert.equal(tool.examples[0].user_intent, "Move button to x=100,y=100 and resize it");
  assert.equal(Object.prototype.hasOwnProperty.call(tool.examples[0], "request_business_only"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(tool.examples[0], "name"), false);
});

test("emitMcpToolsJson applies fallback defaults for missing optional tool fields", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    tools: [
      {
        name: "get_scene_snapshot_for_write",
      },
    ],
  });

  const tool = emitted.tools[0];
  assert.equal(tool.lifecycle, "stable");
  assert.equal(tool.kind, "write");
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {} });
  assert.deepEqual(tool.examples, []);
});
