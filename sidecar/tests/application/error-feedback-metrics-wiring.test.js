"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  resetMcpErrorFeedbackMetrics,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");

function createService(options) {
  const opts = options && typeof options === "object" ? options : {};
  const turnStore = new TurnStore({ maintenanceIntervalMs: 60000 });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute() {
        return { ok: true, changes: [] };
      },
    },
    legacyAnchorMode: opts.legacyAnchorMode,
    legacyAnchorDenySignoff: opts.legacyAnchorDenySignoff,
  });
}

test.beforeEach(() => {
  resetMcpErrorFeedbackMetrics();
});

test("/mcp/metrics snapshot includes error feedback counters", () => {
  const service = createService();

  const rejectOutcome = service.submitUnityTask(null);
  assert.equal(rejectOutcome.statusCode, 400);

  const metricsOutcome = service.getMcpMetrics();
  assert.equal(metricsOutcome.statusCode, 200);
  assert.ok(metricsOutcome.body.error_feedback_normalized_total >= 1);
  assert.ok(metricsOutcome.body.error_feedback_by_code.E_SCHEMA_INVALID >= 1);
  assert.equal(
    typeof metricsOutcome.body.error_stack_sanitized_total,
    "number"
  );
  assert.equal(typeof metricsOutcome.body.error_path_sanitized_total, "number");
});

test("/mcp/metrics enforces legacy deny gate before switching mode", () => {
  const service = createService({
    legacyAnchorMode: "deny",
    legacyAnchorDenySignoff: false,
  });

  const metrics = service.getMcpMetrics().body;
  assert.equal(metrics.legacy_anchor_mode_requested, "deny");
  assert.equal(metrics.legacy_anchor_mode_effective, "warn");
  assert.equal(metrics.legacy_anchor_deny_gate_ready, false);
  assert.equal(metrics.legacy_anchor_requested_deny_blocked_total, 1);
});

test("/mcp/metrics tracks legacy anchor warn hits", () => {
  const service = createService({
    legacyAnchorMode: "warn",
  });
  const transition = service.mcpGateway.unityDispatcher.start({
    request_id: "req_legacy_hit_metrics",
    thread_id: "thread_legacy_hit_metrics",
    turn_id: "turn_legacy_hit_metrics",
    approval_mode: "auto",
    based_on_read_token: "tok_legacy_hit_metrics_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    runtime: {
      file_actions: [],
      visual_actions: [
        {
          type: "add_component",
          target_object_id: "go_root",
          target_object_path: "Scene/Root",
          component_assembly_qualified_name:
            "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
        },
      ],
      file_actions_applied: true,
      files_changed: [],
      next_visual_index: 0,
      phase: "accepted",
      compile_success: true,
      last_compile_request: null,
      last_action_request: null,
      last_compile_result: null,
      last_action_result: null,
      last_action_error: null,
      reboot_wait_started_at: 0,
    },
  });

  assert.equal(transition.kind, "waiting_action");
  const metrics = service.getMcpMetrics().body;
  assert.equal(metrics.legacy_anchor_warn_hits_total, 1);
  assert.equal(metrics.legacy_anchor_warn_hits_by_action.add_component, 1);
  assert.equal(typeof metrics.legacy_anchor_last_hit_at, "string");
  assert.ok(metrics.legacy_anchor_last_hit_at.length > 0);
});
