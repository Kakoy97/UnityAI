"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  RECOVERY_HOOK_VERSION,
  RECOVERY_OUTCOME,
  createRecoveryHook,
} = require("../../src/application/blockRuntime/hooks");

function buildBaseFailedResult(overrides = {}) {
  return {
    block_id: "recovery_hook_block_1",
    status: "failed",
    output_data: {},
    execution_meta: {
      channel: "execution",
      shape: "single_step",
    },
    error: {
      error_code: "E_SCENE_REVISION_DRIFT",
      error_message: "scene revision drift",
      retry_policy: {
        allow_auto_retry: true,
        max_attempts: 1,
      },
    },
    ...overrides,
  };
}

function buildWriteSpec(overrides = {}) {
  return {
    block_id: "recover_write_1",
    block_type: BLOCK_TYPE.MUTATE,
    ...overrides,
  };
}

test("S5-T2 recovery hook exports stable symbols", () => {
  assert.equal(typeof RECOVERY_HOOK_VERSION, "string");
  assert.equal(RECOVERY_HOOK_VERSION.length > 0, true);
  assert.equal(RECOVERY_OUTCOME.SKIPPED, "skipped");
  assert.equal(RECOVERY_OUTCOME.SUCCEEDED, "succeeded");
  assert.equal(RECOVERY_OUTCOME.FAILED, "failed");
});

test("S5-T2 skips recovery when block_result is not failed", async () => {
  const hook = createRecoveryHook();
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: {
      block_id: "ok_1",
      status: "succeeded",
      output_data: {},
      execution_meta: {
        channel: "execution",
        shape: "single_step",
      },
    },
    retryExecutor: async () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(outcome.recovery_failure_reason, "block_result_not_failed");
});

test("S5-T2 skips recovery for non-write block types", async () => {
  const hook = createRecoveryHook();
  const outcome = await hook.runRecovery({
    blockSpec: {
      block_id: "read_1",
      block_type: BLOCK_TYPE.READ_STATE,
    },
    blockResult: buildBaseFailedResult(),
    retryExecutor: async () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(
    outcome.recovery_failure_reason,
    "block_type_not_recovery_eligible"
  );
});

test("S5-T2 skips recovery when error code is not allowlisted", async () => {
  const hook = createRecoveryHook();
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult({
      error: {
        error_code: "E_COMPONENT_NOT_FOUND",
        error_message: "component missing",
        retry_policy: {
          allow_auto_retry: true,
          max_attempts: 1,
        },
      },
    }),
    retryExecutor: async () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(outcome.recovery_failure_reason, "error_code_not_allowlisted");
});

test("S5-T2 skips recovery when token auto-retry already succeeded", async () => {
  const hook = createRecoveryHook();
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult({
      output_data: {
        token_automation: {
          auto_retry_attempted: true,
          auto_retry_succeeded: true,
        },
      },
    }),
    retryExecutor: async () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(
    outcome.recovery_failure_reason,
    "token_auto_retry_already_succeeded"
  );
});

test("S5-T2 skips recovery when retry policy disallows auto retry", async () => {
  const hook = createRecoveryHook();
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult({
      error: {
        error_code: "E_SCENE_REVISION_DRIFT",
        error_message: "scene revision drift",
        retry_policy: {
          allow_auto_retry: false,
          max_attempts: 0,
        },
      },
    }),
    retryExecutor: async () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(
    outcome.recovery_failure_reason,
    "retry_policy_disallows_auto_retry"
  );
});

test("S5-T2 attempts recovery once and succeeds when retry succeeds", async () => {
  const hook = createRecoveryHook();
  let calls = 0;
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult(),
    retryExecutor: async () => {
      calls += 1;
      return {
        block_id: "recovery_hook_block_1",
        status: "succeeded",
        output_data: {
          active: true,
        },
        execution_meta: {
          channel: "execution",
          shape: "single_step",
        },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.recovery_attempted, true);
  assert.equal(outcome.recovery_attempt_count, 1);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SUCCEEDED);
  assert.equal(outcome.block_result.status, "succeeded");
  assert.equal(outcome.block_result.execution_meta.recovery_attempted, true);
  assert.equal(
    outcome.block_result.execution_meta.recovery_initial_error_code,
    "E_SCENE_REVISION_DRIFT"
  );
});

test("S5-T2 attempts recovery once and reports failed outcome when retry fails", async () => {
  const hook = createRecoveryHook();
  let calls = 0;
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult({
      error: {
        error_code: "E_TARGET_ANCHOR_CONFLICT",
        error_message: "anchor conflict",
        retry_policy: {
          allow_auto_retry: true,
          max_attempts: 1,
        },
      },
    }),
    retryExecutor: async () => {
      calls += 1;
      return {
        block_id: "recovery_hook_block_1",
        status: "failed",
        output_data: {},
        execution_meta: {
          channel: "execution",
          shape: "single_step",
        },
        error: {
          error_code: "E_TARGET_NOT_FOUND",
          error_message: "target missing",
        },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, true);
  assert.equal(outcome.recovery_attempt_count, 1);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.FAILED);
  assert.equal(outcome.recovery_failure_reason, "retry_failed");
  assert.equal(outcome.block_result.status, "failed");
  assert.equal(
    outcome.block_result.execution_meta.recovery_initial_error_code,
    "E_TARGET_ANCHOR_CONFLICT"
  );
  assert.equal(
    outcome.block_result.execution_meta.recovery_retry_error_code,
    "E_TARGET_NOT_FOUND"
  );
});

test("S5-T2 enforces single-attempt upper bound", async () => {
  const hook = createRecoveryHook();
  let calls = 0;
  const outcome = await hook.runRecovery({
    blockSpec: buildWriteSpec(),
    blockResult: buildBaseFailedResult(),
    recoveryAttemptCount: 1,
    retryExecutor: async () => {
      calls += 1;
      return buildBaseFailedResult();
    },
  });

  assert.equal(calls, 0);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.recovery_attempted, false);
  assert.equal(outcome.recovery_attempt_count, 1);
  assert.equal(outcome.recovery_outcome, RECOVERY_OUTCOME.SKIPPED);
  assert.equal(
    outcome.recovery_failure_reason,
    "recovery_attempt_limit_reached"
  );
});

