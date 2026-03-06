"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateGetUiTree = getCommandValidator("get_ui_tree");

test("get_ui_tree validator accepts valid payload", () => {
  const result = validateGetUiTree({
    ui_system: "ugui",
    scope: {
      root_path: "Scene/Canvas",
    },
    include_inactive: true,
    include_components: true,
    include_layout: true,
    include_interaction: true,
    include_text_metrics: true,
    max_depth: 4,
    node_budget: 300,
    char_budget: 12000,
    resolution: {
      width: 1920,
      height: 1080,
    },
    timeout_ms: 4000,
  });
  assert.equal(result.ok, true);
});

test("get_ui_tree validator rejects unexpected fields", () => {
  const result = validateGetUiTree({
    ui_system: "auto",
    unsupported: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("get_ui_tree validator rejects invalid enum and numeric constraints", () => {
  const badSystem = validateGetUiTree({
    ui_system: "legacy",
  });
  assert.equal(badSystem.ok, false);
  assert.equal(badSystem.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badSystem.message || ""), /ui_system/i);

  const badDepth = validateGetUiTree({
    max_depth: -1,
  });
  assert.equal(badDepth.ok, false);
  assert.equal(badDepth.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badDepth.message || ""), /max_depth/i);

  const badTimeout = validateGetUiTree({
    timeout_ms: 500,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badTimeout.message || ""), /timeout_ms/i);
});

test("get_ui_tree validator rejects invalid resolution", () => {
  const badResolution = validateGetUiTree({
    resolution: {
      width: 0,
      height: 1080,
    },
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badResolution.message || ""), /resolution\/width/i);
});
