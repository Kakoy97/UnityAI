"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SsotTokenRegistry,
} = require("../../src/application/ssotRuntime/ssotTokenRegistry");
const {
  SsotRevisionState,
} = require("../../src/application/ssotRuntime/ssotRevisionState");
const {
  validateSsotWriteToken,
} = require("../../src/application/ssotRuntime/ssotWriteTokenGuard");

test("ssot write token guard fails when latest scene revision baseline is unavailable", () => {
  const registry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const revisionState = new SsotRevisionState();
  const issued = registry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: "5001",
  });
  assert.equal(issued.ok, true);

  const result = validateSsotWriteToken({
    tokenRegistry: registry,
    revisionState,
    token: issued.token,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "E_SCENE_REVISION_DRIFT");
});

test("ssot write token guard validates token against revision state baseline", () => {
  const registry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const revisionState = new SsotRevisionState();
  revisionState.updateLatestKnownSceneRevision("6001", {
    source_tool_name: "get_scene_roots",
  });
  const issued = registry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: "6001",
  });
  assert.equal(issued.ok, true);

  const okResult = validateSsotWriteToken({
    tokenRegistry: registry,
    revisionState,
    token: issued.token,
  });
  assert.equal(okResult.ok, true);

  revisionState.updateLatestKnownSceneRevision("6002", {
    source_tool_name: "get_scene_roots",
  });
  const driftResult = validateSsotWriteToken({
    tokenRegistry: registry,
    revisionState,
    token: issued.token,
  });
  assert.equal(driftResult.ok, false);
  assert.equal(driftResult.error_code, "E_SCENE_REVISION_DRIFT");
});

