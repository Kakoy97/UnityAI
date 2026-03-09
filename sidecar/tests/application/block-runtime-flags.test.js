"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BLOCK_RUNTIME_FLAGS_VERSION,
  resolveBlockRuntimeFlags,
  applyBlockRuntimeFlagsToExecutionContext,
} = require("../../src/application/blockRuntime/BlockRuntimeFlags");

test("S2B-T2 flags resolver exposes stable version", () => {
  assert.equal(typeof BLOCK_RUNTIME_FLAGS_VERSION, "string");
  assert.equal(BLOCK_RUNTIME_FLAGS_VERSION.length > 0, true);
});

test("S2B-T2 priority: BLOCK_PIPELINE_ENABLED=false disables all runtime flags", () => {
  const flags = resolveBlockRuntimeFlags({
    blockPipelineEnabled: false,
    bypassRouter: true,
    forceSingleStep: true,
    verifyRecoveryEnabled: true,
  });
  assert.equal(flags.pipeline_enabled, false);
  assert.equal(flags.bypass_router, false);
  assert.equal(flags.force_single_step, false);
  assert.equal(flags.verify_recovery_enabled, false);
  assert.equal(flags.router_mode, "disabled");
  assert.equal(flags.shape_mode, "disabled");
  assert.equal(flags.verify_recovery_mode, "disabled");
});

test("S2B-T2 priority: pipeline on keeps bypass router and dynamic shape by default", () => {
  const flags = resolveBlockRuntimeFlags({
    blockPipelineEnabled: true,
    bypassRouter: true,
    forceSingleStep: false,
    verifyRecoveryEnabled: false,
  });
  assert.equal(flags.pipeline_enabled, true);
  assert.equal(flags.bypass_router, true);
  assert.equal(flags.force_single_step, false);
  assert.equal(flags.router_mode, "bypass_router");
  assert.equal(flags.shape_mode, "dynamic");
});

test("S2B-T2 priority: force single-step only effective when pipeline enabled", () => {
  const enabled = resolveBlockRuntimeFlags({
    blockPipelineEnabled: true,
    forceSingleStep: true,
  });
  assert.equal(enabled.force_single_step, true);
  assert.equal(enabled.shape_mode, "force_single_step");

  const disabled = resolveBlockRuntimeFlags({
    blockPipelineEnabled: false,
    forceSingleStep: true,
  });
  assert.equal(disabled.force_single_step, false);
  assert.equal(disabled.shape_mode, "disabled");
});

test("S2B-T2 apply flags forces single_step execution context deterministically", () => {
  const { flags, execution_context } = applyBlockRuntimeFlagsToExecutionContext(
    {
      blockPipelineEnabled: true,
      forceSingleStep: true,
    },
    {
      shape: "transaction",
      shape_reason: "input_requested",
    }
  );

  assert.equal(flags.force_single_step, true);
  assert.equal(execution_context.shape, "single_step");
  assert.equal(
    execution_context.shape_reason,
    "forced_by_block_runtime_flag"
  );
  assert.equal(execution_context.shape_degraded, true);
});

test("S4-T4 priority matrix keeps bypass router + force single-step jointly active when pipeline enabled", () => {
  const flags = resolveBlockRuntimeFlags({
    blockPipelineEnabled: true,
    bypassRouter: true,
    forceSingleStep: true,
    verifyRecoveryEnabled: false,
  });
  assert.equal(flags.pipeline_enabled, true);
  assert.equal(flags.bypass_router, true);
  assert.equal(flags.force_single_step, true);
  assert.equal(flags.router_mode, "bypass_router");
  assert.equal(flags.shape_mode, "force_single_step");
});

test("S4-T4 apply flags keeps context unchanged when force single-step is disabled", () => {
  const inputContext = {
    shape: "transaction",
    shape_reason: "caller_requested",
    requested_channel: "execution",
  };
  const { flags, execution_context } = applyBlockRuntimeFlagsToExecutionContext(
    {
      blockPipelineEnabled: true,
      bypassRouter: false,
      forceSingleStep: false,
    },
    inputContext
  );

  assert.equal(flags.force_single_step, false);
  assert.equal(execution_context.shape, "transaction");
  assert.equal(execution_context.shape_reason, "caller_requested");
  assert.equal(execution_context.requested_channel, "execution");
  assert.equal(
    Object.prototype.hasOwnProperty.call(execution_context, "shape_degraded"),
    false
  );
});
