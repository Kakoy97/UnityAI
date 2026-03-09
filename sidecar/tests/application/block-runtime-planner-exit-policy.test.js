"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLANNER_EXIT_POLICY_VERSION,
  EXIT_ACTION,
  EXIT_REASON,
  createPlannerExitPolicy,
} = require("../../src/application/blockRuntime/entry");

test("PLNR-007 planner exit policy exports stable symbols", () => {
  assert.equal(typeof PLANNER_EXIT_POLICY_VERSION, "string");
  assert.equal(PLANNER_EXIT_POLICY_VERSION.length > 0, true);
  assert.equal(EXIT_ACTION.ESCAPE, "escape");
  assert.equal(EXIT_REASON.NO_FAMILY, "no_family");
});

test("PLNR-007 no_family is fail-closed with E_PLANNER_UNSUPPORTED_FAMILY", () => {
  const policy = createPlannerExitPolicy({ enabled: true });
  const decision = policy.evaluate({
    block_spec: {
      block_type: "MUTATE",
      intent_key: "mutate.unknown",
      input: {},
    },
    block_result: {
      status: "failed",
      error: {
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "E_BLOCK_INTENT_KEY_UNSUPPORTED",
      },
    },
  });
  assert.equal(decision.action, EXIT_ACTION.FAIL_CLOSED);
  assert.equal(decision.reason, EXIT_REASON.NO_FAMILY);
  assert.equal(decision.error_code, "E_PLANNER_UNSUPPORTED_FAMILY");
});

test("PLNR-007 no_tool can escape to get_unity_task_status for write.async_ops", () => {
  const policy = createPlannerExitPolicy({ enabled: true });
  const decision = policy.evaluate({
    block_spec: {
      block_type: "MUTATE",
      intent_key: "write.async_ops.get_task_status",
      input: {
        job_id: "job_escape_1",
      },
    },
    block_result: {
      status: "failed",
      error: {
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      },
    },
  });
  assert.equal(decision.action, EXIT_ACTION.ESCAPE);
  assert.equal(decision.escape_tool_name, "get_unity_task_status");
  assert.deepEqual(decision.escape_payload, { job_id: "job_escape_1" });
});

test("PLNR-007 no_tool outside whitelist is fail-closed with exit_not_allowed", () => {
  const policy = createPlannerExitPolicy({ enabled: true });
  const decision = policy.evaluate({
    block_spec: {
      block_type: "MUTATE",
      intent_key: "mutate.set_active",
      input: {
        active: false,
      },
    },
    block_result: {
      status: "failed",
      error: {
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      },
    },
  });
  assert.equal(decision.action, EXIT_ACTION.FAIL_CLOSED);
  assert.equal(decision.reason, EXIT_REASON.EXIT_NOT_ALLOWED);
  assert.equal(decision.error_code, "E_PLANNER_EXIT_NOT_ALLOWED");
});

test("PLNR-007 no_safe_fallback is fail-closed with E_PLANNER_NO_SAFE_FALLBACK", () => {
  const policy = createPlannerExitPolicy({ enabled: true });
  const decision = policy.evaluate({
    block_spec: {
      block_type: "MUTATE",
      intent_key: "mutate.component_properties",
      input: {},
    },
    block_result: {
      status: "failed",
      error: {
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_FALLBACK_NOT_ALLOWED",
      },
    },
  });
  assert.equal(decision.action, EXIT_ACTION.FAIL_CLOSED);
  assert.equal(decision.reason, EXIT_REASON.NO_SAFE_FALLBACK);
  assert.equal(decision.error_code, "E_PLANNER_NO_SAFE_FALLBACK");
});

test("PLNR-007 disabled policy returns passthrough decision", () => {
  const policy = createPlannerExitPolicy({ enabled: false });
  const decision = policy.evaluate({
    block_spec: {
      block_type: "MUTATE",
      intent_key: "mutate.unknown",
      input: {},
    },
    block_result: {
      status: "failed",
      error: {
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "E_BLOCK_INTENT_KEY_UNSUPPORTED",
      },
    },
  });
  assert.equal(decision.action, EXIT_ACTION.PASSTHROUGH);
  assert.equal(decision.applied, false);
});
