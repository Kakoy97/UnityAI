"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { createRouter } = require("../../src/api/router");
const {
  V1PolishMetricsCollector,
} = require("../../src/application/v1PolishMetricsCollector");

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
      on() {},
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

test("v1 polish metrics are recorded from command registry write calls", async () => {
  const turnStore = new TurnStore({ maintenanceIntervalMs: 60000 });
  turnStore.stopMaintenance();
  const collector = new V1PolishMetricsCollector({
    snapshotStore: {
      loadSnapshot() {
        return null;
      },
      saveSnapshot() {
        return true;
      },
    },
    retentionDays: 7,
  });
  const service = new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute() {
        return { ok: true, changes: [] };
      },
    },
    v1PolishMetricsCollector: collector,
  });
  const route = createRouter({
    turnService: service,
    port: 46321,
  });

  await invokeRoute(route, "POST", "/mcp/set_serialized_property", {
    based_on_read_token: "tok_set_serialized_property_1234567890",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    target_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    component_selector: {
      component_assembly_qualified_name:
        "UnityEngine.Transform, UnityEngine.CoreModule",
    },
    patches: [
      {
        property_path: "m_LocalPosition",
        value_kind: "vector3",
        vector3_value: {
          x: 1,
          y: 2,
          z: 3,
        },
      },
    ],
    dry_run: true,
  });

  const metrics = service.getMcpMetrics().body.v1_polish_metrics;
  assert.equal(metrics.enabled, true);
  assert.ok(metrics.counters.tool_calls_total >= 1);
  assert.ok(metrics.counters.generalized_write_total >= 1);
  assert.ok(metrics.counters.dry_run_total >= 1);
  assert.ok(
    metrics.top_property_paths.some(
      (item) => item.property_path === "m_LocalPosition"
    )
  );
});

