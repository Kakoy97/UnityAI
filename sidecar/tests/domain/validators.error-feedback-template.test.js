"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enforceFixedErrorSuggestion,
  FIXED_ERROR_SUGGESTION_BY_CODE,
} = require("../../src/domain/validators");

test("enforceFixedErrorSuggestion hard-fixes stale snapshot suggestion", () => {
  const outcome = enforceFixedErrorSuggestion(
    "E_STALE_SNAPSHOT",
    "custom stale suggestion"
  );

  assert.equal(outcome.suggestion, FIXED_ERROR_SUGGESTION_BY_CODE.E_STALE_SNAPSHOT);
  assert.equal(outcome.enforced, true);
});

test("enforceFixedErrorSuggestion keeps non-fixed error suggestions", () => {
  const outcome = enforceFixedErrorSuggestion(
    "E_INTERNAL",
    "  keep this suggestion  "
  );

  assert.equal(outcome.suggestion, "keep this suggestion");
  assert.equal(outcome.enforced, false);
});
