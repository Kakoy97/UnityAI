"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MCP_ERROR_FEEDBACK_TEMPLATES,
} = require("../../src/application/turnPolicies");

test("R9 error taxonomy templates keep required recoverable suggestions", () => {
  const requiredCodes = [
    "E_UNITY_NOT_CONNECTED",
    "E_STALE_SNAPSHOT",
    "E_TARGET_ANCHOR_CONFLICT",
    "E_ACTION_HANDLER_NOT_FOUND",
    "E_ACTION_DESERIALIZE_FAILED",
    "E_ACTION_PAYLOAD_INVALID",
    "E_ACTION_PROPERTY_WRITE_RESTRICTED",
    "E_ACTION_RESULT_MISSING_ERROR_CODE",
    "E_ACTION_CAPABILITY_MISMATCH",
    "E_SCREENSHOT_VIEW_NOT_FOUND",
    "E_SCREENSHOT_CAPTURE_FAILED",
  ];

  for (const code of requiredCodes) {
    const template = MCP_ERROR_FEEDBACK_TEMPLATES[code];
    assert.ok(template, `missing error feedback template for ${code}`);
    assert.equal(
      template.recoverable,
      true,
      `template recoverable flag changed for ${code}`
    );
    assert.ok(
      typeof template.suggestion === "string" && template.suggestion.trim(),
      `template suggestion must be non-empty for ${code}`
    );
  }
});
