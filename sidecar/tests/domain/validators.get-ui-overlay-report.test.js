"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateGetUiOverlayReport = getCommandValidator("get_ui_overlay_report");

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
  assert.equal(result.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("get_ui_overlay_report validator rejects bad numeric budgets", () => {
  const badMaxNodes = validateGetUiOverlayReport({
    max_nodes: 0,
  });
  assert.equal(badMaxNodes.ok, false);
  assert.equal(badMaxNodes.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badMaxNodes.message || ""), /max_nodes/i);

  const badTimeout = validateGetUiOverlayReport({
    timeout_ms: 500,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badTimeout.message || ""), /timeout_ms/i);
});
