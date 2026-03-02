"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateGetUiTree } = require("../../src/mcp/commands/get_ui_tree/validator");

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
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
});

test("get_ui_tree validator rejects invalid enum and numeric constraints", () => {
  const badSystem = validateGetUiTree({
    ui_system: "legacy",
  });
  assert.equal(badSystem.ok, false);
  assert.equal(badSystem.errorCode, "E_SCHEMA_INVALID");
  assert.equal(badSystem.message, "ui_system must be one of: auto|ugui|uitk");

  const badDepth = validateGetUiTree({
    max_depth: -1,
  });
  assert.equal(badDepth.ok, false);
  assert.equal(badDepth.errorCode, "E_SCHEMA_INVALID");
  assert.equal(badDepth.message, "max_depth must be an integer >= 0 when provided");

  const badTimeout = validateGetUiTree({
    timeout_ms: 500,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badTimeout.message,
    "timeout_ms must be an integer >= 1000 when provided"
  );
});

test("get_ui_tree validator rejects root_path/scope mismatch and invalid resolution", () => {
  const mismatch = validateGetUiTree({
    root_path: "Scene/Canvas/HUD",
    scope: {
      root_path: "Scene/Canvas/Other",
    },
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    mismatch.message,
    "root_path and scope.root_path must match when both provided"
  );

  const badResolution = validateGetUiTree({
    resolution: {
      width: 0,
      height: 1080,
    },
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badResolution.message,
    "resolution.width must be an integer >= 1 when provided"
  );
});
