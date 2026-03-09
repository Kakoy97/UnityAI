"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BLOCK_TYPE,
  buildBlockPlanIndex,
  validateDependencyGraph,
  validateAtomicGroups,
  validateBlockPlanSemantics,
} = require("../../src/application/blockRuntime/contracts");

function buildWriteEnvelope() {
  return {
    idempotency_key: "idp_1",
    write_anchor_object_id: "obj_1",
    write_anchor_path: "Scene/Root",
    execution_mode: "sync",
  };
}

test("S1-T6 validators: dependency graph passes for valid DAG", () => {
  const plan = {
    plan_id: "plan_valid",
    blocks: [
      {
        block_id: "b1",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
      },
      {
        block_id: "b2",
        block_type: BLOCK_TYPE.MUTATE,
        intent_key: "mutate.set_active",
        input: { active: true },
        depends_on: ["b1"],
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const index = buildBlockPlanIndex(plan);
  const depErrors = validateDependencyGraph(index);
  assert.deepEqual(depErrors, []);
});

test("S1-T6 validators: rejects dangling dependency", () => {
  const plan = {
    plan_id: "plan_missing_dep",
    blocks: [
      {
        block_id: "b1",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["b_missing"],
      },
    ],
  };
  const errors = validateBlockPlanSemantics(plan);
  assert.equal(
    errors.some((item) => item.code === "E_BLOCK_PLAN_DEPENDENCY_NOT_FOUND"),
    true
  );
});

test("S1-T6 validators: rejects dependency cycle", () => {
  const plan = {
    plan_id: "plan_cycle",
    blocks: [
      {
        block_id: "a",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["b"],
      },
      {
        block_id: "b",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.hierarchy_subtree",
        input: {},
        depends_on: ["a"],
      },
    ],
  };
  const errors = validateBlockPlanSemantics(plan);
  assert.equal(
    errors.some((item) => item.code === "E_BLOCK_PLAN_DEPENDENCY_CYCLE"),
    true
  );
});

test("S1-T6 validators: rejects self dependency", () => {
  const plan = {
    plan_id: "plan_self_dep",
    blocks: [
      {
        block_id: "self",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        depends_on: ["self"],
      },
    ],
  };
  const errors = validateBlockPlanSemantics(plan);
  assert.equal(
    errors.some((item) => item.code === "E_BLOCK_PLAN_SELF_DEPENDENCY"),
    true
  );
});

test("S1-T6 validators: rejects atomic group too small", () => {
  const plan = {
    plan_id: "plan_group_small",
    blocks: [
      {
        block_id: "b1",
        block_type: BLOCK_TYPE.MUTATE,
        intent_key: "mutate.component_properties",
        input: {},
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const index = buildBlockPlanIndex(plan);
  const groupErrors = validateAtomicGroups(index);
  assert.equal(
    groupErrors.some((item) => item.code === "E_BLOCK_PLAN_ATOMIC_GROUP_TOO_SMALL"),
    true
  );
});

test("S1-T6 validators: rejects non-write block in atomic group", () => {
  const plan = {
    plan_id: "plan_group_non_write",
    blocks: [
      {
        block_id: "r1",
        block_type: BLOCK_TYPE.READ_STATE,
        intent_key: "read.snapshot_for_write",
        input: {},
        atomic_group_id: "g1",
      },
      {
        block_id: "m1",
        block_type: BLOCK_TYPE.MUTATE,
        intent_key: "mutate.component_properties",
        input: {},
        atomic_group_id: "g1",
        write_envelope: buildWriteEnvelope(),
      },
    ],
  };
  const errors = validateBlockPlanSemantics(plan);
  assert.equal(
    errors.some(
      (item) => item.code === "E_BLOCK_PLAN_ATOMIC_GROUP_INVALID_BLOCK_TYPE"
    ),
    true
  );
});

