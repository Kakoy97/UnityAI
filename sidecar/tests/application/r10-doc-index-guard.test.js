"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runGuard, REQUIRED_DOCS } = require("../../scripts/r10-doc-index-guard");

test("R10 doc guard has required authority docs configured", () => {
  assert.ok(Array.isArray(REQUIRED_DOCS));
  assert.ok(REQUIRED_DOCS.length >= 5);
});

test("R10 doc guard passes on current source tree", () => {
  const result = runGuard();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
