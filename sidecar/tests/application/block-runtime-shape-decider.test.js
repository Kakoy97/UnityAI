"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  EXECUTION_SHAPE_DECIDER_VERSION,
  SHAPE,
  createExecutionShapeDecider,
} = require("../../src/application/blockRuntime/shape");

function buildWriteEnvelope() {
  return {
    idempotency_key: "idp_shape",
    write_anchor_object_id: "GlobalObjectId_V1-canvas",
    write_anchor_path: "Scene/Canvas",
    execution_mode: "execute",
  };
}

function buildCreateBlock(id, options = {}) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.CREATE,
    intent_key: "create.object",
    input: {
      new_object_name: `${id}_obj`,
      object_kind: "ui_panel",
      set_active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-canvas",
      path: "Scene/Canvas",
    },
    write_envelope: buildWriteEnvelope(),
    ...options,
  };
}

function buildMutateBlock(id, options = {}) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Target",
    },
    write_envelope: buildWriteEnvelope(),
    ...options,
  };
}

function buildPhase2CandidateRule() {
  return {
    rule_id: "same_anchor_write_2_4_default",
    enabled: true,
    priority: 100,
    allow_when: {
      same_target_anchor: true,
      write_block_count: {
        min: 2,
        max: 4,
      },
      all_steps_transaction_enabled: true,
      dependencies_explicit: true,
      disallow_async_wait_compile: true,
    },
    deny_when: {
      token_source_unknown: true,
      cross_object_dependency_inferred: true,
      target_anchor_ambiguous: true,
      contains_async_wait_compile_step: true,
    },
    reason_code_on_allow: "transaction_candidate_same_anchor_writes",
    reason_code_on_deny: "transaction_candidate_blocked_phase2a_constraints",
  };
}

function assertShapeDecisionContract(decision) {
  assert.equal(typeof decision, "object");
  assert.equal(
    decision.shape === SHAPE.SINGLE_STEP || decision.shape === SHAPE.TRANSACTION,
    true
  );
  assert.equal(typeof decision.shape_reason, "string");
  assert.equal(decision.shape_reason.length > 0, true);
  assert.equal(typeof decision.shape_degraded, "boolean");
}

test("S4-T1 shape decider exports stable contract symbols", () => {
  assert.equal(typeof EXECUTION_SHAPE_DECIDER_VERSION, "string");
  assert.equal(EXECUTION_SHAPE_DECIDER_VERSION.length > 0, true);
  assert.equal(SHAPE.SINGLE_STEP, "single_step");
  assert.equal(SHAPE.TRANSACTION, "transaction");
});

test("S4-T1 force_single_step has highest priority", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildMutateBlock("force_block"),
    runtime_flags: {
      force_single_step: true,
    },
    execution_context: {
      transaction_capable: true,
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(decision.shape_reason, "forced_by_block_runtime_flag");
  assert.equal(decision.shape_degraded, false);
});

test("S4-T1 READ_STATE/VERIFY are always single_step", () => {
  const decider = createExecutionShapeDecider();
  const readDecision = decider.decideExecutionShape({
    block_spec: {
      block_id: "read_shape_1",
      block_type: BLOCK_TYPE.READ_STATE,
      intent_key: "read.snapshot_for_write",
      input: {},
    },
  });
  assertShapeDecisionContract(readDecision);
  assert.equal(readDecision.shape, SHAPE.SINGLE_STEP);
  assert.equal(readDecision.shape_reason, "read_or_verify_single_step");

  const verifyDecision = decider.decideExecutionShape({
    block_spec: {
      block_id: "verify_shape_1",
      block_type: BLOCK_TYPE.VERIFY,
      intent_key: "verify.block",
      input: {},
    },
  });
  assertShapeDecisionContract(verifyDecision);
  assert.equal(verifyDecision.shape, SHAPE.SINGLE_STEP);
  assert.equal(verifyDecision.shape_reason, "read_or_verify_single_step");
});

test("S4-T1 transaction candidate becomes transaction when transaction_capable=true", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildCreateBlock("candidate_anchor"),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_txn_1",
        blocks: [
          buildCreateBlock("create_1", {
            atomic_group_id: "grp_1",
          }),
          buildMutateBlock("mutate_1", {
            atomic_group_id: "grp_1",
            depends_on: ["create_1"],
          }),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.TRANSACTION);
  assert.equal(decision.shape_reason, "transaction_candidate_confirmed");
  assert.equal(decision.shape_degraded, false);
});

test("S4-T1 transaction candidate degrades when transaction_capable=false", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildCreateBlock("candidate_degrade"),
    execution_context: {
      transaction_capable: false,
      block_plan: {
        plan_id: "plan_shape_txn_2",
        blocks: [
          buildCreateBlock("create_2", {
            atomic_group_id: "grp_2",
          }),
          buildMutateBlock("mutate_2", {
            atomic_group_id: "grp_2",
            depends_on: ["create_2"],
          }),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(decision.shape_reason, "transaction_capability_unavailable");
  assert.equal(decision.shape_degraded, true);
  assert.equal(decision.original_shape, SHAPE.TRANSACTION);
});

test("S4-T1 invalid block_plan does fail-open single_step with validation_failed", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildMutateBlock("invalid_plan"),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_invalid",
        blocks: [
          {
            block_id: "bad_write",
            block_type: BLOCK_TYPE.MUTATE,
            intent_key: "mutate.set_active",
            input: {
              active: true,
            },
          },
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(decision.shape_reason, "validation_failed");
  assert.equal(decision.shape_degraded, true);
  assert.equal(decision.original_shape, SHAPE.TRANSACTION);
});

test("S4-T1 non-candidate multi-write plan falls back to insufficient_atomicity_requirements", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildMutateBlock("not_candidate"),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_non_candidate",
        blocks: [
          buildCreateBlock("create_nc"),
          buildMutateBlock("mutate_nc"),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(decision.shape_reason, "insufficient_atomicity_requirements");
  assert.equal(decision.shape_degraded, false);
});

test("S4-T2 decision contract is stable across core matrix", () => {
  const decider = createExecutionShapeDecider();
  const scenarios = [
    {
      input: {
        block_spec: buildCreateBlock("single_create"),
      },
      expected_shape: SHAPE.SINGLE_STEP,
      expected_reason: "single_block_or_missing_plan",
      expected_degraded: false,
    },
    {
      input: {
        block_spec: buildMutateBlock("force_case"),
        runtime_flags: {
          force_single_step: true,
        },
      },
      expected_shape: SHAPE.SINGLE_STEP,
      expected_reason: "forced_by_block_runtime_flag",
      expected_degraded: false,
    },
    {
      input: {
        block_spec: buildCreateBlock("tx_case"),
        execution_context: {
          transaction_capable: true,
          block_plan: {
            plan_id: "plan_shape_contract_matrix_tx",
            blocks: [
              buildCreateBlock("tx_a", { atomic_group_id: "tx_grp" }),
              buildMutateBlock("tx_b", {
                atomic_group_id: "tx_grp",
                depends_on: ["tx_a"],
              }),
            ],
          },
        },
      },
      expected_shape: SHAPE.TRANSACTION,
      expected_reason: "transaction_candidate_confirmed",
      expected_degraded: false,
    },
  ];

  for (const scenario of scenarios) {
    const decision = decider.decideExecutionShape(scenario.input);
    assertShapeDecisionContract(decision);
    assert.equal(decision.shape, scenario.expected_shape);
    assert.equal(decision.shape_reason, scenario.expected_reason);
    assert.equal(decision.shape_degraded, scenario.expected_degraded);
  }
});

test("S4-T2 transaction candidate can be formed by all-write atomicity + dependency without atomic_group", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildMutateBlock("atomic_required_entry"),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_atomic_required_candidate",
        blocks: [
          buildCreateBlock("atomic_a", {
            atomicity_required: true,
          }),
          buildMutateBlock("atomic_b", {
            atomicity_required: true,
            depends_on: ["atomic_a"],
          }),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.TRANSACTION);
  assert.equal(decision.shape_reason, "transaction_candidate_confirmed");
  assert.equal(decision.shape_degraded, false);
});

test("S4-T2 non-degraded decisions do not carry degraded-only fields", () => {
  const decider = createExecutionShapeDecider();
  const decision = decider.decideExecutionShape({
    block_spec: buildCreateBlock("no_degrade_fields"),
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape_degraded, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, "original_shape"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, "degraded_reason"), false);
});

test("S4-T2 custom validateBlockPlan injection is honored", () => {
  let called = 0;
  const decider = createExecutionShapeDecider({
    validateBlockPlan() {
      called += 1;
      return {
        ok: false,
      };
    },
  });
  const decision = decider.decideExecutionShape({
    block_spec: buildMutateBlock("inject_validation"),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_custom_validator",
        blocks: [
          buildCreateBlock("cv_a", { atomic_group_id: "cv_grp" }),
          buildMutateBlock("cv_b", {
            atomic_group_id: "cv_grp",
            depends_on: ["cv_a"],
          }),
        ],
      },
    },
  });
  assert.equal(called, 1);
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(decision.shape_reason, "validation_failed");
  assert.equal(decision.shape_degraded, true);
});

test("S6.1-T4 rule-driven candidate confirms transaction on same-anchor write plan", () => {
  const decider = createExecutionShapeDecider({
    transactionCandidateRules: [buildPhase2CandidateRule()],
    transactionEnabledToolNames: ["create_object", "set_active"],
  });
  const anchor = {
    object_id: "GlobalObjectId_V1-canvas",
    path: "Scene/Canvas",
  };
  const decision = decider.decideExecutionShape({
    block_spec: buildCreateBlock("rule_tx_entry", { target_anchor: anchor }),
    execution_context: {
      transaction_capable: true,
      plan_initial_read_token: "ssot_rt_plan_rule_1",
      block_plan: {
        plan_id: "plan_shape_rule_txn_1",
        blocks: [
          buildCreateBlock("rule_txn_create_1", {
            target_anchor: anchor,
          }),
          buildMutateBlock("rule_txn_mutate_1", {
            target_anchor: anchor,
            depends_on: ["rule_txn_create_1"],
          }),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.TRANSACTION);
  assert.equal(decision.shape_reason, "transaction_candidate_same_anchor_writes");
  assert.equal(decision.shape_degraded, false);
});

test("S6.1-T4 rule-driven candidate denies transaction when token source is unknown", () => {
  const decider = createExecutionShapeDecider({
    transactionCandidateRules: [buildPhase2CandidateRule()],
    transactionEnabledToolNames: ["create_object", "set_active"],
  });
  const anchor = {
    object_id: "GlobalObjectId_V1-canvas",
    path: "Scene/Canvas",
  };
  const decision = decider.decideExecutionShape({
    block_spec: buildCreateBlock("rule_tx_deny_entry", { target_anchor: anchor }),
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_shape_rule_txn_deny_1",
        blocks: [
          buildCreateBlock("rule_deny_create_1", {
            target_anchor: anchor,
          }),
          buildMutateBlock("rule_deny_mutate_1", {
            target_anchor: anchor,
            depends_on: ["rule_deny_create_1"],
          }),
        ],
      },
    },
  });
  assertShapeDecisionContract(decision);
  assert.equal(decision.shape, SHAPE.SINGLE_STEP);
  assert.equal(
    decision.shape_reason,
    "transaction_candidate_blocked_phase2a_constraints"
  );
  assert.equal(decision.shape_degraded, false);
});
