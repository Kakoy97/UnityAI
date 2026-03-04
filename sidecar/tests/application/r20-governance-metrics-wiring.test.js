"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
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
  return { service, turnStore };
}

function markUnityReady(service) {
  service.reportUnityCapabilities({
    event: "unity.capabilities.report",
    request_id: "req_r20_governance_metrics",
    thread_id: "t_default",
    turn_id: "turn_r20_governance_metrics",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "test_r20_governance_metrics_v1",
      actions: [
        {
          type: "rename_object",
          description: "Rename object",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
            },
          },
        },
        {
          type: "set_ui_text_content",
          description: "Set text content",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
            required: ["content"],
            properties: {
              content: { type: "string" },
            },
          },
        },
      ],
    },
  });
}

function seedSelectionSnapshot(service, sceneRevision) {
  service.recordLatestSelectionContext(
    {
      scene_revision: sceneRevision,
      selection: {
        mode: "selection",
        object_id: "go_root",
        target_object_path: "Scene/Root",
      },
      selection_tree: {
        max_depth: 1,
        truncated_node_count: 0,
        truncated_reason: "",
        root: {
          name: "Root",
          object_id: "go_root",
          path: "Scene/Root",
          depth: 0,
          active: true,
          prefab_path: "",
          components: [],
          children: [],
          children_truncated_count: 0,
        },
      },
    },
    {
      source: "r20-governance-metrics-test",
      requestId: "req_seed",
      threadId: "thread_seed",
      turnId: "turn_seed",
    }
  );
}

function issueReadToken(service) {
  const outcome = service.getCurrentSelectionForMcp();
  assert.equal(outcome.statusCode, 200);
  assert.ok(outcome.body && outcome.body.read_token);
  return outcome.body.read_token.token;
}

test("R20-UX-GOV-07 /mcp/metrics exposes governance baseline counters", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_governance_metrics_1");
  const token = issueReadToken(service);

  const invalidRenamePayload = {
    thread_id: "t_r20_metrics",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "rename_object",
        target_anchor: {},
        action_data: {
          name: "Panel_Renamed",
        },
      },
    ],
  };

  service.applyVisualActionsForMcp(invalidRenamePayload);
  service.applyVisualActionsForMcp(invalidRenamePayload);
  service.applyVisualActionsForMcp(invalidRenamePayload);

  service.preflightValidateWritePayloadForMcp({
    tool_name: "apply_visual_actions",
    payload: {
      ...invalidRenamePayload,
      dry_run: true,
    },
  });

  service.setUiPropertiesForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    operations: [
      {
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        text: {
          content: "Play",
        },
      },
    ],
    dry_run: true,
  });

  const metrics = service.getMcpMetrics().body;
  assert.ok(metrics.r20_protocol_governance);
  assert.equal(
    metrics.r20_protocol_governance.schema_version,
    "r20_protocol_governance_metrics.v1"
  );
  assert.ok(
    metrics.r20_protocol_governance.counters.write_tool_calls_total >= 3
  );
  assert.ok(
    metrics.r20_protocol_governance.counters.retry_fuse_blocked_total >= 1
  );
  assert.ok(metrics.r20_protocol_governance.counters.preflight_calls_total >= 1);
  assert.ok(
    metrics.r20_protocol_governance.counters.preflight_invalid_total >= 1
  );
  assert.ok(
    metrics.r20_protocol_governance.counters.dry_run_alias_calls_total >= 1
  );
  assert.equal(
    typeof metrics.r20_protocol_governance.derived
      .avg_status_queries_per_terminal_job,
    "number"
  );
  assert.equal(
    typeof metrics.r20_protocol_governance.derived.max_runtime_timeout_rate,
    "number"
  );
  assert.equal(
    typeof metrics.r20_protocol_governance.token.read_token_checks_total,
    "number"
  );
});
