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
    assert.equal(typeof outcome.body.token_automation, "object");
    assert.equal(outcome.body.token_automation.auto_refreshed, true);
    assert.equal(
      outcome.body.data.token_automation.auto_refreshed,
      true
    );
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
    assert.equal(typeof outcome.body.token_automation, "object");
    assert.equal(outcome.body.token_automation.auto_refreshed, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(outcome.body.data, "read_token_candidate"),
      false
    );
    assert.equal(
      outcome.body.data.token_automation.auto_refreshed,
      false
    );
  } finally {
    turnStore.stopMaintenance();
  }
});

test("getStateSnapshotPayload exposes token automation counters for G2-5.5", () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.tokenLifecycleMetricsCollector = {
      getSnapshot() {
        return {
          totals: {
            continuation_issued_total: 12,
          },
        };
      },
    };
    service.ssotTokenDriftRecoveryCoordinator = {
      getShadowMetricsSnapshot() {
        return {
          schema_version: "token_drift_recovery_shadow_metrics.v1",
          totals: {
            events_total: 1,
          },
        };
      },
      getRecoveryMetricsSnapshot() {
        return {
          schema_version: "token_drift_recovery_execute_metrics.v1",
          totals: {
            attempt_total: 5,
            success_total: 3,
            fail_total: 2,
            blocked_total: 1,
          },
          duration_ms: {
            p95: 1875,
          },
        };
      },
    };
    service.plannerDirectCompatibilityMetricsCollector = {
      getSnapshot() {
        return {
          schema_version: "planner_direct_compatibility_metrics.v1",
          totals: {
            decisions_total: 8,
            allow_total: 5,
            warn_total: 2,
            deny_total: 1,
          },
          policy_state: {
            requested_mode: "deny",
            active_mode: "warn",
            reason: "deny_gate_not_satisfied",
            data_source: {
              evaluation_mode: "env_snapshot_static",
            },
          },
        };
      },
    };
    service.plannerVisibilityProfileRuntime = {
      getState() {
        return {
          requested_profile: "planner_first",
          active_profile: "planner_first",
          reason: "planner_first_enabled",
          gate: {
            passed: true,
            reasons: [],
          },
          rollback: {
            triggered: false,
            reasons: [],
          },
        };
      },
    };
    service.genericPropertyFallbackMetricsCollector = {
      getSnapshot() {
        return {
          schema_version: "block_runtime_generic_property_fallback_metrics.v1",
          totals: {
            attempt_total: 4,
            success_total: 3,
          },
          rates: {
            fallback_success_rate: 0.75,
          },
        };
      },
    };

    const snapshot = service.getStateSnapshotPayload();
    assert.equal(
      snapshot.mcp_runtime.token_automation_metrics.token_auto_refresh_total,
      12
    );
    assert.equal(
      snapshot.mcp_runtime.token_automation_metrics.token_auto_retry_success_total,
      3
    );
    assert.equal(
      snapshot.mcp_runtime.token_automation_metrics.token_auto_retry_fail_total,
      2
    );
    assert.equal(
      snapshot.mcp_runtime.token_automation_metrics.token_auto_retry_duration_p95_ms,
      1875
    );
    assert.equal(
      snapshot.mcp_runtime.planner_direct_compatibility.totals.warn_total,
      2
    );
    assert.equal(
      snapshot.mcp_runtime.planner_direct_compatibility.policy_state.active_mode,
      "warn"
    );
    assert.equal(
      snapshot.mcp_runtime.planner_direct_compatibility.policy_state.data_source
        .evaluation_mode,
      "env_snapshot_static"
    );
    assert.equal(
      snapshot.mcp_runtime.planner_visibility_profile.active_profile,
      "planner_first"
    );
    assert.equal(
      snapshot.mcp_runtime.planner_visibility_profile.gate.passed,
      true
    );
    assert.equal(
      snapshot.mcp_runtime.generic_property_fallback.totals.attempt_total,
      4
    );
    assert.equal(
      snapshot.mcp_runtime.generic_property_fallback.rates.fallback_success_rate,
      0.75
    );
  } finally {
    turnStore.stopMaintenance();
  }
});
