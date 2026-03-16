"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

const EXPECTED_BATCH_MODE_REASON = "explicit_batch_atomicity_none";
const EXPECTED_BATCH_EXPLAIN =
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

function buildExplicitSequentialBatchBody() {
  return {
    commands: [
      {
        tool_name: "set_active",
        payload: {
          execution_mode: "execute",
          based_on_read_token: "ssot_rt_explicit_batch_feedback",
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
          based_on_read_token: "ssot_rt_explicit_batch_feedback",
          write_anchor_object_id: "GlobalObjectId_V1-canvas",
          write_anchor_path: "Scene/Canvas",
          target_object_id: "GlobalObjectId_V1-target_2",
          target_path: "Scene/Canvas/Button_2",
          sibling_index: 2,
        },
      },
      {
        tool_name: "rename_object",
        payload: {
          execution_mode: "execute",
          based_on_read_token: "ssot_rt_explicit_batch_feedback",
          write_anchor_object_id: "GlobalObjectId_V1-canvas",
          write_anchor_path: "Scene/Canvas",
          target_object_id: "GlobalObjectId_V1-target_3",
          target_path: "Scene/Canvas/Button_3",
          new_name: "RenamedNode",
        },
      },
    ],
    atomicity_preference: "none",
    failure_policy: "stop_on_first_failure",
  };
}

test("BATCH-004 explicit sequential batch exposes stable feedback fields on success", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });

  service.dispatchSsotToolForMcp = async (toolName, payload) => ({
    statusCode: 200,
    body: {
      ok: true,
      status: "succeeded",
      tool_name: toolName,
      data: {
        target_object_id: payload.target_object_id,
      },
    },
  });

  const outcome = await service.executeBatchEntryForMcp(
    buildExplicitSequentialBatchBody()
  );

  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.data.batch_mode, "sequential_batch");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, EXPECTED_BATCH_MODE_REASON);
  assert.equal(outcome.body.data.batch_explain, EXPECTED_BATCH_EXPLAIN);
  assert.equal(Array.isArray(outcome.body.data.step_results), true);
  assert.equal(outcome.body.data.first_failed_step_id, "");
  assert.deepEqual(outcome.body.data.successful_step_ids, [
    "batch_step_1",
    "batch_step_2",
    "batch_step_3",
  ]);
  assert.equal(outcome.body.data.rollback_applied, false);
});

test("BATCH-004 explicit sequential batch exposes failure aggregation fields", async () => {
  const service = createService({
    blockPipelineEnabled: true,
  });
  const calls = [];
  service.dispatchSsotToolForMcp = async (toolName, payload) => {
    calls.push({ toolName, payload });
    if (toolName === "set_sibling_index") {
      return {
        statusCode: 409,
        body: {
          ok: false,
          status: "failed",
          error_code: "E_STEP_FAILED",
          message: "step failed",
        },
      };
    }
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
    buildExplicitSequentialBatchBody()
  );

  assert.equal(outcome.body.query_type, "batch.request");
  assert.equal(outcome.body.data.batch_mode, "sequential_batch");
  assert.equal(outcome.body.data.batch_applied, true);
  assert.equal(outcome.body.data.batch_mode_reason, EXPECTED_BATCH_MODE_REASON);
  assert.equal(outcome.body.data.batch_explain, EXPECTED_BATCH_EXPLAIN);
  assert.equal(Array.isArray(outcome.body.data.step_results), true);
  assert.equal(outcome.body.data.step_results.length, 2);
  assert.deepEqual(outcome.body.data.successful_step_ids, ["batch_step_1"]);
  assert.equal(outcome.body.data.first_failed_step_id, "batch_step_2");
  assert.equal(outcome.body.data.rollback_applied, false);
  assert.deepEqual(
    calls.map((entry) => entry.toolName),
    ["set_active", "set_sibling_index"]
  );
});
