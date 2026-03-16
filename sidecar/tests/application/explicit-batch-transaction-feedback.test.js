"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

const TRANSACTION_REASON = "explicit_batch_transaction_capable";
const TRANSACTION_EXPLAIN =
  "Explicit batch request is eligible for transaction upgrade.";

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => "2026-03-17T00:00:00.000Z",
    blockPipelineEnabled: true,
    blockBypassRouter: true,
    blockForceSingleStep: false,
    blockVerifyRecoveryEnabled: false,
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

function buildExplicitTransactionBatchBody() {
  return {
    commands: [
      {
        tool_name: "set_active",
        payload: {
          execution_mode: "execute",
          based_on_read_token: "ssot_rt_explicit_batch_txn_feedback",
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
          based_on_read_token: "ssot_rt_explicit_batch_txn_feedback",
          write_anchor_object_id: "GlobalObjectId_V1-canvas",
          write_anchor_path: "Scene/Canvas",
          target_object_id: "GlobalObjectId_V1-target_2",
          target_path: "Scene/Canvas/Button_2",
          sibling_index: 2,
        },
      },
    ],
    atomicity_preference: "auto",
    failure_policy: "stop_on_first_failure",
  };
}

test("BATCH-006 explicit batch transaction success preserves refreshed token fields", async () => {
  const service = createService();
  service.dispatchSsotToolForMcp = async () => ({
    statusCode: 200,
    body: {
      ok: true,
      status: "succeeded",
      tool_name: "execute_unity_transaction",
      token_automation: {
        auto_refreshed: true,
      },
      data: {
        scene_revision: "9002",
        read_token_candidate: "ssot_rt_batch_txn_refreshed",
        token_automation: {
          auto_refreshed: true,
        },
      },
    },
  });

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitTransactionBatchBody()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.token_automation.auto_refreshed, true);
  assert.equal(outcome.body.data.batch_mode, "transaction");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, TRANSACTION_REASON);
  assert.equal(outcome.body.data.batch_explain, TRANSACTION_EXPLAIN);
  assert.equal(
    outcome.body.data.read_token_candidate,
    "ssot_rt_batch_txn_refreshed"
  );
  assert.equal(outcome.body.data.token_automation.auto_refreshed, true);
});

test("BATCH-006 explicit batch transaction drift failure stops batch and marks batch_applied false", async () => {
  const service = createService();
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName) => {
    calls.push(toolName);
    return {
      statusCode: 409,
      body: {
        ok: false,
        status: "failed",
        error_code: "E_SCENE_REVISION_DRIFT",
        message: "scene revision drift persisted after auto refresh",
        tool_name: toolName,
        token_automation: {
          auto_refreshed: false,
          auto_retry_attempted: true,
        },
        data: {
          token_automation: {
            auto_refreshed: false,
            auto_retry_attempted: true,
          },
        },
      },
    };
  };

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitTransactionBatchBody()
  );

  assert.deepEqual(calls, ["execute_unity_transaction"]);
  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.token_automation.auto_refreshed, false);
  assert.equal(outcome.body.data.batch_mode, "transaction");
  assert.equal(outcome.body.data.batch_applied, false);
  assert.equal(outcome.body.data.batch_mode_reason, TRANSACTION_REASON);
  assert.equal(outcome.body.data.batch_explain, TRANSACTION_EXPLAIN);
  assert.equal(outcome.body.data.token_automation.auto_refreshed, false);
});
