"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  ANCHOR_RETRY_SUGGESTION,
} = require("../../src/application/turnPolicies");

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
  return {
    turnStore,
    service,
  };
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
      source: "anchor-write-guard-test",
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

test("apply_visual_actions returns unified anchor suggestion on schema failure and never queues job", () => {
  const { service } = createService();
  seedSelectionSnapshot(service, "scene_rev_anchor_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(outcome.body.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(outcome.body.recoverable, true);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

