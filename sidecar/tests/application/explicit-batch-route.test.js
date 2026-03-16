"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { decideExplicitBatchMode } = require("../../src/application/turnService");

function buildWritePayload(overrides = {}) {
  return {
    execution_mode: "execute",
    based_on_read_token: "ssot_rt_batch_route",
    write_anchor_object_id: "GlobalObjectId_V1-canvas",
    write_anchor_path: "Scene/Canvas",
    target_object_id: "GlobalObjectId_V1-target",
    target_path: "Scene/Canvas/Button",
    ...overrides,
  };
}

function buildBatchPlan({
  atomicityPreference = "auto",
  firstToolName = "set_active",
  secondToolName = "set_sibling_index",
  firstPayloadOverrides = {},
  secondPayloadOverrides = {},
} = {}) {
  return {
    entry_domain: "batch_entry",
    atomicity_preference: atomicityPreference,
    failure_policy: "stop_on_first_failure",
    step_count: 2,
    steps: [
      {
        step_id: "batch_step_1",
        tool_name: firstToolName,
        payload: buildWritePayload({
          active: true,
          ...firstPayloadOverrides,
        }),
      },
      {
        step_id: "batch_step_2",
        tool_name: secondToolName,
        payload: buildWritePayload({
          target_object_id: "GlobalObjectId_V1-target_2",
          target_path: "Scene/Canvas/Button/Label",
          sibling_index: 2,
          ...secondPayloadOverrides,
        }),
      },
    ],
  };
}

test("BATCH-003 required + transaction-capable batch routes to transaction", () => {
  assert.equal(typeof decideExplicitBatchMode, "function");

  const decision = decideExplicitBatchMode({
    batchPlan: buildBatchPlan({
      atomicityPreference: "required",
    }),
  });

  assert.equal(decision.mode, "transaction");
});

test("BATCH-003 required + non-transaction-capable batch routes to fail_fast", () => {
  assert.equal(typeof decideExplicitBatchMode, "function");

  const decision = decideExplicitBatchMode({
    batchPlan: buildBatchPlan({
      atomicityPreference: "required",
      secondPayloadOverrides: {
        write_anchor_object_id: "GlobalObjectId_V1-other",
        write_anchor_path: "Scene/Other",
      },
    }),
  });

  assert.equal(decision.mode, "fail_fast");
});

test("BATCH-003 auto + transaction-capable batch routes to transaction", () => {
  assert.equal(typeof decideExplicitBatchMode, "function");

  const decision = decideExplicitBatchMode({
    batchPlan: buildBatchPlan({
      atomicityPreference: "auto",
    }),
  });

  assert.equal(decision.mode, "transaction");
});

test("BATCH-003 auto + non-transaction-capable batch routes to sequential_batch", () => {
  assert.equal(typeof decideExplicitBatchMode, "function");

  const decision = decideExplicitBatchMode({
    batchPlan: buildBatchPlan({
      atomicityPreference: "auto",
      secondPayloadOverrides: {
        write_anchor_object_id: "GlobalObjectId_V1-other",
        write_anchor_path: "Scene/Other",
      },
    }),
  });

  assert.equal(decision.mode, "sequential_batch");
});

test("BATCH-003 none routes to sequential_batch even when transaction-capable", () => {
  assert.equal(typeof decideExplicitBatchMode, "function");

  const decision = decideExplicitBatchMode({
    batchPlan: buildBatchPlan({
      atomicityPreference: "none",
    }),
  });

  assert.equal(decision.mode, "sequential_batch");
});
