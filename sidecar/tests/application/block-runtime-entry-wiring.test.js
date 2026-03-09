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
    maintenanceIntervalMs: 60000,
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

function buildReadBlockSpec(overrides = {}) {
  return {
    block_id: "block_entry_read_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
    ...overrides,
  };
}

function buildWriteBlockSpec(overrides = {}) {
  return {
    block_id: "block_entry_write_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_block",
    write_envelope: {
      idempotency_key: "idp_entry_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildAsyncStatusBlockSpec(overrides = {}) {
  return {
    block_id: "block_entry_async_status_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "write.async_ops.get_task_status",
    input: {
      job_id: "job_mock_123",
    },
    based_on_read_token: "ssot_rt_block",
    write_envelope: {
      idempotency_key: "idp_entry_async_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

test("S2B-T1 executeBlockSpecForMvp blocks when BLOCK_PIPELINE_ENABLED is false", async () => {
  const service = createService({
    blockPipelineEnabled: false,
  });
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
  });
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_BLOCK_PIPELINE_DISABLED");
});

test("S2B-T1 executeBlockSpecForMvp rejects missing block_spec", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const outcome = await service.executeBlockSpecForMvp({});
  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
});

test("PLNR-003 executeBlockSpecForMvp accepts block_spec.family_key and translates to intent_key", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_entry_family_key",
          read_token_candidate: "ssot_rt_entry_family_key",
        },
      },
    };
  };

  const blockSpec = buildReadBlockSpec();
  delete blockSpec.intent_key;
  blockSpec.family_key = "read.snapshot_for_write";

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: blockSpec,
    execution_context: {
      shape: "single_step",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(outcome.body.data.execution_meta.mapping_meta.family_key, "read.snapshot_for_write");
  assert.equal(outcome.body.data.execution_meta.mapping_meta.intent_key_source, "family_key");
});

test("PLNR-003 executeBlockSpecForMvp accepts block_spec.legacy_concrete_key and keeps legacy mapping path", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_entry_legacy_key",
          read_token_candidate: "ssot_rt_entry_legacy_key",
        },
      },
    };
  };

  const blockSpec = buildWriteBlockSpec();
  delete blockSpec.intent_key;
  blockSpec.legacy_concrete_key = "set_active";

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: blockSpec,
    execution_context: {
      shape: "single_step",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(outcome.body.data.execution_meta.mapping_meta.family_key, "mutate.set_active");
  assert.equal(
    outcome.body.data.execution_meta.mapping_meta.intent_key_source,
    "legacy_concrete_key"
  );
  assert.equal(
    outcome.body.data.execution_meta.mapping_meta.legacy_concrete_key,
    "set_active"
  );
});

test("S2B-T1 executeBlockSpecForMvp dispatches mapped tool via turnService runtime port", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_entry",
          read_token_candidate: "ssot_rt_entry",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
    execution_context: {
      shape: "single_step",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.query_type, "block.request");
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(calls[0].payload.scope_path, "Scene/Canvas");
});

test("S2B-T1 executeBlockSpecForMvp propagates block execution failure envelope", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  service.dispatchSsotToolForMcp = async () => ({
    statusCode: 409,
    body: {
      status: "failed",
      error_code: "E_SCENE_REVISION_DRIFT",
      message: "scene revision drift",
      suggested_action: "get_scene_snapshot_for_write",
      data: {
        transaction_rollback_applied: true,
        failed_blocks: [{ block_id: "block_entry_write_1" }],
      },
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
    execution_context: {
      shape: "single_step",
    },
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.body.data.block_result.status, "failed");
  assert.equal(
    outcome.body.data.block_result.execution_meta.transaction_rollback_applied,
    true
  );
  assert.equal(
    Array.isArray(outcome.body.data.block_result.execution_meta.failed_blocks),
    true
  );
  assert.equal(outcome.body.suggested_action, "get_scene_snapshot_for_write");
});

test("S2B-T1 executeBlockSpecForMvp forwards top-level plan_initial_read_token to transaction context", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_txn_entry",
          read_token_candidate: "ssot_rt_txn_entry",
        },
      },
    };
  };

  const writeBlock = buildWriteBlockSpec();
  delete writeBlock.based_on_read_token;
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: writeBlock,
    plan_initial_read_token: "ssot_rt_plan_entry",
    execution_context: {
      shape: "transaction",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(calls[0].payload.based_on_read_token, "ssot_rt_plan_entry");
  assert.equal(
    outcome.body.data.execution_meta.effective_read_token_source,
    "plan_initial_read_token"
  );
});

test("S3-T3 executeBlockSpecForMvp routes through ThinBlockRouter when BYPASS_ROUTER is false", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: false,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_router_enabled",
          read_token_candidate: "ssot_rt_router_enabled",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(
    outcome.body.data.runtime_flags.bypass_router,
    false
  );
  assert.equal(outcome.body.data.route_result.route_status, "routed");
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
});

test("S6-T4 default execution route remains stable without extra runtime dispatch", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: false,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_s6_t4_entry",
          read_token_candidate: "ssot_rt_s6_t4_entry",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec({
      block_id: "block_s6_t4_entry_read_1",
    }),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
  assert.equal(outcome.body.data.route_result.route_status, "routed");
  assert.equal(outcome.body.data.route_result.channel_status, "active");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.route_result,
      "reserved_reason"
    ),
    false
  );
});

test("S4-T3 executeBlockSpecForMvp applies shape decision from decider before adapter", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: false,
  });
  let capturedDeciderInput = null;
  let capturedAdapterContext = null;

  service.getExecutionShapeDecider = () => ({
    decideExecutionShape(input) {
      capturedDeciderInput = input;
      return {
        shape: "transaction",
        shape_reason: "transaction_candidate_confirmed",
        shape_degraded: false,
      };
    },
  });
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec, context) {
      capturedAdapterContext = context;
      return {
        block_id: blockSpec.block_id,
        status: "succeeded",
        output_data: {},
        execution_meta: {
          channel: context.channel,
          shape: context.shape,
          shape_reason: context.shape_reason,
        },
      };
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
    execution_context: {
      shape: "single_step",
      shape_reason: "caller_supplied_shape",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(capturedDeciderInput.block_spec.block_id, "block_entry_read_1");
  assert.equal(capturedDeciderInput.execution_context.channel, "execution");
  assert.equal(capturedDeciderInput.execution_context.shape, "single_step");
  assert.equal(capturedAdapterContext.shape, "transaction");
  assert.equal(
    capturedAdapterContext.shape_reason,
    "transaction_candidate_confirmed"
  );
  assert.equal(capturedAdapterContext.shape_degraded, false);
  assert.equal(outcome.body.data.execution_meta.shape, "transaction");
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
});

test("S2B-T2 executeBlockSpecForMvp FORCE_SINGLE_STEP overrides requested transaction shape", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockForceSingleStep: true,
  });
  let capturedPayload = null;
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    capturedPayload = { toolName, payload };
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_force",
          read_token_candidate: "ssot_rt_force",
        },
      },
    };
  };

  const writeBlock = buildWriteBlockSpec();
  delete writeBlock.based_on_read_token;
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: writeBlock,
    plan_initial_read_token: "ssot_rt_plan_force",
    previous_read_token_candidate: "ssot_rt_prev_force",
    execution_context: {
      shape: "transaction",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(capturedPayload.toolName, "set_active");
  assert.equal(
    capturedPayload.payload.based_on_read_token,
    "ssot_rt_prev_force"
  );
  assert.equal(outcome.body.data.execution_meta.shape, "single_step");
  assert.equal(
    outcome.body.data.execution_meta.effective_read_token_source,
    "previous_read_token_candidate"
  );
  assert.equal(
    outcome.body.data.runtime_flags.force_single_step,
    true
  );
});

test("S4-T4 FORCE_SINGLE_STEP=true with BYPASS_ROUTER=false stays single_step over transaction-capable plan", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: false,
    blockForceSingleStep: true,
  });
  let capturedDeciderInput = null;
  const capturedCalls = [];
  const realDecider = service.getExecutionShapeDecider();
  service.getExecutionShapeDecider = () => ({
    decideExecutionShape(input) {
      capturedDeciderInput = input;
      return realDecider.decideExecutionShape(input);
    },
  });
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    capturedCalls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_s4t4_force_router",
          read_token_candidate: "ssot_rt_s4t4_force_router",
        },
      },
    };
  };

  const step1 = buildWriteBlockSpec({
    block_id: "s4t4_force_step_1",
    atomic_group_id: "s4t4_grp",
  });
  const step2 = buildWriteBlockSpec({
    block_id: "s4t4_force_step_2",
    atomic_group_id: "s4t4_grp",
    depends_on: ["s4t4_force_step_1"],
  });
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: step1,
    execution_context: {
      shape: "transaction",
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_s4_t4_force_router",
        blocks: [step1, step2],
      },
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedDeciderInput.runtime_flags.force_single_step, true);
  assert.equal(capturedDeciderInput.execution_context.channel, "execution");
  assert.equal(outcome.body.data.execution_meta.shape, "single_step");
  assert.equal(
    outcome.body.data.execution_meta.shape_reason,
    "forced_by_block_runtime_flag"
  );
  assert.equal(outcome.body.data.runtime_flags.bypass_router, false);
});

test("S4-T4 BYPASS_ROUTER=true skips router/shape-decider and still keeps force single_step fallback", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockForceSingleStep: true,
  });
  const calls = [];
  service.getBlockRuntimeRouter = () => {
    throw new Error("router should not be invoked when BYPASS_ROUTER=true");
  };
  service.getExecutionShapeDecider = () => {
    throw new Error("shape decider should not be invoked when BYPASS_ROUTER=true");
  };
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_s4t4_bypass_force",
          read_token_candidate: "ssot_rt_s4t4_bypass_force",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
    execution_context: {
      shape: "transaction",
      requested_channel: "vision",
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(outcome.body.data.runtime_flags.bypass_router, true);
  assert.equal(outcome.body.data.runtime_flags.force_single_step, true);
  assert.equal(outcome.body.data.execution_meta.shape, "single_step");
  assert.equal(
    outcome.body.data.execution_meta.shape_reason,
    "forced_by_block_runtime_flag"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.body.data, "route_result"),
    false
  );
});

test("S5-T3 verify_recovery_enabled=false keeps Step4 behavior and does not invoke hooks", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: false,
  });
  const calls = [];
  service.getBlockRuntimeVerifyHook = () => {
    throw new Error("verify hook should not be invoked when verify_recovery_enabled=false");
  };
  service.getBlockRuntimeRecoveryHook = () => {
    throw new Error(
      "recovery hook should not be invoked when verify_recovery_enabled=false"
    );
  };
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          target_object_id: "GlobalObjectId_V1-target",
          active: false,
          scene_revision: "ssot_rev_s5_t3_off",
          read_token_candidate: "ssot_rt_s5_t3_off",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(outcome.body.data.runtime_flags.verify_recovery_enabled, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.execution_meta || {},
      "verify_status"
    ),
    false
  );
});

test("S5-T3 verify_recovery_enabled=true triggers one-shot recovery and re-verifies success", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: true,
  });
  let executeCount = 0;
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      executeCount += 1;
      if (executeCount === 1) {
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
            error_message: "anchor mismatch",
            retry_policy: {
              allow_auto_retry: true,
              max_attempts: 1,
            },
          },
        };
      }
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
  assert.equal(executeCount, 2);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.execution_meta.verify_status, "passed");
  assert.equal(outcome.body.data.execution_meta.recovery_attempted, true);
  assert.equal(outcome.body.data.execution_meta.recovery_attempt_count, 1);
  assert.equal(outcome.body.data.execution_meta.recovery_outcome, "succeeded");
  assert.equal(outcome.body.data.runtime_flags.verify_recovery_enabled, true);
});

test("S5-T3 verify failure fail-closes and short-circuits recovery hook", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockVerifyRecoveryEnabled: true,
  });
  let executeCount = 0;
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      executeCount += 1;
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
  service.getBlockRuntimeRecoveryHook = () => ({
    async runRecovery() {
      throw new Error("recovery hook must not run when verify failed");
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(executeCount, 1);
  assert.equal(outcome.body.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.body.block_error_code, "E_BLOCK_VERIFY_FAILED");
  assert.equal(
    outcome.body.data.block_result.execution_meta.verify_status,
    "failed"
  );
});

test("S3-T3 executeBlockSpecForMvp fail-closed for reserved requested channel when BYPASS_ROUTER is false", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: false,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {},
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
    execution_context: {
      requested_channel: "vision",
    },
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.body.block_error_code, "E_BLOCK_CHANNEL_RESERVED");
  assert.equal(outcome.body.data.route_result.route_status, "reserved");
  assert.equal(outcome.body.data.route_result.channel_id, "vision");
  assert.equal(calls.length, 0);
});

test("S3-T5 BYPASS_ROUTER=true keeps Step2B behavior and never invokes router", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
  });
  const calls = [];
  service.getBlockRuntimeRouter = () => {
    throw new Error("router should not be invoked when BYPASS_ROUTER=true");
  };
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_bypass_s3t5",
          read_token_candidate: "ssot_rt_bypass_s3t5",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
    execution_context: {
      requested_channel: "vision",
    },
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.runtime_flags.bypass_router, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.body.data, "route_result"),
    false
  );
});

test("S3-T5 BYPASS_ROUTER=true keeps failure envelope without route_result", async () => {
  const service = createService({
    blockPipelineEnabled: true,
    blockBypassRouter: true,
  });
  service.getBlockRuntimeRouter = () => {
    throw new Error("router should not be invoked when BYPASS_ROUTER=true");
  };
  service.dispatchSsotToolForMcp = async () => ({
    statusCode: 409,
    body: {
      status: "failed",
      error_code: "E_SCENE_REVISION_DRIFT",
      message: "scene revision drift",
      suggested_action: "get_scene_snapshot_for_write",
      data: {
        transaction_rollback_applied: false,
      },
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec(),
    execution_context: {
      requested_channel: "vision",
    },
  });
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.body.data.block_result.status, "failed");
  assert.equal(outcome.body.data.runtime_flags.bypass_router, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.body.data, "route_result"),
    false
  );
});

test("PLNR-007 executePlannerEntryForMcp delegates to planner entry runtime path", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
        data: {
          scene_revision: "ssot_rev_entry_delegate",
          read_token_candidate: "ssot_rt_entry_delegate",
        },
      },
    };
  };

  const outcome = await service.executePlannerEntryForMcp({
    block_spec: buildReadBlockSpec(),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
});

test("PLNR-007 no_family returns E_PLANNER_UNSUPPORTED_FAMILY in planner entry", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec({
      intent_key: "mutate.unknown",
    }),
  });
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PLANNER_UNSUPPORTED_FAMILY");
  assert.equal(outcome.body.context.previous_operation, "planner_exit_policy_fail_closed");
});

test("PLNR-007 no_tool outside exit whitelist returns E_PLANNER_EXIT_NOT_ALLOWED", async () => {
  const envKey = "BLOCK_RUNTIME_DISABLED_FAMILY_KEYS";
  const previous = process.env[envKey];
  process.env[envKey] = "mutate.set_active";
  try {
    const service = createService({
      blockPipelineEnabled: true,
    });
    service.dispatchSsotToolForMcp = async () => {
      throw new Error("dispatch should not be called for exit_not_allowed");
    };

    const outcome = await service.executeBlockSpecForMvp({
      block_spec: buildWriteBlockSpec(),
    });
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_PLANNER_EXIT_NOT_ALLOWED");
    assert.equal(
      outcome.body.data.planner_exit.reason,
      "exit_not_allowed"
    );
  } finally {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
  }
});

test("PLNR-007 no_tool in write.async_ops escapes via get_unity_task_status", async () => {
  const envKey = "BLOCK_RUNTIME_DISABLED_FAMILY_KEYS";
  const previous = process.env[envKey];
  process.env[envKey] = "write.async_ops";
  try {
    const service = createService({
      blockPipelineEnabled: true,
    });
    const calls = [];
    service.dispatchSsotToolForMcp = async (toolName, payload) => {
      calls.push({ toolName, payload });
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          data: {
            job_id: payload.job_id,
            state: "running",
          },
        },
      };
    };

    const outcome = await service.executeBlockSpecForMvp({
      block_spec: buildAsyncStatusBlockSpec(),
    });
    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.body.query_type, "planner.exit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolName, "get_unity_task_status");
    assert.equal(calls[0].payload.job_id, "job_mock_123");
    assert.equal(outcome.body.data.planner_exit.action, "escape");
  } finally {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
  }
});

test("PLNR-007 no_safe_fallback returns E_PLANNER_NO_SAFE_FALLBACK", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock(blockSpec) {
      return {
        block_id: blockSpec.block_id,
        status: "failed",
        output_data: {},
        execution_meta: {
          channel: "execution",
          shape: "single_step",
          mapping_meta: {
            family_key: "mutate.component_properties",
            fallback_attempted: true,
            fallback_used: false,
          },
        },
        error: {
          error_code: "E_PRECONDITION_FAILED",
          block_error_code: "E_BLOCK_FALLBACK_NOT_ALLOWED",
          error_message: "fallback blocked",
        },
      };
    },
  });

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildWriteBlockSpec({
      intent_key: "mutate.component_properties",
    }),
  });
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PLANNER_NO_SAFE_FALLBACK");
  assert.equal(
    outcome.body.data.planner_exit.reason,
    "no_safe_fallback"
  );
});
