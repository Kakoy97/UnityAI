"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createRouter } = require("../../src/api/router");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");

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
        // not needed for write route assertions
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

test("router forwards three write HTTP endpoints into unified turnService chain", async () => {
  const calls = {
    submit: 0,
    script: 0,
    visual: 0,
  };
  const turnService = {
    getHealthPayload: () => ({ ok: true }),
    getStateSnapshotPayload: () => ({ ok: true }),
    submitUnityTask(body) {
      calls.submit += 1;
      return { statusCode: 409, body: { route: "submit", body } };
    },
    applyScriptActionsForMcp(body) {
      calls.script += 1;
      return { statusCode: 409, body: { route: "script", body } };
    },
    applyVisualActionsForMcp(body) {
      calls.visual += 1;
      return { statusCode: 409, body: { route: "visual", body } };
    },
  };
  const route = createRouter({
    turnService,
    port: 46321,
  });

  const submitResp = await invokeRoute(route, "POST", "/mcp/submit_unity_task", {
    thread_id: "thread_1",
    idempotency_key: "idem_submit_1",
    user_intent: "submit write",
    based_on_read_token: "tok_submit_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/T.cs",
      },
    ],
  });
  const scriptResp = await invokeRoute(route, "POST", "/mcp/apply_script_actions", {
    based_on_read_token: "tok_script_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [{ type: "delete_file", path: "Assets/Scripts/AIGenerated/T.cs" }],
  });
  const visualResp = await invokeRoute(route, "POST", "/mcp/apply_visual_actions", {
    based_on_read_token: "tok_visual_123456789012345678",
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

  assert.equal(submitResp.statusCode, 409);
  assert.equal(scriptResp.statusCode, 409);
  assert.equal(visualResp.statusCode, 409);
  assert.equal(submitResp.body.route, "submit");
  assert.equal(scriptResp.body.route, "script");
  assert.equal(visualResp.body.route, "visual");
  assert.deepEqual(calls, {
    submit: 1,
    script: 1,
    visual: 1,
  });
});

test("legacy turn endpoints are gone and cannot bypass MCP write chain", async () => {
  const calls = {
    sendTurn: 0,
    startSession: 0,
  };
  const turnService = {
    getHealthPayload: () => ({ ok: true }),
    getStateSnapshotPayload: () => ({ ok: true }),
    sendTurn() {
      calls.sendTurn += 1;
      return { statusCode: 200, body: { ok: true } };
    },
    startSession() {
      calls.startSession += 1;
      return { statusCode: 200, body: { ok: true } };
    },
  };
  const route = createRouter({
    turnService,
    port: 46321,
  });

  const startResp = await invokeRoute(route, "POST", "/session/start", {
    any: "payload",
  });
  const sendResp = await invokeRoute(route, "POST", "/turn/send", {
    any: "payload",
  });

  assert.equal(startResp.statusCode, 410);
  assert.equal(sendResp.statusCode, 410);
  assert.equal(startResp.body.error_code, "E_GONE");
  assert.equal(sendResp.body.error_code, "E_GONE");
  assert.deepEqual(calls, {
    sendTurn: 0,
    startSession: 0,
  });
});

test("MCP write tools call only /mcp write endpoints", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server.enableMcpEyes = true;

  const calls = [];
  server.httpRequest = async (method, url, body) => {
    calls.push({
      method,
      url: url.toString(),
      body,
    });
    return { ok: true };
  };

  await server.submitUnityTask({
    thread_id: "thread_1",
    idempotency_key: "idem_submit_2",
    user_intent: "submit write",
    based_on_read_token: "tok_submit_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/T.cs",
      },
    ],
  });
  await server.applyScriptActions({
    based_on_read_token: "tok_script_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [{ type: "delete_file", path: "Assets/Scripts/AIGenerated/T.cs" }],
  });
  await server.applyVisualActions({
    based_on_read_token: "tok_visual_123456789012345678",
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

  assert.deepEqual(
    calls.map((item) => `${item.method} ${item.url}`),
    [
      "POST http://127.0.0.1:46321/mcp/submit_unity_task",
      "POST http://127.0.0.1:46321/mcp/apply_script_actions",
      "POST http://127.0.0.1:46321/mcp/apply_visual_actions",
    ]
  );
});

test("router exposes /mcp/metrics with no-store header and lifecycle counters", async () => {
  const turnService = {
    getHealthPayload: () => ({ ok: true }),
    getStateSnapshotPayload: () => ({ ok: true }),
    getMcpMetrics() {
      return {
        statusCode: 200,
        body: {
          status: "ok",
          observability_phase: "phase6_freeze",
          metrics_contract_version: "mcp.metrics.v1",
          auto_cleanup_enforced: true,
          auto_cancel_total: 3,
          auto_cancel_heartbeat_timeout_total: 1,
          auto_cancel_max_runtime_total: 1,
          auto_cancel_reboot_wait_timeout_total: 1,
          lock_release_total: 3,
          queue_promote_total: 2,
          error_feedback_normalized_total: 12,
          error_stack_sanitized_total: 4,
          error_path_sanitized_total: 2,
          error_message_truncated_total: 1,
          error_fixed_suggestion_enforced_total: 3,
          error_feedback_by_code: {
            E_STALE_SNAPSHOT: 5,
            E_TARGET_ANCHOR_CONFLICT: 2,
          },
        },
      };
    },
  };
  const route = createRouter({
    turnService,
    port: 46321,
  });

  const resp = await invokeRoute(route, "GET", "/mcp/metrics");
  assert.equal(resp.statusCode, 200);
  assert.equal(resp.body.status, "ok");
  assert.equal(resp.body.observability_phase, "phase6_freeze");
  assert.equal(resp.body.metrics_contract_version, "mcp.metrics.v1");
  assert.equal(resp.body.auto_cleanup_enforced, true);
  assert.equal(resp.body.auto_cancel_total, 3);
  assert.equal(resp.body.auto_cancel_heartbeat_timeout_total, 1);
  assert.equal(resp.body.auto_cancel_max_runtime_total, 1);
  assert.equal(resp.body.auto_cancel_reboot_wait_timeout_total, 1);
  assert.equal(resp.body.lock_release_total, 3);
  assert.equal(resp.body.queue_promote_total, 2);
  assert.equal(resp.body.error_feedback_normalized_total, 12);
  assert.equal(resp.body.error_stack_sanitized_total, 4);
  assert.equal(resp.body.error_path_sanitized_total, 2);
  assert.equal(resp.body.error_message_truncated_total, 1);
  assert.equal(resp.body.error_fixed_suggestion_enforced_total, 3);
  assert.deepEqual(resp.body.error_feedback_by_code, {
    E_STALE_SNAPSHOT: 5,
    E_TARGET_ANCHOR_CONFLICT: 2,
  });
  assert.equal(
    String(resp.headers["Cache-Control"] || resp.headers["cache-control"] || ""),
    "no-store"
  );
  assert.equal(
    String(resp.headers.Pragma || resp.headers.pragma || ""),
    "no-cache"
  );
  assert.equal(
    String(
      resp.headers["X-Codex-Metrics-Contract-Version"] ||
        resp.headers["x-codex-metrics-contract-version"] ||
        ""
    ),
    "mcp.metrics.v1"
  );
});
