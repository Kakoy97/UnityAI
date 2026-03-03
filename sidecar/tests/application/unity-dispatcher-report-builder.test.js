"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildExecutionReport } = require("../../src/application/unityDispatcher/reportBuilder");

function nowIso() {
  return "2026-03-03T00:00:00.000Z";
}

test("buildExecutionReport includes action_write_receipt from runtime.last_action_result", () => {
  const runtime = {
    files_changed: [],
    last_action_result: {
      result_data: {
        dry_run: false,
      },
      write_receipt: {
        schema_version: "write_receipt.v1",
        success: true,
        property_changes: ["target.name", "target.parent_path"],
        scene_diff: {
          dirty_scene_set_changed: true,
          added_dirty_scene_paths: ["Assets/Scenes/SampleScene.unity"],
          cleared_dirty_scene_paths: [],
        },
        target_delta: {
          changed_fields: ["name"],
        },
        created_object_delta: {
          changed_fields: [],
        },
        console_snapshot: {
          total_errors: 2,
          window_seconds: 30,
          truncated: false,
          errors: [
            { error_code: "CS0103", condition: "The name ...", line: 31 },
            { error_code: "E_TARGET_NOT_FOUND", condition: "Target missing", line: 0 },
          ],
        },
      },
    },
  };

  const report = buildExecutionReport(runtime, {}, nowIso);
  assert.ok(report);
  assert.deepEqual(report.action_result_data, { dry_run: false });
  assert.deepEqual(report.action_write_receipt, {
    schema_version: "write_receipt.v1",
    captured_at: "",
    success: true,
    error_code: "",
    target_resolution: "",
    scene_diff: {
      dirty_scene_count_before: 0,
      dirty_scene_count_after: 0,
      added_dirty_scene_paths: ["Assets/Scenes/SampleScene.unity"],
      cleared_dirty_scene_paths: [],
      dirty_scene_set_changed: true,
    },
    target_delta: {
      before: null,
      after: null,
      changed_fields: ["name"],
    },
    created_object_delta: {
      before: null,
      after: null,
      changed_fields: [],
    },
    property_changes: ["target.name", "target.parent_path"],
    console_snapshot: {
      captured_at: "",
      window_start_at: "",
      window_end_at: "",
      window_seconds: 30,
      max_entries: 2,
      total_errors: 2,
      truncated: false,
      errors: [
        {
          timestamp: "",
          log_type: "Error",
          error_code: "CS0103",
          condition: "The name ...",
          file: "",
          line: 31,
        },
        {
          timestamp: "",
          log_type: "Error",
          error_code: "E_TARGET_NOT_FOUND",
          condition: "Target missing",
          file: "",
          line: 0,
        },
      ],
    },
  });
  assert.deepEqual(report.action_write_receipt_summary, {
    schema_version: "write_receipt.v1",
    success: true,
    error_code: "",
    target_resolution: "",
    property_change_count: 2,
    property_changes_preview: ["target.name", "target.parent_path"],
    dirty_scene_set_changed: true,
    added_dirty_scene_count: 1,
    cleared_dirty_scene_count: 0,
    target_changed_fields: ["name"],
    created_changed_fields: [],
    console_error_count: 2,
    console_error_codes: ["CS0103", "E_TARGET_NOT_FOUND"],
    console_window_seconds: 30,
    console_truncated: false,
  });
});

test("buildExecutionReport prefers explicit action_write_receipt from details", () => {
  const runtime = {
    files_changed: [],
    last_action_result: {
      write_receipt: {
        schema_version: "write_receipt.v1",
        success: false,
      },
    },
  };
  const report = buildExecutionReport(
    runtime,
    {
      action_write_receipt: {
        schema_version: "write_receipt.v1",
        success: true,
      },
    },
    nowIso
  );

  assert.ok(report);
  assert.deepEqual(report.action_write_receipt, {
    captured_at: "",
    error_code: "",
    target_resolution: "",
    scene_diff: {
      dirty_scene_count_before: 0,
      dirty_scene_count_after: 0,
      added_dirty_scene_paths: [],
      cleared_dirty_scene_paths: [],
      dirty_scene_set_changed: false,
    },
    target_delta: {
      before: null,
      after: null,
      changed_fields: [],
    },
    created_object_delta: {
      before: null,
      after: null,
      changed_fields: [],
    },
    property_changes: [],
    console_snapshot: null,
    schema_version: "write_receipt.v1",
    success: true,
  });
  assert.equal(report.action_write_receipt_summary.success, true);
  assert.equal(report.action_write_receipt_summary.property_change_count, 0);
});
