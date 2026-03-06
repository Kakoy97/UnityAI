"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { expandBusinessOnlyExamples } = require("../examples/expandBusinessOnlyExamples");

function buildWriteDictionary() {
  return {
    version: 1,
    tools: [
      {
        name: "modify_ui_layout",
        kind: "write",
        input: {
          type: "object",
          additionalProperties: false,
          required: [
            "execution_mode",
            "idempotency_key",
            "based_on_read_token",
            "write_anchor_object_id",
            "write_anchor_path",
            "target_path",
            "width",
            "height",
          ],
          properties: {
            execution_mode: { type: "string", enum: ["validate", "execute"] },
            thread_id: { type: "string" },
            idempotency_key: { type: "string" },
            based_on_read_token: { type: "string" },
            write_anchor_object_id: { type: "string" },
            write_anchor_path: { type: "string" },
            target_path: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        examples: [
          {
            name: "set_button_layout",
            request_business_only: {
              target_path: "Scene/Canvas/Button",
              width: 160,
              height: 48,
            },
          },
        ],
      },
    ],
  };
}

test("expandBusinessOnlyExamples merges required envelope defaults into request", () => {
  const expanded = expandBusinessOnlyExamples(buildWriteDictionary());
  const example = expanded.tools[0].examples[0];

  assert.deepEqual(example.request, {
    execution_mode: "execute",
    idempotency_key: "mock_idempotency_key",
    based_on_read_token: "mock_read_token",
    write_anchor_object_id: "mock_write_anchor_object_id",
    write_anchor_path: "Scene",
    target_path: "Scene/Canvas/Button",
    width: 160,
    height: 48,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(example.request, "thread_id"), false);
});

test("expandBusinessOnlyExamples keeps explicit request untouched", () => {
  const dictionary = buildWriteDictionary();
  dictionary.tools[0].examples[0].request = {
    execution_mode: "validate",
    idempotency_key: "fixed_key",
  };

  const expanded = expandBusinessOnlyExamples(dictionary);
  const example = expanded.tools[0].examples[0];

  assert.deepEqual(example.request, {
    execution_mode: "validate",
    idempotency_key: "fixed_key",
  });
});

test("expandBusinessOnlyExamples does not inject write envelope into read tool examples", () => {
  const dictionary = {
    version: 1,
    tools: [
      {
        name: "get_scene_snapshot_for_write",
        kind: "read",
        input: {
          type: "object",
          additionalProperties: false,
          required: ["scope_path"],
          properties: {
            thread_id: { type: "string" },
            scope_path: { type: "string" },
          },
        },
        examples: [
          {
            name: "read_scope",
            request_business_only: {
              scope_path: "Scene/Canvas",
            },
          },
        ],
      },
    ],
  };

  const expanded = expandBusinessOnlyExamples(dictionary);
  const request = expanded.tools[0].examples[0].request;

  assert.deepEqual(request, { scope_path: "Scene/Canvas" });
  assert.equal(Object.prototype.hasOwnProperty.call(request, "based_on_read_token"), false);
});

