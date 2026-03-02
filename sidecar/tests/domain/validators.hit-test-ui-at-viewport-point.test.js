"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateHitTestUiAtViewportPoint,
} = require("../../src/mcp/commands/hit_test_ui_at_viewport_point/validator");

test("hit_test_ui_at_viewport_point validator accepts viewport payload", () => {
  const result = validateHitTestUiAtViewportPoint({
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "bottom_left",
    x: 960,
    y: 540,
    resolution: {
      width: 1920,
      height: 1080,
    },
    scope: {
      root_path: "Scene/Canvas/HUD",
    },
    max_results: 8,
    include_non_interactable: false,
    timeout_ms: 3000,
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator accepts normalized boundary points", () => {
  const result = validateHitTestUiAtViewportPoint({
    coord_space: "normalized",
    x: 1,
    y: 0,
    resolution: {
      width: 1080,
      height: 1920,
    },
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator rejects invalid mapping fields", () => {
  const badCoordSpace = validateHitTestUiAtViewportPoint({
    coord_space: "screen_px",
    x: 1,
    y: 1,
  });
  assert.equal(badCoordSpace.ok, false);
  assert.equal(badCoordSpace.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badCoordSpace.message,
    "coord_space must be one of: viewport_px|normalized"
  );

  const badNormalized = validateHitTestUiAtViewportPoint({
    coord_space: "normalized",
    x: 1.1,
    y: 0.2,
  });
  assert.equal(badNormalized.ok, false);
  assert.equal(badNormalized.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badNormalized.message,
    "x must be in [0,1] when coord_space=normalized"
  );

  const badResolution = validateHitTestUiAtViewportPoint({
    x: 12,
    y: 24,
    resolution: {
      width: 0,
      height: 720,
    },
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    badResolution.message,
    "resolution.width must be an integer >= 1 when provided"
  );
});

