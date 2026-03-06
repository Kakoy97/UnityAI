"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateUiLayout = getCommandValidator("validate_ui_layout");

test("validate_ui_layout validator accepts valid payload", () => {
  const result = validateUiLayout({
    scope_root_path: "Scene/Canvas/HUD",
    resolution_name: "landscape_fhd",
    resolution_width: 1920,
    resolution_height: 1080,
    checks_csv: "OUT_OF_BOUNDS,OVERLAP,NOT_CLICKABLE,TEXT_OVERFLOW",
    max_issues: 200,
    time_budget_ms: 1200,
    layout_refresh_mode: "scoped_roots_only",
    include_repair_plan: true,
    max_repair_suggestions: 8,
    repair_style: "balanced",
    timeout_ms: 15000,
  });
  assert.equal(result.ok, true);
});

test("validate_ui_layout validator rejects invalid checks and resolutions", () => {
  const badCheck = validateUiLayout({
    checks_csv: "",
  });
  assert.equal(badCheck.ok, false);
  assert.equal(badCheck.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badCheck.message || ""), /checks_csv/i);

  const badResolution = validateUiLayout({
    resolution_width: 0,
    resolution_height: 1080,
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badResolution.message || ""), /resolution_width/i);
});

test("validate_ui_layout validator rejects invalid budget and refresh mode", () => {
  const badBudget = validateUiLayout({
    time_budget_ms: 0,
  });
  assert.equal(badBudget.ok, false);
  assert.equal(badBudget.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badBudget.message || ""), /time_budget_ms/i);

  const badRefreshMode = validateUiLayout({
    layout_refresh_mode: "none",
  });
  assert.equal(badRefreshMode.ok, false);
  assert.equal(badRefreshMode.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badRefreshMode.message || ""), /layout_refresh_mode/i);

  const badRepairStyle = validateUiLayout({
    include_repair_plan: true,
    repair_style: "unsafe",
  });
  assert.equal(badRepairStyle.ok, false);
  assert.equal(badRepairStyle.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badRepairStyle.message || ""), /repair_style/i);
});
