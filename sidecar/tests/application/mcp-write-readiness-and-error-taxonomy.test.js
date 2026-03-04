"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  withMcpErrorFeedback,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");

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
    request_id: "req_capability_write_readiness",
    thread_id: "t_default",
    turn_id: "turn_capability_write_readiness",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "test_write_readiness_v1",
      actions: [
        {
          type: "set_ui_image_color",
          description: "Set image color",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
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
      source: "mcp-write-readiness-test",
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

test("write tools fast-fail with E_UNITY_NOT_CONNECTED before queueing", () => {
  const service = createService();
  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: "tok_write_ready_123456789012345678901234",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_ui_image_color",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          r: 1,
          g: 0,
          b: 0,
          a: 1,
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 503);
  assert.equal(outcome.body.error_code, "E_UNITY_NOT_CONNECTED");
  assert.equal(outcome.body.recoverable, true);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("write submit path accepts jobs after Unity becomes ready", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_write_ready");
  const token = issueReadToken(service);

  const outcome = service.submitUnityTask({
    thread_id: "thread_write_ready",
    idempotency_key: "idem_write_ready_1",
    user_intent: "write readiness",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/WriteReadiness.cs",
      },
    ],
  });

  assert.equal(outcome.statusCode, 202);
  assert.ok(typeof outcome.body.job_id === "string" && outcome.body.job_id.length > 0);
});

test("R20-UX-GOV-11 write tools fail-fast with E_CONTRACT_VERSION_MISMATCH on catalog_version mismatch", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_gov11_write_mismatch_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    catalog_version: "test_write_readiness_v0",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_ui_image_color",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          r: 1,
          g: 0,
          b: 0,
          a: 1,
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_CONTRACT_VERSION_MISMATCH");
  assert.equal(outcome.body.recoverable, true);
  assert.equal(outcome.body.capability_version, "test_write_readiness_v1");
  assert.equal(outcome.body.requested_catalog_version, "test_write_readiness_v0");
  assert.equal(outcome.body.unity_connection_state, "ready");
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-GOV-11 write tools fail-fast with E_CONTRACT_VERSION_MISMATCH when capability state is stale", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_gov11_write_stale_1");
  const token = issueReadToken(service);
  service.capabilityStore.setConnectionState("stale");

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_ui_image_color",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          r: 1,
          g: 0,
          b: 0,
          a: 1,
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_CONTRACT_VERSION_MISMATCH");
  assert.equal(outcome.body.unity_connection_state, "stale");
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("extended action error taxonomy returns recoverable suggestions", () => {
  const expectedCodes = [
    "E_ACTION_HANDLER_NOT_FOUND",
    "E_ACTION_DESERIALIZE_FAILED",
    "E_ACTION_PAYLOAD_INVALID",
    "E_ACTION_CAPABILITY_MISMATCH",
    "E_CONTRACT_VERSION_MISMATCH",
  ];

  for (const errorCode of expectedCodes) {
    const outcome = withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message: `${errorCode} test`,
    });
    assert.equal(outcome.error_code, errorCode);
    assert.equal(outcome.recoverable, true);
    assert.ok(typeof outcome.suggestion === "string" && outcome.suggestion.trim());
  }
});
