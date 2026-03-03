"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateGetUiOverlayReport,
} = require("../../src/mcp/commands/get_ui_overlay_report/validator");

test("get_ui_overlay_report validator accepts valid payload", () => {
  const result = validateGetUiOverlayReport({
    scope: {
      root_path: "Scene/Canvas",
    },
    include_inactive: true,
    include_children_summary: true,
    max_nodes: 256,
    max_children_per_canvas: 12,
    timeout_ms: 3000,
  });
  assert.equal(result.ok, true);
});

test("get_ui_overlay_report validator rejects unexpected fields", () => {
  const result = validateGetUiOverlayReport({
    unsupported: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
});

test("get_ui_overlay_report validator rejects mismatched root_path and bad budgets", () => {
  const mismatch = validateGetUiOverlayReport({
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

  const badMaxNodes = validateGetUiOverlayReport({
    max_nodes: 0,
  });
  assert.equal(badMaxNodes.ok, false);
  assert.equal(badMaxNodes.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badMaxNodes.message,
    "max_nodes must be an integer >= 1 when provided"
  );

  const badTimeout = validateGetUiOverlayReport({
    timeout_ms: 500,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badTimeout.message,
    "timeout_ms must be an integer >= 1000 when provided"
  );
});
