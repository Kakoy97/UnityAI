"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runGuard, REQUIRED_DOCS } = require("../../scripts/r9-doc-index-guard");

test("R9 doc guard has required authority docs configured", () => {
  assert.ok(Array.isArray(REQUIRED_DOCS));
  assert.ok(REQUIRED_DOCS.length >= 3);
});

test("R9 doc guard passes on current source tree", () => {
  const result = runGuard();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
