"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../../src/application/turnPolicies");

const EXPECTED_SUGGESTION = OCC_STALE_SNAPSHOT_SUGGESTION;

function createService(options) {
  const opts = options && typeof options === "object" ? options : {};
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    readTokenHardMaxAgeMs: opts.readTokenHardMaxAgeMs,
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
  const revision =
    typeof sceneRevision === "string" && sceneRevision.trim()
      ? sceneRevision.trim()
      : "scene_rev_default";
  service.recordLatestSelectionContext(
    {
      scene_revision: revision,
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
      source: "occ-write-guard-test",
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
  assert.ok(typeof outcome.body.read_token.token === "string");
  return outcome.body.read_token.token;
}

function submitWrite(service, token, idSuffix) {
  return service.submitUnityTask({
    thread_id: "thread_occ",
    idempotency_key: `idem_${idSuffix}`,
    user_intent: "occ test submit",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Temp/OCC_Guard_Test.cs",
      },
    ],
  });
}

test("OCC rejects expired token before queueing", async () => {
  const { service } = createService({ readTokenHardMaxAgeMs: 5 });
  seedSelectionSnapshot(service, "scene_rev_expire_1");
  const token = issueReadToken(service);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const outcome = submitWrite(service, token, "expired");

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_STALE_SNAPSHOT");
  assert.equal(outcome.body.suggestion, EXPECTED_SUGGESTION);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("OCC rejects revision drift before queueing", () => {
  const { service } = createService();
  seedSelectionSnapshot(service, "scene_rev_drift_1");
  const token = issueReadToken(service);
  seedSelectionSnapshot(service, "scene_rev_drift_2");

  const outcome = submitWrite(service, token, "drift");

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_STALE_SNAPSHOT");
  assert.equal(outcome.body.suggestion, EXPECTED_SUGGESTION);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("OCC allows valid token and accepts job", () => {
  const { service } = createService();
  seedSelectionSnapshot(service, "scene_rev_valid_1");
  const token = issueReadToken(service);

  const outcome = submitWrite(service, token, "valid");

  assert.equal(outcome.statusCode, 202);
  assert.ok(outcome.body && outcome.body.job_id);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 1);
});
