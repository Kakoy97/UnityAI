"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { McpEyesWriteService } = require("../../src/application/mcpGateway/mcpEyesWriteService");

function createTurnService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => "2026-03-03T00:00:00.000Z",
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
}

test("turnService normalizes write receipt summary in getUnityTaskStatus response", () => {
  const service = createTurnService();
  service.mcpGateway.getUnityTaskStatus = () => ({
    statusCode: 200,
    body: {
      status: "succeeded",
      execution_report: {
        action_write_receipt: {
          schema_version: "write_receipt.v1",
          success: true,
          property_changes: ["target.name"],
          scene_diff: {
            dirty_scene_set_changed: false,
            added_dirty_scene_paths: [],
            cleared_dirty_scene_paths: [],
          },
          target_delta: {
            changed_fields: ["name"],
          },
          created_object_delta: {
            changed_fields: [],
          },
          console_snapshot: {
            total_errors: 1,
            window_seconds: 20,
            errors: [{ error_code: "CS0103", condition: "The name ...", line: 12 }],
          },
        },
      },
    },
  });

  const outcome = service.getUnityTaskStatus("job_123");
  assert.equal(outcome.statusCode, 200);
  assert.ok(outcome.body.execution_report);
  assert.ok(outcome.body.execution_report.action_write_receipt_summary);
  assert.equal(
    outcome.body.execution_report.action_write_receipt_summary.console_error_count,
    1
  );
  assert.deepEqual(
    outcome.body.execution_report.action_write_receipt_summary.console_error_codes,
    ["CS0103"]
  );
});

test("mcpEyesWriteService formats write receipt summary on write submit outcome", () => {
  const service = new McpEyesWriteService({
    unitySnapshotService: {
      validateReadTokenForWrite() {
        return { ok: true };
      },
      getLatestSelectionSnapshot() {
        return {
          thread_id: "t_default",
        };
      },
    },
    preconditionService: {
      evaluateWritePreconditions() {
        return { ok: true };
      },
    },
    mcpGateway: {
      isUnityReadyForWrite() {
        return { ok: true };
      },
      submitUnityTask() {
        return {
          statusCode: 202,
          body: {
            status: "accepted",
            execution_report: {
              action_write_receipt: {
                schema_version: "write_receipt.v1",
                success: true,
                property_changes: ["target.active"],
                scene_diff: {
                  dirty_scene_set_changed: true,
                  added_dirty_scene_paths: ["Assets/Scenes/SampleScene.unity"],
                  cleared_dirty_scene_paths: [],
                },
                target_delta: { changed_fields: ["active"] },
                created_object_delta: { changed_fields: [] },
              },
            },
          },
        };
      },
    },
    capabilityStore: {
      getSnapshot() {
        return { actions: [] };
      },
    },
    withMcpErrorFeedback(body) {
      return body;
    },
    validationError(validation) {
      return {
        statusCode: validation.statusCode || 400,
        body: {
          error_code: validation.errorCode || "E_SCHEMA_INVALID",
          message: validation.message || "invalid",
        },
      };
    },
  });

  const outcome = service.applyVisualActions({
    based_on_read_token: "rt_abcdefghijklmnopqrstuvwxyz",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_active",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          active: true,
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 202);
  assert.ok(outcome.body.execution_report);
  assert.ok(outcome.body.execution_report.action_write_receipt_summary);
  assert.equal(
    outcome.body.execution_report.action_write_receipt_summary.property_change_count,
    1
  );
  assert.equal(
    outcome.body.execution_report.action_write_receipt_summary.dirty_scene_set_changed,
    true
  );
});

