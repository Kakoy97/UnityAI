"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPlannerEntryNormalizer,
} = require("../../src/application/blockRuntime/entry");

function buildBatchUxContract() {
  return {
    domain: "batch_entry",
    block_type_enum: ["BATCH_COMMAND"],
    required_business_fields: [
      "commands",
      "commands[].tool_name",
      "commands[].payload",
    ],
    system_fields: ["thread_id"],
    auto_filled_fields: [],
    minimal_valid_template: {
      commands: [
        {
          tool_name: "set_active",
          payload: {
            target_object_id: "GlobalObjectId_V1-target",
            target_path: "Scene/Canvas/Image",
            active: false,
          },
        },
      ],
      atomicity_preference: "auto",
      failure_policy: "stop_on_first_failure",
    },
  };
}

test("BATCH-002 normalizer rewrites explicit batch facade into internal batch plan", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildBatchUxContract(),
  });

  const outcome = normalizer.normalizePayload({
    commands: [
      {
        tool_name: "set_active",
        payload: {
          target_object_id: "GlobalObjectId_V1-target_a",
          target_path: "Scene/Canvas/A",
          active: false,
        },
      },
      {
        tool_name: "add_component",
        payload: {
          target_object_id: "GlobalObjectId_V1-target_b",
          target_path: "Scene/Canvas/B",
          component_type: "UnityEngine.CanvasGroup, UnityEngine.UI",
        },
      },
    ],
    atomicity_preference: "auto",
    failure_policy: "stop_on_first_failure",
  });

  assert.equal(outcome.ok, true);
  assert.equal(typeof outcome.payload.batch_plan, "object");
  assert.equal(outcome.payload.batch_plan.entry_domain, "batch_entry");
  assert.equal(outcome.payload.batch_plan.atomicity_preference, "auto");
  assert.equal(
    outcome.payload.batch_plan.failure_policy,
    "stop_on_first_failure"
  );
  assert.equal(Array.isArray(outcome.payload.batch_plan.steps), true);
  assert.equal(outcome.payload.batch_plan.steps.length, 2);
  assert.equal(outcome.payload.batch_plan.steps[0].tool_name, "set_active");
  assert.deepEqual(outcome.payload.batch_plan.steps[0].payload, {
    target_object_id: "GlobalObjectId_V1-target_a",
    target_path: "Scene/Canvas/A",
    active: false,
  });
  assert.equal(
    typeof outcome.payload.batch_plan.steps[0].step_id,
    "string"
  );
  assert.equal(outcome.payload.batch_plan.steps[1].tool_name, "add_component");
  assert.deepEqual(outcome.payload.batch_plan.steps[1].payload, {
    target_object_id: "GlobalObjectId_V1-target_b",
    target_path: "Scene/Canvas/B",
    component_type: "UnityEngine.CanvasGroup, UnityEngine.UI",
  });
});

test("BATCH-002 normalizer rejects explicit batch facade when a command is invalid", () => {
  const normalizer = createPlannerEntryNormalizer({
    uxContract: buildBatchUxContract(),
  });

  const outcome = normalizer.normalizePayload({
    commands: [
      {
        payload: {
          target_object_id: "GlobalObjectId_V1-target_a",
          target_path: "Scene/Canvas/A",
          active: false,
        },
      },
    ],
    atomicity_preference: "auto",
    failure_policy: "stop_on_first_failure",
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(
    outcome.error_message,
    "commands[0].tool_name is required for batch facade"
  );
});
