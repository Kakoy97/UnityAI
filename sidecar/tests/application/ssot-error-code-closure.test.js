"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  SSOT_ERROR_CODE_ALIAS_TO_CANONICAL,
} = require("../../src/application/errorFeedback/ssotErrorCodeCanon");

function createTurnServiceHarness() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => "2026-03-07T10:00:00.000Z",
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

test("ssot error-code closure keeps alias map deterministic", () => {
  assert.equal(
    SSOT_ERROR_CODE_ALIAS_TO_CANONICAL.E_OBJECT_NOT_FOUND,
    "E_TARGET_NOT_FOUND"
  );
  assert.equal(
    SSOT_ERROR_CODE_ALIAS_TO_CANONICAL.E_SELECTION_EMPTY,
    "E_SELECTION_UNAVAILABLE"
  );
  assert.equal(
    SSOT_ERROR_CODE_ALIAS_TO_CANONICAL.E_QUERY_HANDLER_FAILED,
    "E_SSOT_ROUTE_FAILED"
  );
});

test("dispatchSsotToolForMcp canonicalizes L3 alias error codes", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: false,
      error_code: "E_OBJECT_NOT_FOUND",
      error_message: "save_prefab target is missing",
    });
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_TARGET_NOT_FOUND");
    assert.equal(typeof outcome.body.suggestion, "string");
    assert.equal(outcome.body.suggestion.trim().length > 0, true);
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp preserves L3 context for structured guidance", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: false,
      error_code: "E_SCENE_REVISION_DRIFT",
      error_message: "scene changed",
      context: {
        stage: "after_write",
        previous_operation: "set_component_properties",
        scene_revision_changed: true,
        l3_context: {
          old_revision: "ssot_rev_old",
          new_revision: "ssot_rev_new",
          failed_property_path: "m_Spacing",
          failed_component_type: "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI",
        },
      },
    });
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_SCENE_REVISION_DRIFT");
    assert.equal(outcome.body.suggested_action, "get_scene_snapshot_for_write");
    assert.equal(outcome.body.context_missing, false);
    assert.equal(
      String(outcome.body.contextual_hint || "").includes("Write advanced scene revision"),
      true
    );
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp surfaces nested transaction failure fields", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: false,
      error_code: "E_TRANSACTION_STEP_FAILED",
      error_message: "transaction step failed: add_layout",
      data: {
        failed_step_index: 2,
        failed_step_id: "add_layout",
        failed_tool_name: "add_component",
        failed_error_code: "E_COMPONENT_TYPE_INVALID",
        failed_error_message: "invalid component type",
        nested_error_code: "E_COMPONENT_TYPE_INVALID",
        nested_error_message: "invalid component type",
        rollback_applied: true,
        rollback_policy: "rollback_all",
        rollback_reason: "transaction_failed",
      },
      context: {
        stage: "during_transaction",
        previous_operation: "execute_unity_transaction",
        scene_revision_changed: true,
      },
    });
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_TRANSACTION_STEP_FAILED");
    assert.equal(outcome.body.failed_step_index, 2);
    assert.equal(outcome.body.failed_step_id, "add_layout");
    assert.equal(outcome.body.failed_tool_name, "add_component");
    assert.equal(outcome.body.failed_error_code, "E_COMPONENT_TYPE_INVALID");
    assert.equal(outcome.body.nested_error_code, "E_COMPONENT_TYPE_INVALID");
    assert.equal(outcome.body.rollback_applied, true);
    assert.equal(outcome.body.rollback_policy, "rollback_all");
    assert.equal(outcome.body.rollback_reason, "transaction_failed");
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp marks stale failure context as requires_context_refresh", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: false,
      error_code: "E_TRANSACTION_STEP_FAILED",
      error_message: "transaction step failed: set_spacing",
      data: {
        failed_step_id: "set_spacing",
        failed_tool_name: "set_component_properties",
        failed_error_code: "E_PROPERTY_NOT_FOUND",
        failed_error_message: "property path not found",
        nested_error_code: "E_PROPERTY_NOT_FOUND",
        nested_error_message: "property path not found",
      },
      context: {
        stage: "during_transaction",
        previous_operation: "execute_unity_transaction",
        scene_revision_changed: true,
        error_context_issued_at: "2026-03-07T09:40:00.000Z",
      },
    });
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_TRANSACTION_STEP_FAILED");
    assert.equal(outcome.body.requires_context_refresh, true);
    assert.equal(
      String(outcome.body.warning || "").includes("stale"),
      true
    );
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp failure envelope always carries non-empty error_code", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => ({
      ok: false,
      error_message: "unity failed without explicit code",
    });
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_SSOT_ROUTE_FAILED");
    assert.equal(typeof outcome.body.error_message, "string");
    assert.equal(outcome.body.error_message.trim().length > 0, true);
  } finally {
    turnStore.stopMaintenance();
  }
});

test("dispatchSsotToolForMcp catch-path also canonicalizes alias error codes", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => {
      throw {
        error_code: "E_SELECTION_EMPTY",
        message: "selection is empty",
        context: {
          stage: "before_dispatch",
          previous_operation: "dispatch_ssot_request",
        },
      };
    };
    const outcome = await service.dispatchSsotToolForMcp("get_current_selection", {});
    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_SELECTION_UNAVAILABLE");
  } finally {
    turnStore.stopMaintenance();
  }
});
