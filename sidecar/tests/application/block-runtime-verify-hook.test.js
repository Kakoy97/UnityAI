"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  VERIFY_HOOK_VERSION,
  VERIFY_STATUS,
  createVerifyHook,
} = require("../../src/application/blockRuntime/hooks");

function buildBaseResult(overrides = {}) {
  return {
    block_id: "verify_hook_block_1",
    status: "succeeded",
    output_data: {},
    execution_meta: {
      channel: "execution",
      shape: "single_step",
    },
    ...overrides,
  };
}

function buildCreateSpec(overrides = {}) {
  return {
    block_id: "create_verify_1",
    block_type: BLOCK_TYPE.CREATE,
    ...overrides,
  };
}

function buildMutateSpec(overrides = {}) {
  return {
    block_id: "mutate_verify_1",
    block_type: BLOCK_TYPE.MUTATE,
    ...overrides,
  };
}

test("S5-T1 verify hook exports stable symbols", () => {
  assert.equal(typeof VERIFY_HOOK_VERSION, "string");
  assert.equal(VERIFY_HOOK_VERSION.length > 0, true);
  assert.equal(VERIFY_STATUS.PASSED, "passed");
  assert.equal(VERIFY_STATUS.FAILED, "failed");
  assert.equal(VERIFY_STATUS.SKIPPED, "skipped");
});

test("S5-T1 CREATE verify passes when output_data contains target_object_id and target_path", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: buildCreateSpec(),
    blockResult: buildBaseResult({
      output_data: {
        target_object_id: "GlobalObjectId_V1-created",
        target_path: "Scene/Canvas/Created",
      },
    }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verify_status, VERIFY_STATUS.PASSED);
  assert.equal(outcome.block_result.status, "succeeded");
  assert.equal(
    outcome.block_result.execution_meta.verify_status,
    VERIFY_STATUS.PASSED
  );
});

test("S5-T1 CREATE verify fail-closes when target_path is missing", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: buildCreateSpec(),
    blockResult: buildBaseResult({
      output_data: {
        target_object_id: "GlobalObjectId_V1-created",
      },
    }),
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.verify_status, VERIFY_STATUS.FAILED);
  assert.equal(outcome.verify_failure_reason, "create_target_path_missing");
  assert.equal(outcome.block_result.status, "failed");
  assert.equal(outcome.block_result.error.error_code, "E_PRECONDITION_FAILED");
  assert.equal(
    outcome.block_result.error.block_error_code,
    "E_BLOCK_VERIFY_FAILED"
  );
  assert.equal(
    outcome.block_result.execution_meta.verify_status,
    VERIFY_STATUS.FAILED
  );
  assert.equal(
    outcome.block_result.execution_meta.verify_failure_reason,
    "create_target_path_missing"
  );
  assert.equal(
    outcome.block_result.error.retry_policy.allow_auto_retry,
    false
  );
});

test("S5-T1 MUTATE verify passes when output_data is non-empty object", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: buildMutateSpec(),
    blockResult: buildBaseResult({
      output_data: {
        active: false,
      },
    }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verify_status, VERIFY_STATUS.PASSED);
  assert.equal(outcome.block_result.status, "succeeded");
  assert.equal(
    outcome.block_result.execution_meta.verify_status,
    VERIFY_STATUS.PASSED
  );
});

test("S5-T1 MUTATE verify fail-closes when output_data is empty", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: buildMutateSpec(),
    blockResult: buildBaseResult({
      output_data: {},
    }),
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.verify_status, VERIFY_STATUS.FAILED);
  assert.equal(outcome.verify_failure_reason, "mutate_output_empty");
  assert.equal(outcome.block_result.status, "failed");
  assert.equal(
    outcome.block_result.error.block_error_code,
    "E_BLOCK_VERIFY_FAILED"
  );
});

test("S5-T1 READ_STATE is skipped by verify hook", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: {
      block_id: "read_verify_1",
      block_type: BLOCK_TYPE.READ_STATE,
    },
    blockResult: buildBaseResult({
      output_data: {
        scene_revision: "ssot_rev_read",
      },
    }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verify_status, VERIFY_STATUS.SKIPPED);
  assert.equal(outcome.verify_failure_reason, "read_state_no_verify");
  assert.equal(outcome.block_result.status, "succeeded");
  assert.equal(
    outcome.block_result.execution_meta.verify_status,
    VERIFY_STATUS.SKIPPED
  );
});

test("S5-T1 failed block_result short-circuits verify and remains skipped", () => {
  const hook = createVerifyHook();
  const outcome = hook.runVerify({
    blockSpec: buildMutateSpec(),
    blockResult: buildBaseResult({
      status: "failed",
      error: {
        error_code: "E_SCENE_REVISION_DRIFT",
        error_message: "scene revision drift",
      },
    }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verify_status, VERIFY_STATUS.SKIPPED);
  assert.equal(outcome.verify_failure_reason, "block_result_not_succeeded");
  assert.equal(outcome.block_result.status, "failed");
  assert.equal(outcome.block_result.error.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(
    outcome.block_result.execution_meta.verify_status,
    VERIFY_STATUS.SKIPPED
  );
});

