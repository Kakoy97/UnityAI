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
  return new TurnService({
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
}

function markUnityReady(service) {
  service.reportUnityCapabilities({
    event: "unity.capabilities.report",
    request_id: "req_capability_r10_l2_05",
    thread_id: "t_default",
    turn_id: "turn_capability_r10_l2_05",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "sha256:r10_l2_05_v1",
      actions: [
        {
          type: "composite_visual_action",
          description: "Composite visual action",
          anchor_policy: "target_or_parent_required",
          action_data_schema: {
            type: "object",
            required: ["schema_version", "transaction_id", "steps"],
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
        max_depth: 2,
        truncated_node_count: 0,
        truncated_reason: "",
        root: {
          name: "Root",
          object_id: "go_root",
          path: "Scene/Root",
          depth: 0,
          active: true,
          prefab_path: "",
          components: [
            {
              short_name: "Transform",
              assembly_qualified_name:
                "UnityEngine.Transform, UnityEngine.CoreModule",
            },
          ],
          children: [],
          children_truncated_count: 0,
        },
      },
    },
    {
      source: "r10-error-schema-hint-test",
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

function buildInvalidCompositeAction() {
  return {
    type: "composite_visual_action",
    target_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    action_data: {
      schema_version: "r10.v1",
      transaction_id: "tx_invalid_no_steps",
      // Intentionally missing steps to trigger E_COMPOSITE_PAYLOAD_INVALID.
    },
  };
}

function assertCompositeSchemaCompensation(body, expectedToolName) {
  assert.equal(body.error_code, "E_COMPOSITE_PAYLOAD_INVALID");
  assert.equal(body.recoverable, true);
  assert.equal(body.retryable, true);
  assert.equal(
    body.schema_source === "inline_hint" || body.schema_source === "get_action_schema",
    true
  );
  assert.ok(body.schema_ref && typeof body.schema_ref === "object");
  assert.equal(body.schema_ref.tool, "get_action_schema");
  assert.ok(body.schema_ref.params && typeof body.schema_ref.params === "object");
  assert.equal(body.schema_ref.params.action_type, "composite_visual_action");
  if (expectedToolName) {
    assert.ok(body.tool_schema_ref && typeof body.tool_schema_ref === "object");
    assert.equal(body.tool_schema_ref.tool, "get_tool_schema");
    assert.equal(
      body.tool_schema_ref.params && body.tool_schema_ref.params.tool_name,
      expectedToolName
    );
  }

  if (body.schema_source === "inline_hint") {
    assert.ok(body.schema_hint && typeof body.schema_hint === "object");
    assert.equal(body.schema_hint.action_type, "composite_visual_action");
  }
}

test("R10-L2-05 apply_visual_actions validation rejection includes schema_hint/schema_ref", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r10_l2_05_apply");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [buildInvalidCompositeAction()],
  });

  assert.equal(outcome.statusCode, 400);
  assertCompositeSchemaCompensation(outcome.body, "apply_visual_actions");
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R10-L2-05 submit_unity_task validation rejection includes schema_hint/schema_ref", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r10_l2_05_submit");
  const token = issueReadToken(service);

  const outcome = service.submitUnityTask({
    thread_id: "thread_r10_l2_05_submit",
    idempotency_key: "idem_r10_l2_05_submit_1",
    user_intent: "trigger validation schema compensation",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    visual_layer_actions: [buildInvalidCompositeAction()],
  });

  assert.equal(outcome.statusCode, 400);
  assertCompositeSchemaCompensation(outcome.body, "submit_unity_task");
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R10-L2-05 apply_visual_actions generic schema rejection includes get_tool_schema schema_ref", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r10_l2_05_apply_generic");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: "not_an_array",
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
  assert.ok(outcome.body.schema_ref && typeof outcome.body.schema_ref === "object");
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
  assert.equal(
    outcome.body.schema_ref.params && outcome.body.schema_ref.params.tool_name,
    "apply_visual_actions"
  );
});

test("R10-L2-05 submit_unity_task generic schema rejection includes get_tool_schema schema_ref", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r10_l2_05_submit_generic");
  const token = issueReadToken(service);

  const outcome = service.submitUnityTask({
    thread_id: "thread_r10_l2_05_submit_generic",
    idempotency_key: "idem_r10_l2_05_submit_generic_1",
    user_intent: "trigger generic schema compensation",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    visual_layer_actions: "not_an_array",
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
  assert.ok(outcome.body.schema_ref && typeof outcome.body.schema_ref === "object");
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
  assert.equal(
    outcome.body.schema_ref.params && outcome.body.schema_ref.params.tool_name,
    "submit_unity_task"
  );
});
