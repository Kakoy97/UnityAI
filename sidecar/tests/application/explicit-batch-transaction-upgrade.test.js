"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

const TRANSACTION_REASON = "explicit_batch_transaction_capable";
const TRANSACTION_EXPLAIN =
  "Explicit batch request is eligible for transaction upgrade.";
const FAIL_FAST_REASON = "explicit_batch_transaction_required";
const FAIL_FAST_EXPLAIN =
  "Explicit batch request could not be applied because atomicity_preference=required but transaction upgrade was not available.";
const AUTO_SEQUENTIAL_REASON = "explicit_batch_transaction_not_available";
const AUTO_SEQUENTIAL_EXPLAIN =
  "Explicit batch request ran as sequential_batch because transaction upgrade was not available.";
const NONE_SEQUENTIAL_REASON = "explicit_batch_atomicity_none";
const NONE_SEQUENTIAL_EXPLAIN =
  "Explicit batch request ran as sequential_batch because atomicity_preference=none.";

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
    nowIso: () => "2026-03-17T00:00:00.000Z",
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

function buildExplicitBatchBody({
  atomicityPreference = "auto",
  secondPayloadOverrides = {},
} = {}) {
  return {
    commands: [
      {
        tool_name: "set_active",
        payload: {
          execution_mode: "execute",
          based_on_read_token: "ssot_rt_explicit_batch_txn",
          write_anchor_object_id: "GlobalObjectId_V1-canvas",
          write_anchor_path: "Scene/Canvas",
          target_object_id: "GlobalObjectId_V1-target_1",
          target_path: "Scene/Canvas/Button_1",
          active: true,
        },
      },
      {
        tool_name: "set_sibling_index",
        payload: {
          execution_mode: "execute",
          based_on_read_token: "ssot_rt_explicit_batch_txn",
          write_anchor_object_id: "GlobalObjectId_V1-canvas",
          write_anchor_path: "Scene/Canvas",
          target_object_id: "GlobalObjectId_V1-target_2",
          target_path: "Scene/Canvas/Button_2",
          sibling_index: 2,
          ...secondPayloadOverrides,
        },
      },
    ],
    atomicity_preference: atomicityPreference,
    failure_policy: "stop_on_first_failure",
  };
}

test("BATCH-005 required + capable batch upgrades to execute_unity_transaction", async () => {
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
        tool_name: toolName,
        data: {
          transaction_id: payload.transaction_id,
          step_count: Array.isArray(payload.steps) ? payload.steps.length : 0,
        },
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitBatchBody({
      atomicityPreference: "required",
    })
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.status, "succeeded");
  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.data.batch_mode, "transaction");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, TRANSACTION_REASON);
  assert.equal(outcome.body.data.batch_explain, TRANSACTION_EXPLAIN);
  assert.deepEqual(calls.map((entry) => entry.toolName), [
    "execute_unity_transaction",
  ]);
  assert.equal(Array.isArray(calls[0].payload.steps), true);
  assert.equal(calls[0].payload.steps.length, 2);
});

test("BATCH-005 required + non-capable batch remains fail_fast", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName) => {
    calls.push(toolName);
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "succeeded",
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitBatchBody({
      atomicityPreference: "required",
      secondPayloadOverrides: {
        write_anchor_object_id: "GlobalObjectId_V1-other",
        write_anchor_path: "Scene/Other",
      },
    })
  );

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_BATCH_ATOMICITY_NOT_SUPPORTED");
  assert.equal(outcome.body.data.batch_mode, "fail_fast");
  assert.equal(outcome.body.data.batch_applied, false);
  assert.equal(outcome.body.data.batch_mode_reason, FAIL_FAST_REASON);
  assert.equal(outcome.body.data.batch_explain, FAIL_FAST_EXPLAIN);
  assert.deepEqual(calls, []);
});

test("BATCH-005 auto + capable batch upgrades to execute_unity_transaction", async () => {
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
        tool_name: toolName,
        data: {
          transaction_id: payload.transaction_id,
        },
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitBatchBody({
      atomicityPreference: "auto",
    })
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.status, "succeeded");
  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.data.batch_mode, "transaction");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, TRANSACTION_REASON);
  assert.equal(outcome.body.data.batch_explain, TRANSACTION_EXPLAIN);
  assert.deepEqual(calls.map((entry) => entry.toolName), [
    "execute_unity_transaction",
  ]);
});

test("BATCH-005 auto + non-capable batch stays sequential_batch", async () => {
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
        tool_name: toolName,
        data: {
          target_object_id: payload.target_object_id,
        },
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitBatchBody({
      atomicityPreference: "auto",
      secondPayloadOverrides: {
        write_anchor_object_id: "GlobalObjectId_V1-other",
        write_anchor_path: "Scene/Other",
      },
    })
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.batch_mode, "sequential_batch");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, AUTO_SEQUENTIAL_REASON);
  assert.equal(outcome.body.data.batch_explain, AUTO_SEQUENTIAL_EXPLAIN);
  assert.deepEqual(calls.map((entry) => entry.toolName), [
    "set_active",
    "set_sibling_index",
  ]);
});

test("BATCH-005 none does not upgrade transaction-capable batch", async () => {
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
        tool_name: toolName,
        data: {
          target_object_id: payload.target_object_id,
        },
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitBatchBody({
      atomicityPreference: "none",
    })
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.data.batch_mode, "sequential_batch");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, NONE_SEQUENTIAL_REASON);
  assert.equal(outcome.body.data.batch_explain, NONE_SEQUENTIAL_EXPLAIN);
  assert.deepEqual(calls.map((entry) => entry.toolName), [
    "set_active",
    "set_sibling_index",
  ]);
});
