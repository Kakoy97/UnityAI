"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enforceFixedErrorSuggestion,
  FIXED_ERROR_SUGGESTION_BY_CODE,
} = require("../../src/domain/validators");

test("enforceFixedErrorSuggestion is passthrough when no fixed map is configured", () => {
  const outcome = enforceFixedErrorSuggestion(
    "E_STALE_SNAPSHOT",
    "custom stale suggestion"
  );

  assert.deepEqual(FIXED_ERROR_SUGGESTION_BY_CODE, {});
  assert.equal(outcome.suggestion, "custom stale suggestion");
  assert.equal(outcome.enforced, false);
});

test("enforceFixedErrorSuggestion trims suggestion text", () => {
  const outcome = enforceFixedErrorSuggestion(
    "E_INTERNAL",
    "  keep this suggestion  "
  );

  assert.equal(outcome.suggestion, "keep this suggestion");
  assert.equal(outcome.enforced, false);
});
