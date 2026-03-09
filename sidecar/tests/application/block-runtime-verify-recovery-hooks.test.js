"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");

function createService({
  blockPipelineEnabled,
  blockBypassRouter,
  blockForceSingleStep,
  blockVerifyRecoveryEnabled,
}) {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => "2026-03-08T00:00:00.000Z",
    blockPipelineEnabled: blockPipelineEnabled === true,
    blockBypassRouter: blockBypassRouter !== false,
    blockForceSingleStep: blockForceSingleStep === true,
    blockVerifyRecoveryEnabled: blockVerifyRecoveryEnabled === true,
    fileActionExecutor: {
      execute() {
        return {
          ok: true,
          changes: [],
        };
      },
    },
  });
}

function buildWriteBlockSpec(overrides = {}) {
  return {
    block_id: "s5_t5_write_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_s5_t5",
    write_envelope: {
      idempotency_key: "idp_s5_t5_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

test("S5-T5 verify_recovery_enabled=true does not invoke recovery hook on first-pass verify success", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: true,
  });
  let recoveryCalled = 0;
  service.getBlockRuntimeRecoveryHook = () => ({
    async runRecovery() {
      recoveryCalled += 1;
      throw new Error("recovery should not run on first-pass success");
    },
  });
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      return {
        block_id: blockSpec.block_id,
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

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.execution_meta.verify_status, "passed");
  assert.equal(recoveryCalled, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.execution_meta,
      "recovery_outcome"
    ),
    false
  );
});

test("S5-T5 verify failure short-circuits recovery path", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: true,
  });
  let recoveryCalled = 0;
  service.getBlockRuntimeRecoveryHook = () => ({
    async runRecovery() {
      recoveryCalled += 1;
      return null;
    },
  });
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      return {
        block_id: blockSpec.block_id,
        status: "succeeded",
        output_data: {},
        execution_meta: {
          channel: "execution",
          shape: "single_step",
        },
      };
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.body.block_error_code, "E_BLOCK_VERIFY_FAILED");
  assert.equal(
    outcome.body.data.block_result.execution_meta.verify_status,
    "failed"
  );
  assert.equal(recoveryCalled, 0);
});

test("S5-T5 recovery path enforces one-shot retry upper bound", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: true,
  });
  let executeCount = 0;
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      executeCount += 1;
      if (executeCount > 2) {
        throw new Error("must not execute more than one retry");
      }
      return {
        block_id: blockSpec.block_id,
        status: "failed",
        output_data: {},
        execution_meta: {
          channel: "execution",
          shape: "single_step",
        },
        error: {
          error_code: "E_TARGET_ANCHOR_CONFLICT",
          error_message: "anchor conflict",
          retry_policy: {
            allow_auto_retry: true,
            max_attempts: 1,
          },
        },
      };
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(executeCount, 2);
  assert.equal(
    outcome.body.data.block_result.execution_meta.recovery_attempt_count,
    1
  );
  assert.equal(
    outcome.body.data.block_result.execution_meta.recovery_outcome,
    "failed"
  );
  assert.equal(
    outcome.body.data.block_result.execution_meta.recovery_failure_reason,
    "retry_failed"
  );
});

test("S5-T5 verify_recovery_enabled=false remains Step4-compatible", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: false,
  });
  service.getBlockRuntimeVerifyHook = () => {
    throw new Error("verify hook should not run when feature disabled");
  };
  service.getBlockRuntimeRecoveryHook = () => {
    throw new Error("recovery hook should not run when feature disabled");
  };
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      return {
        block_id: blockSpec.block_id,
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

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.runtime_flags.verify_recovery_enabled, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.execution_meta || {},
      "verify_status"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.execution_meta || {},
      "recovery_outcome"
    ),
    false
  );
});

