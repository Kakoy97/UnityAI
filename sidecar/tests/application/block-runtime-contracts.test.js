"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const contracts = require("../../src/application/blockRuntime/contracts");

function buildWriteEnvelope() {
  return {
    idempotency_key: "idp_1",
    write_anchor_object_id: "obj_1",
    write_anchor_path: "Scene/Root",
    execution_mode: "sync",
  };
}

test("contracts index exports stable Step1 surface", () => {
  assert.equal(typeof contracts.BLOCK_TYPE, "object");
  assert.equal(typeof contracts.BLOCK_SPEC_SCHEMA, "object");
  assert.equal(typeof contracts.BLOCK_PLAN_SCHEMA, "object");
  assert.equal(typeof contracts.BLOCK_ERROR_SCHEMA, "object");
  assert.equal(typeof contracts.BLOCK_RESULT_SCHEMA, "object");
  assert.equal(typeof contracts.validateBlockSpec, "function");
  assert.equal(typeof contracts.validateBlockPlan, "function");
  assert.equal(typeof contracts.validateBlockError, "function");
  assert.equal(typeof contracts.validateBlockResult, "function");
  assert.equal(typeof contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL, "object");
});

test("S1-T1 block spec accepts read block", () => {
  const outcome = contracts.validateBlockSpec({
    block_id: "read_1",
    block_type: contracts.BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {},
  });
  assert.equal(outcome.ok, true);
});

test("S1-T1 block spec rejects write block without write_envelope", () => {
  const outcome = contracts.validateBlockSpec({
    block_id: "mutate_1",
    block_type: contracts.BLOCK_TYPE.MUTATE,
    intent_key: "mutate.component_properties",
    input: {},
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
});

test("S1-T2 block plan accepts valid dag and atomic group", () => {
  const plan = {
    plan_id: "plan_valid",
    initial_read_token: "rt_1",
    blocks: [
      {
        block_id: "b1",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
      },
      {
        block_id: "b2",
        block_type: contracts.BLOCK_TYPE.CREATE,
        intent_key: "create.object",
        input: { new_object_name: "Container" },
        depends_on: ["b1"],
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
      {
        block_id: "b3",
        block_type: contracts.BLOCK_TYPE.MUTATE,
        intent_key: "mutate.component_properties",
        input: { property_path: "m_Spacing" },
        depends_on: ["b2"],
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, true);
});

test("S1-T2 rejects duplicate block_id", () => {
  const plan = {
    plan_id: "plan_dup",
    blocks: [
      {
        block_id: "x",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
      },
      {
        block_id: "x",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.hierarchy_subtree",
        input: {},
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(
    outcome.errors.some((item) => item.code === "E_BLOCK_PLAN_DUPLICATE_BLOCK_ID"),
    true
  );
});

test("S1-T2 rejects dependency-not-found", () => {
  const plan = {
    plan_id: "plan_dep_missing",
    blocks: [
      {
        block_id: "b1",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["b_missing"],
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(
    outcome.errors.some((item) => item.code === "E_BLOCK_PLAN_DEPENDENCY_NOT_FOUND"),
    true
  );
});

test("S1-T2 rejects dependency cycle", () => {
  const plan = {
    plan_id: "plan_cycle",
    blocks: [
      {
        block_id: "a",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["b"],
      },
      {
        block_id: "b",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.hierarchy_subtree",
        input: {},
        depends_on: ["a"],
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.errors.some((item) => item.code === "E_BLOCK_PLAN_DEPENDENCY_CYCLE"),
    true
  );
});

test("S1-T2 rejects atomic group with non-write block", () => {
  const plan = {
    plan_id: "plan_group_non_write",
    blocks: [
      {
        block_id: "b1",
        block_type: contracts.BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        atomic_group_id: "g1",
      },
      {
        block_id: "b2",
        block_type: contracts.BLOCK_TYPE.MUTATE,
        intent_key: "mutate.component_properties",
        input: {},
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.errors.some(
      (item) => item.code === "E_BLOCK_PLAN_ATOMIC_GROUP_INVALID_BLOCK_TYPE"
    ),
    true
  );
});

test("S1-T2 rejects atomic group too small", () => {
  const plan = {
    plan_id: "plan_group_small",
    blocks: [
      {
        block_id: "b1",
        block_type: contracts.BLOCK_TYPE.MUTATE,
        intent_key: "mutate.component_properties",
        input: {},
        atomic_group_id: "g_single",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const outcome = contracts.validateBlockPlan(plan);
  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.errors.some((item) => item.code === "E_BLOCK_PLAN_ATOMIC_GROUP_TOO_SMALL"),
    true
  );
});

test("S1-T3 block error schema accepts minimal payload", () => {
  const outcome = contracts.validateBlockError({
    error_code: "E_SCHEMA_INVALID",
    error_message: "invalid payload",
  });
  assert.equal(outcome.ok, true);
});

test("S1-T3 block result schema enforces failed->error coupling", () => {
  const outcome = contracts.validateBlockResult({
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
  const outcome = contracts.validateBlockResult({
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

test("S1-T4 block error alias map keeps canonical mapping deterministic", () => {
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_NOT_IMPLEMENTED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_INTENT_KEY_UNSUPPORTED,
    "E_SCHEMA_INVALID"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_PIPELINE_DISABLED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_SCHEMA_INVALID,
    "E_SCHEMA_INVALID"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_TYPE_UNSUPPORTED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_CHANNEL_RESERVED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_CHANNEL_UNSUPPORTED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_VERIFY_FAILED,
    "E_PRECONDITION_FAILED"
  );
  assert.equal(
    contracts.BLOCK_ERROR_ALIAS_TO_CANONICAL.E_BLOCK_FALLBACK_NOT_ALLOWED,
    "E_PRECONDITION_FAILED"
  );
});
