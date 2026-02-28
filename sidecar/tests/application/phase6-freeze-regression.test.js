"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createRouter } = require("../../src/api/router");
const { McpStreamHub } = require("../../src/application/mcpGateway/mcpStreamHub");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  OBSERVABILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

function invokeJsonRoute(route, method, path, body) {
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
        // no-op for JSON route assertions
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

function invokeStreamRoute(route, path) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = "GET";
    req.url = path;
    req.headers = { host: "127.0.0.1:46321" };
    req.socket = {
      setKeepAlive() {
        // no-op
      },
    };

    const writes = [];
    const res = new EventEmitter();
    res.writeHead = (statusCode, headers) => {
      res.statusCode = statusCode;
      res.headers = headers || {};
    };
    res.flushHeaders = () => {};
    res.write = (chunk) => {
      writes.push(String(chunk || ""));
    };
    res.end = (payload) => {
      if (payload) {
        writes.push(String(payload));
      }
    };

    route(req, res)
      .then(() => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          writes,
          req,
          res,
        });
      })
      .catch(reject);
  });
}

function parseSsePayloadByEventName(chunks, eventName) {
  const text = Array.isArray(chunks) ? chunks.join("") : "";
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    if (!block || block.startsWith(":")) {
      continue;
    }
    const lines = block.split("\n");
    let currentEvent = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      }
      if (line.startsWith("data:")) {
        data = line.slice(5).trimStart();
      }
    }
    if (currentEvent !== eventName || !data) {
      continue;
    }
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

test("phase6 deprecated HTTP routes are hard rejected with E_GONE", async () => {
  const route = createRouter({
    turnService: {
      getHealthPayload: () => ({ ok: true }),
      getStateSnapshotPayload: () => ({ ok: true }),
    },
    port: 46321,
  });

  const deprecatedRoutes =
    ROUTER_PROTOCOL_FREEZE_CONTRACT &&
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes
      : [];
  assert.ok(deprecatedRoutes.length > 0);

  for (const path of deprecatedRoutes) {
    const resp = await invokeJsonRoute(route, "GET", path);
    assert.equal(resp.statusCode, 410, `route ${path} must return 410`);
    assert.equal(resp.body.error_code, "E_GONE");
  }
});

test("phase6 MCP tools list excludes deprecated names and preserves active set", () => {
  const server = Object.create(UnityMcpServer.prototype);
  const definitions = server.getToolDefinitions();
  const names = definitions.map((item) => item.name);

  const deprecatedNames =
    ROUTER_PROTOCOL_FREEZE_CONTRACT &&
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
      : [];
  const activeNames =
    ROUTER_PROTOCOL_FREEZE_CONTRACT &&
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names
      : [];

  for (const deprecated of deprecatedNames) {
    assert.equal(names.includes(deprecated), false, `deprecated tool leaked: ${deprecated}`);
  }
  for (const active of activeNames) {
    assert.equal(names.includes(active), true, `active tool missing: ${active}`);
  }
});

test("phase6 stream route emits contract version headers and stream.ready version field", async () => {
  const unregistered = [];
  const route = createRouter({
    turnService: {
      getHealthPayload: () => ({ ok: true }),
      getStateSnapshotPayload: () => ({ ok: true }),
      registerMcpStreamSubscriber() {
        return {
          ok: true,
          subscriber_id: "sub_phase6_1",
          requested_cursor: 0,
          replay_events: [],
          replay_from_seq: 0,
          replay_truncated: false,
          recovery_jobs_count: 0,
          recovery_jobs: [],
          oldest_event_seq: 0,
          latest_event_seq: 0,
        };
      },
      unregisterMcpStreamSubscriber(subscriberId) {
        unregistered.push(subscriberId);
      },
    },
    port: 46321,
  });

  const streamResponse = await invokeStreamRoute(route, "/mcp/stream");
  assert.equal(streamResponse.statusCode, 200);
  assert.equal(
    String(
      streamResponse.headers["X-Codex-Stream-Contract-Version"] ||
        streamResponse.headers["x-codex-stream-contract-version"] ||
        ""
    ),
    "mcp.stream.event.v1"
  );
  assert.equal(
    String(
      streamResponse.headers["X-Codex-Stream-Ready-Contract-Version"] ||
        streamResponse.headers["x-codex-stream-ready-contract-version"] ||
        ""
    ),
    "mcp.stream.ready.v1"
  );

  const readyPayload = parseSsePayloadByEventName(
    streamResponse.writes,
    "stream.ready"
  );
  assert.ok(readyPayload);
  assert.equal(
    readyPayload.stream_ready_contract_version,
    "mcp.stream.ready.v1"
  );

  streamResponse.req.emit("close");
  streamResponse.res.emit("close");
  assert.equal(unregistered.includes("sub_phase6_1"), true);
});

test("phase6 mcp stream hub emits frozen metrics/event contract versions", () => {
  const hub = new McpStreamHub({
    nowIso: () => "2026-02-26T16:00:00.000Z",
  });

  const metrics = hub.getMetricsSnapshot({
    observability_phase: "phase6_freeze",
    status_query_calls: 1,
  });
  assert.equal(
    metrics.metrics_contract_version,
    OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version
  );
  assert.equal(metrics.observability_phase, "phase6_freeze");

  const event = hub.publishJobEvent("job.progress", {
    thread_id: "thread_1",
    job_id: "job_1",
    status: "pending",
    stage: "dispatch_pending",
    progress_message: "pending",
    request_id: "req_1",
    running_job_id: "job_1",
    approval_mode: "auto",
    created_at: "2026-02-26T16:00:00.000Z",
    updated_at: "2026-02-26T16:00:00.000Z",
  });
  assert.ok(event);
  assert.equal(
    event.stream_event_contract_version,
    OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version
  );
});
