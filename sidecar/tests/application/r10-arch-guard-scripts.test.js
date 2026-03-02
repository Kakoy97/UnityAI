"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runGuard: runResponsibilityGuard,
  LOC_LIMIT_RULES: R10_LOC_LIMIT_RULES,
  DIRECTION_RULES: R10_DIRECTION_RULES,
} = require("../../scripts/r10-responsibility-guard");
const {
  runGuard: runContractSnapshotGuard,
} = require("../../scripts/r10-contract-snapshot-guard");

test("R10-ARCH-04 responsibility guard passes on current tree", () => {
  const result = runResponsibilityGuard();
  assert.equal(result.ok, true, (result.failures || []).join("\n"));
});

test("R10-ARCH-04 contract snapshot guard passes on current tree", () => {
  const result = runContractSnapshotGuard();
  assert.equal(result.ok, true, (result.failures || []).join("\n"));
});

test("R15-SPLIT-ASSET-01 responsibility guard includes LOC and direction rules", () => {
  assert.ok(Array.isArray(R10_LOC_LIMIT_RULES));
  assert.ok(Array.isArray(R10_DIRECTION_RULES));
  assert.ok(R10_LOC_LIMIT_RULES.length >= 3);
  assert.ok(R10_DIRECTION_RULES.length >= 1);
});
