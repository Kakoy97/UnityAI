"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

function createTurnServiceHarness() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => "2026-03-07T12:00:00.000Z",
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

function buildWritePayload(tokenValue) {
  return {
    execution_mode: "execute",
    idempotency_key: "idem_pr8_write_token_refresh",
    based_on_read_token: tokenValue,
    write_anchor_object_id: "go_canvas",
    write_anchor_path: "Scene/Canvas",
    target_object_id: "go_target",
    target_path: "Scene/Canvas/Target",
    anchored_x: 10,
    anchored_y: 20,
    width: 200,
    height: 100,
  };
}

test("dispatchSsotToolForMcp write success auto-issues continuation token from updated scene revision", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.ssotRevisionState.updateLatestKnownSceneRevision("9001", {
      source_tool_name: "get_scene_snapshot_for_write",
    });
    const initialIssued = service.ssotTokenRegistry.issueToken({
      source_tool_name: "get_scene_snapshot_for_write",
      scene_revision: "9001",
      scope_kind: "scene",
      object_id: "go_canvas",
      path: "Scene/Canvas",
    });
    assert.equal(initialIssued.ok, true);

    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: true,
      tool_name: "modify_ui_layout",
      data: {
        scene_revision: "9002",
        target_object_id: "go_target",
        target_path: "Scene/Canvas/Target",
        width: 200,
        height: 100,
      },
    });

    const outcome = await service.dispatchSsotToolForMcp(
      "modify_ui_layout",
      buildWritePayload(initialIssued.token)
    );

    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.body.ok, true);
    assert.equal(outcome.body.tool_name, "modify_ui_layout");
    assert.equal(outcome.body.data.scene_revision, "9002");
    assert.equal(typeof outcome.body.data.read_token_candidate, "string");
    assert.equal(outcome.body.data.read_token_candidate.startsWith("ssot_rt_"), true);
    assert.notEqual(outcome.body.data.read_token_candidate, initialIssued.token);

    const oldTokenValidation = service.validateSsotTokenForMcp(initialIssued.token);
    assert.equal(oldTokenValidation.ok, false);
    assert.equal(oldTokenValidation.error_code, "E_SCENE_REVISION_DRIFT");

    const refreshedTokenValidation = service.validateSsotTokenForMcp(
      outcome.body.data.read_token_candidate
    );
    assert.equal(refreshedTokenValidation.ok, true);
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp write success without scene revision keeps response unchanged for token fields", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.ssotRevisionState.updateLatestKnownSceneRevision("9101", {
      source_tool_name: "get_scene_snapshot_for_write",
    });
    const initialIssued = service.ssotTokenRegistry.issueToken({
      source_tool_name: "get_scene_snapshot_for_write",
      scene_revision: "9101",
    });
    assert.equal(initialIssued.ok, true);

    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: true,
      tool_name: "modify_ui_layout",
      data: {
        target_object_id: "go_target",
        target_path: "Scene/Canvas/Target",
      },
    });

    const outcome = await service.dispatchSsotToolForMcp(
      "modify_ui_layout",
      buildWritePayload(initialIssued.token)
    );

    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.body.ok, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(outcome.body.data, "read_token_candidate"),
      false
    );
  } finally {
    turnStore.stopMaintenance();
  }
});
