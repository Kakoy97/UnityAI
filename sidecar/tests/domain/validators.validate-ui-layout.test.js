"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateUiLayout,
} = require("../../src/mcp/commands/validate_ui_layout/validator");

test("validate_ui_layout validator accepts valid payload", () => {
  const result = validateUiLayout({
    scope: {
      root_path: "Scene/Canvas/HUD",
    },
    resolutions: [
      { name: "landscape_fhd", width: 1920, height: 1080 },
      { name: "portrait_fhd", width: 1080, height: 1920 },
    ],
    checks: ["OUT_OF_BOUNDS", "OVERLAP", "NOT_CLICKABLE", "TEXT_OVERFLOW"],
    max_issues: 200,
    time_budget_ms: 1200,
    layout_refresh_mode: "scoped_roots_only",
    timeout_ms: 15000,
  });
  assert.equal(result.ok, true);
});

test("validate_ui_layout validator rejects invalid checks and resolutions", () => {
  const badCheck = validateUiLayout({
    checks: ["OVERFLOW_TEXT"],
  });
  assert.equal(badCheck.ok, false);
  assert.equal(badCheck.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badCheck.message,
    "checks items must be one of: OUT_OF_BOUNDS|OVERLAP|NOT_CLICKABLE|TEXT_OVERFLOW"
  );

  const badResolution = validateUiLayout({
    resolutions: [{ width: 0, height: 1080 }],
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badResolution.message,
    "resolutions[0].width must be an integer >= 1 when provided"
  );
});

test("validate_ui_layout validator rejects invalid budget and refresh mode", () => {
  const badBudget = validateUiLayout({
    time_budget_ms: 0,
  });
  assert.equal(badBudget.ok, false);
  assert.equal(badBudget.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badBudget.message,
    "time_budget_ms must be an integer >= 1 when provided"
  );

  const badRefreshMode = validateUiLayout({
    layout_refresh_mode: "none",
  });
  assert.equal(badRefreshMode.ok, false);
  assert.equal(badRefreshMode.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badRefreshMode.message,
    "layout_refresh_mode must be one of: scoped_roots_only|full_tree"
  );
});

