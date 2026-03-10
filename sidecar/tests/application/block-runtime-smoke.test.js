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

function buildReadBlockSpec() {
  return {
    block_id: "smoke_read_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
  };
}

function buildCreateBlockSpec() {
  return {
    block_id: "smoke_create_1",
    block_type: BLOCK_TYPE.CREATE,
    intent_key: "create.object",
    input: {
      new_object_name: "SmokeContainer",
      object_kind: "ui_panel",
      set_active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-canvas",
      path: "Scene/Canvas",
    },
    based_on_read_token: "ssot_rt_smoke_create",
    write_envelope: {
      idempotency_key: "idp_smoke_create_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
  };
}

function buildMutateBlockSpec() {
  return {
    block_id: "smoke_mutate_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: false,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/SmokeContainer",
    },
    based_on_read_token: "ssot_rt_smoke_mutate",
    write_envelope: {
      idempotency_key: "idp_smoke_mutate_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
  };
}

test("S2B-T4 smoke READ_STATE executes through block runtime and returns scene revision", async () => {
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
          scene_revision: "ssot_rev_smoke_read",
          read_token_candidate: "ssot_rt_smoke_read_out",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.scene_revision, "ssot_rev_smoke_read");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
});

test("S2B-T4 smoke CREATE executes through block runtime and returns anchor payload", async () => {
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
          target_object_id: "GlobalObjectId_V1-new-object",
          target_path: "Scene/Canvas/SmokeContainer",
          scene_revision: "ssot_rev_smoke_create",
          read_token_candidate: "ssot_rt_smoke_create_out",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildCreateBlockSpec(),
    execution_context: {
      shape: "single_step",
    },
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(
    outcome.body.data.output_data.target_object_id,
    "GlobalObjectId_V1-new-object"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "create_object");
  assert.equal(calls[0].payload.new_object_name, "SmokeContainer");
});

test("S2B-T4 smoke MUTATE executes through block runtime and returns mutation receipt", async () => {
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
          target_object_id: "GlobalObjectId_V1-target",
          active: false,
          scene_revision: "ssot_rev_smoke_mutate",
          read_token_candidate: "ssot_rt_smoke_mutate_out",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildMutateBlockSpec(),
    execution_context: {
      shape: "single_step",
    },
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.output_data.active, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(calls[0].payload.active, false);
});

test("S2B-T4 compatibility: disabling block pipeline does not break legacy contract view path", () => {
  const service = createService({
    blockPipelineEnabled: false,
  });
  const outcome = service.getWriteContractBundleForMcp({
    tool_name: "modify_ui_layout",
    include_enhanced: true,
    include_legacy: false,
    budget_chars: 5000,
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "modify_ui_layout");
});

test("S4-T5 smoke router mode keeps Step2 behavior and exposes shape_reason for READ_STATE", async () => {
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
          scene_revision: "ssot_rev_s4_t5_read",
          read_token_candidate: "ssot_rt_s4_t5_read",
        },
      },
    };
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.scene_revision, "ssot_rev_s4_t5_read");
  assert.equal(outcome.body.data.execution_meta.shape, "single_step");
  assert.equal(
    outcome.body.data.execution_meta.shape_reason,
    "read_or_verify_single_step"
  );
  assert.equal(outcome.body.data.runtime_flags.bypass_router, false);
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
});

test("S6-T4 smoke router mode keeps single dispatch and manifest active channel metadata", async () => {
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
          scene_revision: "ssot_rev_s6_t4_smoke",
          read_token_candidate: "ssot_rt_s6_t4_smoke",
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
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
  assert.equal(outcome.body.data.route_result.channel_status, "active");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      outcome.body.data.route_result,
      "reserved_reason"
    ),
    false
  );
});

test("S4-T5 smoke router mode keeps single_step when cross-anchor plan is blocked by phase2a transaction rules", async () => {
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
          target_object_id: "GlobalObjectId_V1-target",
          active: false,
          scene_revision: "ssot_rev_s4_t5_txn",
          read_token_candidate: "ssot_rt_s4_t5_txn",
        },
      },
    };
  };

  const step1 = buildCreateBlockSpec();
  const step2 = buildMutateBlockSpec();
  const outcome = await service.executeBlockSpecForMvp({
    block_spec: step2,
    execution_context: {
      transaction_capable: true,
      block_plan: {
        plan_id: "plan_s4_t5_txn",
        blocks: [
          {
            ...step1,
            block_id: "s4t5_txn_create_1",
            atomic_group_id: "s4t5_grp_1",
          },
          {
            ...step2,
            block_id: "s4t5_txn_mutate_1",
            atomic_group_id: "s4t5_grp_1",
            depends_on: ["s4t5_txn_create_1"],
          },
        ],
      },
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.status, "succeeded");
  assert.equal(outcome.body.data.execution_meta.shape, "single_step");
  assert.equal(
    outcome.body.data.execution_meta.shape_reason,
    "transaction_candidate_blocked_phase2a_constraints"
  );
  assert.equal(outcome.body.data.runtime_flags.bypass_router, false);
  assert.equal(outcome.body.data.route_result.channel_id, "execution");
  assert.equal(
    outcome.body.data.planner_orchestration.auto_transaction_applied,
    false
  );
  assert.equal(
    outcome.body.data.planner_orchestration.dispatch_mode,
    "single_block_direct"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(calls[0].payload.active, false);
});
