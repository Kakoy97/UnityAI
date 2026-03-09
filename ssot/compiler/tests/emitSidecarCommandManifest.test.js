"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  emitSidecarCommandManifest,
} = require("../emitters/l2/emitSidecarCommandManifest");

test("emitSidecarCommandManifest emits transaction policy for each command", () => {
  const manifest = emitSidecarCommandManifest({
    version: 1,
    tools: [
      {
        name: "create_object",
        kind: "write",
        lifecycle: "stable",
        transaction: {
          enabled: true,
          undo_safe: true,
        },
      },
      {
        name: "save_scene",
        kind: "write",
        lifecycle: "stable",
        transaction: {
          enabled: false,
          undo_safe: false,
        },
      },
    ],
  });

  assert.equal(manifest.commands.length, 2);
  assert.deepEqual(manifest.commands[0].transaction, {
    enabled: true,
    undo_safe: true,
  });
  assert.deepEqual(manifest.commands[1].transaction, {
    enabled: false,
    undo_safe: false,
  });
});

test("emitSidecarCommandManifest marks run_unity_tests as local_static", () => {
  const manifest = emitSidecarCommandManifest({
    version: 1,
    tools: [
      {
        name: "run_unity_tests",
        kind: "read",
        lifecycle: "experimental",
      },
    ],
  });

  assert.equal(manifest.commands.length, 1);
  assert.equal(manifest.commands[0].name, "run_unity_tests");
  assert.equal(manifest.commands[0].dispatch_mode, "local_static");
  assert.equal(manifest.commands[0].http.method, "POST");
  assert.equal(manifest.commands[0].http.path, "/mcp/run_unity_tests");
});

test("emitSidecarCommandManifest marks planner_execute_mcp as local_static", () => {
  const manifest = emitSidecarCommandManifest({
    version: 1,
    tools: [
      {
        name: "planner_execute_mcp",
        kind: "read",
        lifecycle: "experimental",
      },
    ],
  });

  assert.equal(manifest.commands.length, 1);
  assert.equal(manifest.commands[0].name, "planner_execute_mcp");
  assert.equal(manifest.commands[0].dispatch_mode, "local_static");
  assert.equal(manifest.commands[0].http.method, "POST");
  assert.equal(manifest.commands[0].http.path, "/mcp/planner_execute_mcp");
});
