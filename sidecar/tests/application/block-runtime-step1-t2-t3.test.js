"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateBlockPlan,
} = require("../../src/application/blockRuntime/contracts/blockPlanSchema");
const {
  validateBlockSpec,
} = require("../../src/application/blockRuntime/contracts/blockSpecSchema");
const {
  validateBlockError,
} = require("../../src/application/blockRuntime/contracts/blockErrorSchema");
const {
  validateBlockResult,
} = require("../../src/application/blockRuntime/contracts/blockResultSchema");

function buildWriteEnvelope() {
  return {
    idempotency_key: "idp_1",
    write_anchor_object_id: "obj_1",
    write_anchor_path: "Scene/Root",
    execution_mode: "sync",
  };
}

test("S1-T1 block spec schema accepts read block", () => {
  const outcome = validateBlockSpec({
    block_id: "r1",
    block_type: "READ_STATE",
    intent_key: "read.snapshot_for_write",
    input: {},
  });
  assert.equal(outcome.ok, true);
});

test("S1-T1 block spec schema rejects write block without write_envelope", () => {
  const outcome = validateBlockSpec({
    block_id: "m1",
    block_type: "MUTATE",
    intent_key: "mutate.component_properties",
    input: {},
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
});

test("S1-T2 block plan schema accepts valid plan", () => {
  const plan = {
    plan_id: "plan_1",
    initial_read_token: "rt_1",
    blocks: [
      {
        block_id: "b1",
        block_type: "READ_STATE",
        intent_key: "read.snapshot_for_write",
        input: {},
      },
      {
        block_id: "b2",
        block_type: "MUTATE",
        intent_key: "mutate.component_properties",
        input: {
          component_type: "UnityEngine.Transform",
        },
        depends_on: ["b1"],
        atomicity_required: true,
        write_envelope: buildWriteEnvelope(),
      },
      {
        block_id: "b3",
        block_type: "CREATE",
        intent_key: "create.object",
        input: {
          new_object_name: "Cube",
        },
        depends_on: ["b2"],
        atomicity_required: true,
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
      {
        block_id: "b4",
        block_type: "MUTATE",
        intent_key: "mutate.set_active",
        input: {
          active: true,
        },
        depends_on: ["b3"],
        atomicity_required: true,
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };

  const outcome = validateBlockPlan(plan);
  assert.equal(outcome.ok, true);
});

test("S1-T2 rejects write block without write_envelope", () => {
  const plan = {
    plan_id: "plan_missing_envelope",
    blocks: [
      {
        block_id: "b1",
        block_type: "MUTATE",
        intent_key: "mutate.component_properties",
        input: {},
      },
    ],
  };
  const outcome = validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
});

test("S1-T2 rejects dependency cycle", () => {
  const plan = {
    plan_id: "plan_cycle",
    blocks: [
      {
        block_id: "a",
        block_type: "READ_STATE",
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["b"],
      },
      {
        block_id: "b",
        block_type: "READ_STATE",
        intent_key: "read.hierarchy_subtree",
        input: {},
        depends_on: ["a"],
      },
    ],
  };
  const outcome = validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(
    outcome.errors.some((entry) => entry.code === "E_BLOCK_PLAN_DEPENDENCY_CYCLE"),
    true
  );
});

test("S1-T3 block error schema accepts minimal valid payload", () => {
  const outcome = validateBlockError({
    error_code: "E_SCHEMA_INVALID",
    error_message: "Invalid payload",
  });
  assert.equal(outcome.ok, true);
});

test("S1-T3 block result schema requires error when status failed", () => {
  const outcome = validateBlockResult({
    block_id: "b1",
    status: "failed",
    execution_meta: {
      channel: "execution",
      shape: "single_step",
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
});

test("S1-T3 block result schema accepts succeeded payload", () => {
  const outcome = validateBlockResult({
    block_id: "b1",
    status: "succeeded",
    output_data: {},
    scene_revision: "ssot_rev_1",
    read_token_candidate: "rt_2",
    execution_meta: {
      channel: "execution",
      shape: "single_step",
    },
  });
  assert.equal(outcome.ok, true);
});
