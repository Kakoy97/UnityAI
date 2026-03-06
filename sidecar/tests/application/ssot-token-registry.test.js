"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SsotTokenRegistry,
} = require("../../src/application/ssotRuntime/ssotTokenRegistry");

test("ssot token registry issues token and validates successfully", () => {
  const clock = { value: 1710000000000 };
  const registry = new SsotTokenRegistry({
    nowMs: () => clock.value,
    nowIso: () => new Date(clock.value).toISOString(),
    hardMaxAgeMs: 3000,
    maxEntries: 16,
  });

  const issued = registry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: "ssot_rev_test_a",
    object_id: "go_test",
    path: "Scene/Canvas/B",
    scope_kind: "scene",
  });
  assert.equal(issued.ok, true);
  assert.ok(issued.token.startsWith("ssot_rt_"));
  assert.ok(issued.token.length >= 24);

  const validation = registry.validateToken(issued.token, {
    scene_revision: "ssot_rev_test_a",
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.token_entry.scene_revision, "ssot_rev_test_a");
});

test("ssot token registry returns E_TOKEN_UNKNOWN for unknown token", () => {
  const registry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const validation = registry.validateToken("ssot_rt_missing_token_1234567890", {
    scene_revision: "ssot_rev_test_a",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error_code, "E_TOKEN_UNKNOWN");
});

test("ssot token registry returns E_TOKEN_EXPIRED for expired token", () => {
  const clock = { value: 1710000000000 };
  const registry = new SsotTokenRegistry({
    nowMs: () => clock.value,
    nowIso: () => new Date(clock.value).toISOString(),
    hardMaxAgeMs: 1000,
  });
  const issued = registry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: "ssot_rev_test_a",
  });
  assert.equal(issued.ok, true);

  clock.value += 1500;
  const validation = registry.validateToken(issued.token, {
    scene_revision: "ssot_rev_test_a",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error_code, "E_TOKEN_EXPIRED");
});

test("ssot token registry returns E_SCENE_REVISION_DRIFT for revision mismatch", () => {
  const registry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const issued = registry.issueToken({
    source_tool_name: "get_current_selection",
    scene_revision: "ssot_rev_test_a",
  });
  assert.equal(issued.ok, true);

  const validation = registry.validateToken(issued.token, {
    scene_revision: "ssot_rev_test_b",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error_code, "E_SCENE_REVISION_DRIFT");
});
