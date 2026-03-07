"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE,
  guardExecuteUnityTransactionSteps,
} = require("../../src/application/ssotRuntime/transactionPolicyGuard");

function createTurnServiceHarness() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => "2026-03-06T12:00:00.000Z",
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
  return { service, turnStore };
}

function clearSsotState(service) {
  if (
    service &&
    service.ssotTokenRegistry &&
    typeof service.ssotTokenRegistry.clearForTests === "function"
  ) {
    service.ssotTokenRegistry.clearForTests();
  }
  if (
    service &&
    service.ssotRevisionState &&
    typeof service.ssotRevisionState.clearForTests === "function"
  ) {
    service.ssotRevisionState.clearForTests();
  }
}

function issueValidWriteToken(service, sceneRevision) {
  const revision = String(sceneRevision || "").trim() || "ssot_rev_transaction_guard";
  const issued = service.ssotTokenRegistry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: revision,
  });
  assert.equal(issued.ok, true);
  service.ssotRevisionState.updateLatestKnownSceneRevision(revision, {
    source_tool_name: "transaction-policy-guard.test",
  });
  return issued.token;
}

function buildTransactionPayload(stepToolName, basedOnReadToken) {
  const toolName = String(stepToolName || "").trim();
  return {
    execution_mode: "execute",
    idempotency_key: "idem_transaction_guard_001",
    based_on_read_token: basedOnReadToken,
    write_anchor_object_id: "go_canvas",
    write_anchor_path: "Scene/Canvas",
    transaction_id: "txn_guard_001",
    steps: [
      {
        step_id: "step_001",
        tool_name: toolName,
        payload: {},
      },
    ],
  };
}

test("transaction policy guard allows transaction-enabled write tools", () => {
  const result = guardExecuteUnityTransactionSteps(
    buildTransactionPayload("create_object", "ssot_rt_mock_guard")
  );
  assert.equal(result.ok, true);
  assert.equal(result.inspected_step_count >= 1, true);
});

test("transaction policy guard rejects read tools in transaction steps", () => {
  const result = guardExecuteUnityTransactionSteps(
    buildTransactionPayload("get_ui_tree", "ssot_rt_mock_guard")
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.error_code,
    TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE
  );
  assert.equal(result.failed_tool_name, "get_ui_tree");
});

test("transaction policy guard rejects deprecated/removed tools through structured steps", () => {
  const result = guardExecuteUnityTransactionSteps({
    steps: [
      {
        step_id: "legacy_step",
        tool_name: "instantiate_prefab",
        payload: {},
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.error_code,
    TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE
  );
  assert.equal(result.failed_step_id, "legacy_step");
  assert.equal(result.failed_tool_name, "instantiate_prefab");
});

test("turnService blocks forbidden execute_unity_transaction steps before Unity dispatch", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    clearSsotState(service);
    const token = issueValidWriteToken(service, "ssot_rev_transaction_guard_block");
    let unityDispatchCount = 0;
    service.enqueueAndWaitForUnityQuery = async () => {
      unityDispatchCount += 1;
      return {
        ok: true,
        data: {
          scene_revision: "ssot_rev_after_dispatch",
        },
      };
    };

    const outcome = await service.dispatchSsotToolForMcp(
      "execute_unity_transaction",
      buildTransactionPayload("get_ui_tree", token)
    );
    assert.equal(outcome.statusCode, 409);
    assert.equal(
      outcome.body.error_code,
      TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE
    );
    assert.equal(outcome.body.failed_tool_name, "get_ui_tree");
    assert.equal(unityDispatchCount, 0);
  } finally {
    clearSsotState(service);
    turnStore.stopMaintenance();
  }
});

test("turnService dispatches execute_unity_transaction when all step tools pass policy", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    clearSsotState(service);
    const sceneRevision = "ssot_rev_transaction_guard_allow";
    const token = issueValidWriteToken(service, sceneRevision);
    let unityDispatchCount = 0;
    service.enqueueAndWaitForUnityQuery = async () => {
      unityDispatchCount += 1;
      return {
        ok: true,
        data: {
          scene_revision: sceneRevision,
          accepted: true,
        },
      };
    };

    const outcome = await service.dispatchSsotToolForMcp(
      "execute_unity_transaction",
      buildTransactionPayload("create_object", token)
    );
    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.body.ok, true);
    assert.equal(outcome.body.tool_name, "execute_unity_transaction");
    assert.equal(unityDispatchCount, 1);
  } finally {
    clearSsotState(service);
    turnStore.stopMaintenance();
  }
});
