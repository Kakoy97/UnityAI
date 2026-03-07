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

test("emitDtosCs generates nested DTOs for object and object-array properties", () => {
  const output = emitDtosCs({
    version: 1,
    _definitions: {
      transaction_step: {
        type: "object",
        properties: {
          step_id: { type: "string" },
          tool_name: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    tools: [
      {
        name: "get_ui_tree",
        input: {
          type: "object",
          properties: {
            root_path: { type: "string" },
            scope: {
              type: "object",
              properties: {
                root_path: { type: "string" },
              },
            },
            resolution: {
              type: "object",
              properties: {
                width: { type: "integer" },
                height: { type: "integer" },
              },
            },
          },
        },
      },
      {
        name: "execute_unity_transaction",
        input: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            steps: {
              type: "array",
              items: {
                $ref: "#/_definitions/transaction_step",
              },
            },
          },
        },
      },
    ],
  });

  assert.match(output, /public sealed class GetUiTreeRequestDtoScopeDto/);
  assert.match(output, /public GetUiTreeRequestDtoScopeDto scope;/);
  assert.match(output, /public sealed class GetUiTreeRequestDtoResolutionDto/);
  assert.match(output, /public int width;/);
  assert.match(output, /public int height;/);

  assert.match(output, /public sealed class ExecuteUnityTransactionRequestDtoStepsItemDto/);
  assert.match(output, /public ExecuteUnityTransactionRequestDtoStepsItemDto\[\] steps;/);
  assert.match(output, /public Dictionary<string, object> payload;/);
});

test("emitDtosCs keeps non-transaction open-shape objects as string", () => {
  const output = emitDtosCs({
    version: 1,
    tools: [
      {
        name: "preflight_validate_write_payload",
        input: {
          type: "object",
          required: ["tool_name", "payload"],
          properties: {
            tool_name: { type: "string" },
            payload: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
    ],
  });

  assert.match(output, /public sealed class PreflightValidateWritePayloadRequestDto/);
  assert.match(output, /public string payload;/);
  assert.doesNotMatch(output, /public Dictionary<string, object> payload;/);
});

test("emitDtosCs emits create-family global contract constants from definitions", () => {
  const output = emitDtosCs({
    version: 1,
    _definitions: {
      create_family: {
        pre_check_policy: {
          check_existing: true,
          on_conflict: "suffix",
          return_candidates: true,
          policy_field: "name_collision_policy",
        },
      },
      ambiguity_resolution_policy_contract: {
        name_collision: {
          allowed_policies: ["fail", "suffix", "reuse"],
          default_policy: "fail",
        },
      },
    },
    tools: [
      {
        name: "create_object",
        input: {
          type: "object",
          properties: {
            new_object_name: { type: "string" },
            name_collision_policy: {
              type: "string",
              enum: ["fail", "suffix", "reuse"],
            },
          },
        },
      },
    ],
  });

  assert.match(output, /public static class SsotCreateFamilyContract/);
  assert.match(output, /public const bool PreCheckEnabled = true;/);
  assert.match(output, /public const string DefaultOnConflict = "suffix";/);
  assert.match(output, /public const string PolicyField = "name_collision_policy";/);
  assert.match(output, /public static readonly string\[\] AllowedOnConflictPolicies = new\[] \{ "fail", "suffix", "reuse" \};/);
  assert.match(output, /public string name_collision_policy;/);
});
