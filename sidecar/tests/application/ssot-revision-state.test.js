"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SsotRevisionState,
} = require("../../src/application/ssotRuntime/ssotRevisionState");

test("ssot revision state updates monotonically", () => {
  const state = new SsotRevisionState();
  const first = state.updateLatestKnownSceneRevision("100", {
    source_tool_name: "get_current_selection",
  });
  assert.equal(first.ok, true);
  assert.equal(first.updated, true);
  assert.equal(state.getLatestKnownSceneRevision(), "100");

  const second = state.updateLatestKnownSceneRevision("101", {
    source_tool_name: "get_hierarchy_subtree",
  });
  assert.equal(second.ok, true);
  assert.equal(second.updated, true);
  assert.equal(state.getLatestKnownSceneRevision(), "101");
});

test("ssot revision state drops stale revision and keeps latest", () => {
  const state = new SsotRevisionState();
  state.updateLatestKnownSceneRevision("200", {
    source_tool_name: "get_scene_roots",
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message || ""));
  try {
    const stale = state.updateLatestKnownSceneRevision("199", {
      source_tool_name: "get_scene_roots",
    });
    assert.equal(stale.ok, true);
    assert.equal(stale.updated, false);
    assert.equal(stale.reason, "stale_revision");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(state.getLatestKnownSceneRevision(), "200");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /drop stale scene_revision/);
});

