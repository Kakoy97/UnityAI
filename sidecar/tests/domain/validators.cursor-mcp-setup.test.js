"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateSetupCursorMcp = getCommandValidator("setup_cursor_mcp");
const validateVerifyMcpSetup = getCommandValidator("verify_mcp_setup");

test("setup_cursor_mcp validator accepts valid payload", () => {
  const result = validateSetupCursorMcp({
    mode: "native",
    sidecar_base_url: "http://127.0.0.1:46321",
    dry_run: true,
  });
  assert.equal(result.ok, true);
});

test("setup_cursor_mcp validator rejects invalid payload", () => {
  const badMode = validateSetupCursorMcp({
    mode: "auto",
  });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.errorCode, "E_SSOT_SCHEMA_INVALID");

  const badUrl = validateSetupCursorMcp({
    sidecar_base_url: "ftp://127.0.0.1:46321",
  });
  assert.equal(badUrl.ok, false);
  assert.equal(badUrl.errorCode, "E_SSOT_SCHEMA_INVALID");

  const badField = validateSetupCursorMcp({
    unknown_key: true,
  });
  assert.equal(badField.ok, false);
  assert.equal(badField.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("verify_mcp_setup validator accepts valid payload", () => {
  const result = validateVerifyMcpSetup({
    mode: "auto",
  });
  assert.equal(result.ok, true);
});

test("verify_mcp_setup validator rejects invalid payload", () => {
  const badMode = validateVerifyMcpSetup({
    mode: "invalid",
  });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.errorCode, "E_SSOT_SCHEMA_INVALID");

  const badField = validateVerifyMcpSetup({
    mode: "auto",
    extra: "x",
  });
  assert.equal(badField.ok, false);
  assert.equal(badField.errorCode, "E_SSOT_SCHEMA_INVALID");
});
