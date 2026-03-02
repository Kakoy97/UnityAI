"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateHitTestUiAtScreenPoint,
} = require("../../src/mcp/commands/hit_test_ui_at_screen_point/validator");

test("hit_test_ui_at_screen_point validator accepts valid payload", () => {
  const result = validateHitTestUiAtScreenPoint({
    view_mode: "game",
    x: 640,
    y: 360,
    reference_width: 1280,
    reference_height: 720,
    max_results: 5,
    timeout_ms: 3000,
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_screen_point validator rejects missing required coordinates", () => {
  const missingX = validateHitTestUiAtScreenPoint({
    y: 20,
  });
  assert.equal(missingX.ok, false);
  assert.equal(missingX.errorCode, "E_SCHEMA_INVALID");
  assert.equal(missingX.message, "x is required");

  const missingY = validateHitTestUiAtScreenPoint({
    x: 20,
  });
  assert.equal(missingY.ok, false);
  assert.equal(missingY.errorCode, "E_SCHEMA_INVALID");
  assert.equal(missingY.message, "y is required");
});

test("hit_test_ui_at_screen_point validator rejects invalid fields and ranges", () => {
  const badViewMode = validateHitTestUiAtScreenPoint({
    view_mode: "scene",
    x: 1,
    y: 1,
  });
  assert.equal(badViewMode.ok, false);
  assert.equal(badViewMode.errorCode, "E_SCHEMA_INVALID");
  assert.equal(badViewMode.message, "view_mode must be one of: auto|game");

  const badTimeout = validateHitTestUiAtScreenPoint({
    x: 10,
    y: 20,
    timeout_ms: 500,
  });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badTimeout.message,
    "timeout_ms must be an integer >= 1000 when provided"
  );

  const badMaxResults = validateHitTestUiAtScreenPoint({
    x: 10,
    y: 20,
    max_results: 0,
  });
  assert.equal(badMaxResults.ok, false);
  assert.equal(badMaxResults.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badMaxResults.message,
    "max_results must be an integer >= 1 when provided"
  );
});

