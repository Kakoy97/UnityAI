"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runGuard: runCommandBoundaryGuard,
  LOC_LIMIT_RULES: R11_LOC_LIMIT_RULES,
  DIRECTION_RULES: R11_DIRECTION_RULES,
} = require("../../scripts/r11-command-boundary-guard");

test("R11-ARCH-03 command boundary guard passes on current tree", () => {
  const result = runCommandBoundaryGuard();
  assert.equal(result.ok, true, (result.failures || []).join("\n"));
});

test("R15-SPLIT-ASSET-01 command boundary guard includes LOC and direction rules", () => {
  assert.ok(Array.isArray(R11_LOC_LIMIT_RULES));
  assert.ok(Array.isArray(R11_DIRECTION_RULES));
  assert.ok(R11_LOC_LIMIT_RULES.length >= 4);
  assert.ok(R11_DIRECTION_RULES.length >= 1);
});
