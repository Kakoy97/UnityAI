"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runGuard, GUARD_RULES } = require("../../scripts/r9-closure-guard");

test("R9 closure guard script has active rules", () => {
  assert.ok(Array.isArray(GUARD_RULES));
  assert.ok(GUARD_RULES.length >= 4);
});

test("R9 closure guard passes on current source tree", () => {
  const result = runGuard();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
