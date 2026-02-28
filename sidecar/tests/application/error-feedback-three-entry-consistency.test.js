"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { createRouter } = require("../../src/api/router");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  ANCHOR_RETRY_SUGGESTION,
} = require("../../src/application/turnPolicies");
const {
  withMcpErrorFeedback,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");

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
      source: "error-feedback-three-entry-consistency-test",
      requestId: "req_seed",
      threadId: "t_default",
      turnId: "turn_seed",
    }
  );
}

function issueReadToken(service) {
  const outcome = service.getCurrentSelectionForMcp();
  assert.equal(outcome.statusCode, 200);
  assert.ok(outcome.body && outcome.body.read_token);
  assert.equal(typeof outcome.body.read_token.token, "string");
  return outcome.body.read_token.token;
}

function invokeRoute(route, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = path;
    req.headers = { host: "127.0.0.1:46321" };

    const response = {
      statusCode: 0,
      headers: {},
      payload: "",
      body: {},
    };
    const res = {
      writeHead(statusCode, headers) {
        response.statusCode = statusCode;
        response.headers = headers || {};
      },
      end(payload) {
        response.payload = payload ? String(payload) : "";
        try {
          response.body = response.payload ? JSON.parse(response.payload) : {};
        } catch {
          response.body = {};
        }
        resolve(response);
      },
      on() {
        // no-op for tests
      },
    };

    route(req, res).catch(reject);

    process.nextTick(() => {
      if (body !== undefined) {
        req.emit("data", Buffer.from(JSON.stringify(body)));
      }
      req.emit("end");
    });
  });
}

test("failed action error fields stay consistent across HTTP/MCP/Stream", async () => {
  const { service } = createService();
  const streamEvents = [];
  const registration = service.registerMcpStreamSubscriber({
    thread_id: "t_default",
    cursor: 0,
    onEvent(eventPayload) {
      streamEvents.push(eventPayload);
    },
  });
  assert.equal(registration.ok, true);

  seedSelectionSnapshot(service, "scene_rev_phase5_consistency");
  const token = issueReadToken(service);

  const submit = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  });
  assert.equal(submit.statusCode, 202);
  const jobId = submit.body.job_id;
  assert.ok(typeof jobId === "string" && jobId.length > 0);

  const pending = service.getUnityTaskStatus(jobId);
  assert.equal(pending.statusCode, 200);
  const requestId = pending.body.request_id;
  assert.ok(typeof requestId === "string" && requestId.length > 0);

  const failed = service.reportUnityActionResult({
    event: "unity.action.result",
    request_id: requestId,
    thread_id: "t_default",
    turn_id: "turn_phase5_consistency",
    timestamp: new Date().toISOString(),
    payload: {
      action_type: "add_component",
      target: "Scene/Root",
      component_assembly_qualified_name:
        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      success: false,
      error_code: "E_TARGET_ANCHOR_CONFLICT",
      error_message:
        "Anchor conflict at C:\\repo\\project\\Assets\\Editor\\A.cs:10\n at Codex.Executor.Apply() in C:\\repo\\project\\Assets\\Editor\\A.cs:line 10",
    },
  });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.error_code, "E_TARGET_ANCHOR_CONFLICT");
  assert.equal(failed.body.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(failed.body.recoverable, true);

  const router = createRouter({
    turnService: service,
    port: 46321,
  });
  const httpStatus = await invokeRoute(
    router,
    "GET",
    `/mcp/get_unity_task_status?job_id=${encodeURIComponent(jobId)}`
  );
  assert.equal(httpStatus.statusCode, 200);

  const mcpServer = Object.create(UnityMcpServer.prototype);
  mcpServer.sidecarBaseUrl = "http://127.0.0.1:46321";
  mcpServer.enableMcpEyes = true;
  mcpServer.httpRequest = async (method, url) => {
    assert.equal(method, "GET");
    const parsed = new URL(url.toString());
    const fromStatus = service.getUnityTaskStatus(
      parsed.searchParams.get("job_id") || ""
    );
    return fromStatus.body;
  };
  const mcpToolResponse = await mcpServer.getUnityTaskStatus({
    job_id: jobId,
  });
  const mcpStatus = JSON.parse(mcpToolResponse.content[0].text);

  const streamTerminal = [...streamEvents].reverse().find((item) => {
    return (
      item &&
      item.job_id === jobId &&
      item.event === "job.completed"
    );
  });
  assert.ok(streamTerminal);

  for (const key of [
    "error_code",
    "error_message",
    "suggestion",
    "recoverable",
  ]) {
    assert.deepEqual(httpStatus.body[key], mcpStatus[key]);
    assert.deepEqual(httpStatus.body[key], streamTerminal[key]);
  }

  assert.equal(httpStatus.body.error_code, "E_TARGET_ANCHOR_CONFLICT");
  assert.equal(httpStatus.body.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(httpStatus.body.recoverable, true);
  assert.equal(httpStatus.body.error_message.includes("\n"), false);
  assert.equal(
    httpStatus.body.error_message.includes("C:\\repo\\project"),
    false
  );
  assert.equal(httpStatus.body.error_message.includes("<path>"), true);

  service.unregisterMcpStreamSubscriber(registration.subscriber_id);
});

test("unknown errors keep fallback recoverable decision stable", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_INTERNAL",
    message: "unexpected internal failure",
  });

  assert.equal(outcome.error_code, "E_INTERNAL");
  assert.equal(outcome.recoverable, false);
  assert.ok(typeof outcome.suggestion === "string" && outcome.suggestion.trim());
});

