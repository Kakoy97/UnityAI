"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { createRouter } = require("../../src/api/router");

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

function createService(nowRef) {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => new Date(nowRef.value).toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    mcpCapabilityStaleAfterMs: 1000,
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

function buildCapabilitiesReport() {
  return {
    event: "unity.capabilities.report",
    request_id: "req_cap_report_1",
    thread_id: "t_default",
    turn_id: "turn_cap_report_1",
    timestamp: "2026-02-28T00:00:00.000Z",
    payload: {
      capability_version: "sha256:capability_v1",
      actions: [
        {
          type: "set_ui_image_color",
          description: "Set UI image color",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
            required: ["r", "g", "b", "a"],
          },
        },
      ],
    },
  };
}

function buildRuntimePing() {
  return {
    event: "unity.runtime.ping",
    request_id: "req_runtime_ping_cap_1",
    thread_id: "t_default",
    turn_id: "turn_runtime_ping_cap_1",
    timestamp: "2026-02-28T00:00:00.000Z",
    payload: {
      status: "idle",
    },
  };
}

async function bringUnityReady(route) {
  const ping = await invokeRoute(
    route,
    "POST",
    "/unity/runtime/ping",
    buildRuntimePing()
  );
  assert.equal(ping.statusCode, 200);

  const report = await invokeRoute(
    route,
    "POST",
    "/unity/capabilities/report",
    buildCapabilitiesReport()
  );
  assert.equal(report.statusCode, 200);
}

test("capability routes expose offline/connecting/ready/stale lifecycle", async () => {
  const nowRef = {
    value: Date.parse("2026-02-28T00:00:00.000Z"),
  };
  const service = createService(nowRef);
  const route = createRouter({
    turnService: service,
    port: 46321,
  });

  const before = await invokeRoute(route, "GET", "/mcp/capabilities");
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.unity_connection_state, "offline");
  assert.equal(before.body.action_count, 0);

  const ping = await invokeRoute(
    route,
    "POST",
    "/unity/runtime/ping",
    buildRuntimePing()
  );
  assert.equal(ping.statusCode, 200);

  const connecting = await invokeRoute(route, "GET", "/mcp/capabilities");
  assert.equal(connecting.statusCode, 200);
  assert.equal(connecting.body.unity_connection_state, "connecting");

  const report = await invokeRoute(
    route,
    "POST",
    "/unity/capabilities/report",
    buildCapabilitiesReport()
  );
  assert.equal(report.statusCode, 200);
  assert.equal(report.body.unity_connection_state, "ready");
  assert.equal(report.body.action_count, 1);

  const ready = await invokeRoute(route, "GET", "/mcp/capabilities");
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.body.unity_connection_state, "ready");
  assert.equal(ready.body.action_count, 1);
  assert.equal(ready.body.actions[0].type, "set_ui_image_color");

  const catalog = await invokeRoute(route, "POST", "/mcp/get_action_catalog", {
    domain: "general",
    cursor: 0,
    limit: 10,
  });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.ok, true);
  assert.equal(Array.isArray(catalog.body.items), true);
  assert.equal(catalog.body.items.length, 1);
  assert.equal(catalog.body.items[0].type, "set_ui_image_color");
  assert.equal(typeof catalog.body.etag, "string");

  const schema = await invokeRoute(route, "POST", "/mcp/get_action_schema", {
    action_type: "set_ui_image_color",
  });
  assert.equal(schema.statusCode, 200);
  assert.equal(schema.body.ok, true);
  assert.equal(schema.body.not_modified, false);
  assert.equal(typeof schema.body.etag, "string");
  assert.equal(schema.body.action.type, "set_ui_image_color");
  assert.equal(schema.body.action.action_data_schema.type, "object");

  const schemaCached = await invokeRoute(
    route,
    "POST",
    "/mcp/get_action_schema",
    {
      action_type: "set_ui_image_color",
      if_none_match: schema.body.etag,
    }
  );
  assert.equal(schemaCached.statusCode, 200);
  assert.equal(schemaCached.body.ok, true);
  assert.equal(schemaCached.body.not_modified, true);
  assert.equal(schemaCached.body.etag, schema.body.etag);

  const missing = await invokeRoute(route, "POST", "/mcp/get_action_schema", {
    action_type: "unknown_action",
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error_code, "E_ACTION_SCHEMA_NOT_FOUND");
  assert.equal(missing.body.recoverable, true);

  nowRef.value += 2000;
  const stale = await invokeRoute(route, "GET", "/mcp/capabilities");
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body.unity_connection_state, "stale");
});

test("get_action_catalog returns E_ACTION_CAPABILITY_MISMATCH on stale catalog_version", async () => {
  const nowRef = {
    value: Date.parse("2026-02-28T00:00:00.000Z"),
  };
  const service = createService(nowRef);
  const route = createRouter({
    turnService: service,
    port: 46321,
  });

  await bringUnityReady(route);

  const mismatch = await invokeRoute(route, "POST", "/mcp/get_action_catalog", {
    catalog_version: "sha256:stale_version",
    cursor: 0,
    limit: 10,
  });

  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.body.ok, false);
  assert.equal(mismatch.body.error_code, "E_ACTION_CAPABILITY_MISMATCH");
  assert.equal(mismatch.body.recoverable, true);
  assert.equal(typeof mismatch.body.suggestion, "string");
  assert.equal(mismatch.body.capability_version, "sha256:capability_v1");
});

test("get_action_schema returns E_ACTION_CAPABILITY_MISMATCH on stale catalog_version", async () => {
  const nowRef = {
    value: Date.parse("2026-02-28T00:00:00.000Z"),
  };
  const service = createService(nowRef);
  const route = createRouter({
    turnService: service,
    port: 46321,
  });

  await bringUnityReady(route);

  const mismatch = await invokeRoute(route, "POST", "/mcp/get_action_schema", {
    action_type: "set_ui_image_color",
    catalog_version: "sha256:stale_version",
  });

  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.body.ok, false);
  assert.equal(mismatch.body.error_code, "E_ACTION_CAPABILITY_MISMATCH");
  assert.equal(mismatch.body.recoverable, true);
  assert.equal(typeof mismatch.body.suggestion, "string");
  assert.equal(mismatch.body.action_type, "set_ui_image_color");
  assert.equal(mismatch.body.capability_version, "sha256:capability_v1");
});
