"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateMcpSetUiProperties } = require("../../src/domain/validators");

const VALID_TOKEN = "tok_dry_run_123456789012345678901234";

function buildPayload(extra) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas_hud",
      path: "Scene/Canvas/HUD",
    },
    operations: [
      {
        target_anchor: {
          object_id: "go_btn_start",
          path: "Scene/Canvas/HUD/StartButton",
        },
        rect_transform: {
          anchored_position: {
            x: 1,
            y: 2,
          },
        },
      },
    ],
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

test("set_ui_properties validator accepts dry_run=true and dry_run=false", () => {
  const dryRunTrue = validateMcpSetUiProperties(
    buildPayload({
      dry_run: true,
    })
  );
  assert.equal(dryRunTrue.ok, true);

  const dryRunFalse = validateMcpSetUiProperties(
    buildPayload({
      dry_run: false,
    })
  );
  assert.equal(dryRunFalse.ok, true);
});

test("set_ui_properties validator rejects non-boolean dry_run", () => {
  const invalid = validateMcpSetUiProperties(
    buildPayload({
      dry_run: "true",
    })
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "E_SCHEMA_INVALID");
  assert.equal(invalid.message, "dry_run must be a boolean when provided");
});
