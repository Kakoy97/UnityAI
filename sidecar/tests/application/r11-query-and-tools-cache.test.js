"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { QueryCoordinator } = require("../../src/application/queryCoordinator");
const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

test("R11-L2-04 enqueueAndWaitForUnityQuery resolves via pull/report and cleans waiter", async () => {
  const coordinator = new QueryCoordinator({
    defaultTimeoutMs: 2000,
    maxTimeoutMs: 5000,
  });

  const promise = coordinator.enqueueAndWaitForUnityQuery({
    queryType: "list_assets_in_folder",
    payload: {
      folder_path: "Assets",
    },
    timeoutMs: 2000,
    requestId: "req_r11_query",
    threadId: "thread_r11_query",
  });

  const pulled = coordinator.pullQuery({
    accepted_query_types: ["list_assets_in_folder"],
  });
  assert.equal(pulled.statusCode, 200);
  assert.equal(pulled.body.ok, true);
  assert.equal(pulled.body.pending, true);
  assert.equal(pulled.body.query.query_type, "list_assets_in_folder");
  assert.equal(pulled.body.query.query_contract_version, "unity.query.v2");
  assert.equal(typeof pulled.body.query.query_payload_json, "string");
  assert.equal(pulled.body.query.query_payload_json.length > 0, true);
  assert.deepEqual(JSON.parse(pulled.body.query.query_payload_json), {
    folder_path: "Assets",
  });
  assert.deepEqual(pulled.body.query.payload, {
    folder_path: "Assets",
  });

  const queryId = pulled.body.query.query_id;
  const reported = coordinator.reportQueryResult({
    query_id: queryId,
    result: {
      ok: true,
      data: {
        entries: [],
      },
    },
  });
  assert.equal(reported.statusCode, 200);
  assert.equal(reported.body.ok, true);
  assert.equal(reported.body.accepted, true);

  const resolved = await promise;
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.data, { entries: [] });
  assert.equal(coordinator.getStats().waiters, 0);
});

test("R11-L2-05 command registry precompiles tools schema cache", () => {
  const registry = getMcpCommandRegistry();
  const first = registry.getToolsListCache({
    visualActionHint: "hint_a",
  });
  const second = registry.getToolsListCache({
    visualActionHint: "hint_b",
  });

  assert.equal(Array.isArray(first), true);
  assert.equal(Array.isArray(second), true);
  assert.equal(first.length > 0, true);
  assert.equal(first.length, second.length);

  const byNameFirst = new Map(first.map((item) => [item.name, item]));
  const byNameSecond = new Map(second.map((item) => [item.name, item]));
  const visualFirst = byNameFirst.get("apply_visual_actions");
  const visualSecond = byNameSecond.get("apply_visual_actions");
  assert.ok(visualFirst);
  assert.ok(visualSecond);
  assert.equal(visualFirst.description.includes("hint_a"), true);
  assert.equal(visualSecond.description.includes("hint_b"), true);

  // schema object identity should be stable across calls if cache is precompiled
  for (const [name, item] of byNameFirst.entries()) {
    const next = byNameSecond.get(name);
    assert.ok(next);
    assert.equal(item.inputSchema === next.inputSchema, true);
  }
});

test("R11-L3Q-01A enqueue supports explicit query contract and payload json", async () => {
  const coordinator = new QueryCoordinator({
    defaultTimeoutMs: 2000,
    maxTimeoutMs: 5000,
  });

  const enqueued = coordinator.enqueue({
    query_type: "get_ui_tree",
    query_contract_version: "unity.query.vNext",
    query_payload_json: "{\"ui_system\":\"ugui\",\"max_depth\":2}",
  });

  const pulled = coordinator.pullQuery({
    accepted_query_types: ["get_ui_tree"],
  });

  let resolved = null;
  try {
    assert.equal(pulled.statusCode, 200);
    assert.equal(pulled.body.ok, true);
    assert.equal(pulled.body.pending, true);
    assert.equal(pulled.body.query.query_contract_version, "unity.query.vNext");
    assert.equal(
      pulled.body.query.query_payload_json,
      "{\"ui_system\":\"ugui\",\"max_depth\":2}"
    );
    assert.deepEqual(pulled.body.query.payload, {
      ui_system: "ugui",
      max_depth: 2,
    });

    const reported = coordinator.reportQueryResult({
      query_id: pulled.body.query.query_id,
      result: {
        ok: true,
        data: {},
      },
    });
    assert.equal(reported.statusCode, 200);
    assert.equal(reported.body.ok, true);
    resolved = await enqueued.promise;
  } finally {
    if (!resolved) {
      coordinator.reportQueryResult({
        query_id: pulled.body.query.query_id,
        result: {
          ok: true,
          data: {},
        },
      });
      await enqueued.promise.catch(() => null);
    }
  }
  assert.equal(resolved.ok, true);
});
